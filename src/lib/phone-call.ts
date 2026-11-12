// AI電話（Twilio の Webhook）の 1 ターンの流れ（2026-11-09）
//   ・Twilio は Webhook の答え（TwiML）を 15 秒しか待たない。間に合わないと、英語の「An application error has occurred」を流して
//     通話を切る。そこで、答えに時間がかかるとき（HOLD_AFTER_MS を過ぎたら）は、先に「ただいまお調べしております。少々お待ちください」と
//     伝え、続きを /api/twilio/gather?resume=1 で取りに来てもらう（その間も答えを作り続ける。Next の after）
//   ・続きの要求が別のインスタンスに届いた（作りかけの答えがない）ときは、通話の Cookie（答えを作る前の会話とお客様の発言）から作り直す
//   ・問題が起きても、英語のエラーにせず日本語でおわびして続ける（2 回目は通話を終える）
import { after } from "next/server";
import { TRANSFER_FAILED, TRANSFER_FAILED_RETRY, createSession, greetingFor, handOffTurn, runTurn } from "./agent";
import { env } from "./env";
import { logError } from "./errorlog";
import { resolvePhoneRouting, spokenBusinessHours } from "./hours";
import { getCookie, xml } from "./http";
import { formatPhone } from "./intake";
import { getKnowledge } from "./knowledge";
import { type AskKind, KEYPAD_HINT, askKind, hintsFor, townsToKana } from "./phone-ask";
import { DEFAULT_STAFF_AWAY, afterDialText, fillGuide, sorryText } from "./phone-guide";
import { CALL_COOKIE, callCookieHeader, decodeCallCookie } from "./session-codec";
import { getSession, getSettings, saveSession } from "./store";
import { dial, gather, hangup, redirect, say, twimlResponse } from "./twiml";
import type { AgentSession, AppSettings, PhoneGuide } from "./types";
import { e164Japan, uid } from "./utils";

/** この時間を過ぎても答えができなければ「少々お待ちください」を伝える（PHONE_HOLD_AFTER_MS で変えられる。試験用） */
const holdAfterMs = () => Number(process.env.PHONE_HOLD_AFTER_MS) || 6000;
/** 続きの要求で答えを待つ時間（Twilio の 15 秒より短く） */
const RESUME_WAIT_MS = 10_000;
/** 「少々お待ちください」を伝える回数の上限（それでも答えができなければ、もう一度お話しいただく） */
const MAX_HOLDS = 2;

const HOLD_TEXT = ["ただいまお調べしております。少々お待ちください。", "お待たせしており、申し訳ございません。もう少々お待ちください。"];
const SLOW_TEXT = "お待たせして申し訳ございません。ただいまお答えの準備に時間がかかっております。恐れ入りますが、もう一度お話しいただけますか？";
const ERROR_RETRY = "申し訳ございません、うまくお話を伺えませんでした。恐れ入りますが、もう一度お話しいただけますか？";
export const SYSTEM_DOWN = "申し訳ございません、ただいまAI受付がご利用いただけません。恐れ入りますが、営業時間内に改めてお電話ください。お電話ありがとうございました。";
/** スプレッドシートの「AI電話の案内文」（読めなければ undefined＝既定の文） */
async function phoneGuide(): Promise<PhoneGuide | undefined> {
  return (await getKnowledge().catch(() => null))?.phoneGuide;
}

/**
 * スタッフが出られなかったお電話の最初のガイダンス（シートの「営業時間内にスタッフが出られなかったとき」。空なら既定の文）。
 * afterDial：このお電話で「担当者におつなぎします」とお伝えして出られなかった → あいさつの代わりに「お待たせいたしました。」
 */
async function staffAwayGreeting(settings: AppSettings, afterDial: boolean): Promise<string> {
  const text = fillGuide((await phoneGuide())?.staffAway ?? DEFAULT_STAFF_AWAY, { company: settings.companyName, hours: spokenBusinessHours(settings.phone) });
  return afterDial ? afterDialText(text) : text;
}

/**
 * AI 停止中（常にスタッフ対応）で、担当者が出られなかった・つなぐ先がない：おかけ直しのご案内（AI は伺わない）。
 * シートの「AIを停止しているときの案内」があればその文。なければ時間帯に合わせた既定の文。
 * greet：お電話を受けて最初のひと言（担当者へつなぐとお伝えしたあとなら、あいさつの代わりに「申し訳ございません。」）
 */
export async function closedReply(settings: AppSettings, inBusinessHours: boolean, greet: boolean): Promise<string> {
  const hours = spokenBusinessHours(settings.phone);
  const sheet = (await phoneGuide())?.aiStopped;
  if (sheet) {
    const text = fillGuide(sheet, { company: settings.companyName, hours });
    return greet ? text : sorryText(text);
  }
  const head = greet ? `お電話ありがとうございます。${settings.companyName}です。` : "申し訳ございません。";
  const body = inBusinessHours
    ? "ただいま、担当者が電話に出られません。恐れ入りますが、しばらくしてから改めておかけ直しください。"
    : `ただいま営業時間外です。営業時間は、${hours}です。恐れ入りますが、営業時間内に改めておかけ直しください。`;
  return `${head}${body}お電話ありがとうございました。`;
}

interface CallReply {
  body: string;
  /** 通話の Cookie に入れる会話の状態（なければ Cookie を変えない） */
  session: AgentSession | null;
}

interface Pending {
  promise: Promise<CallReply>;
  at: number;
}

const g = globalThis as unknown as { __aicPhonePending?: Map<string, Pending> };
const pending: Map<string, Pending> = (g.__aicPhonePending ??= new Map());

function prune(): void {
  const cutoff = Date.now() - 120_000;
  for (const [k, v] of pending) if (v.at < cutoff) pending.delete(k);
}

/** ms までに終われば結果、終わらなければ null（p は止めない） */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function respond(reply: CallReply): Response {
  return xml(twimlResponse(reply.body), reply.session ? { "Set-Cookie": callCookieHeader(reply.session) } : {});
}

/** 応答のあとも答えを作り続ける（Vercel では応答を返すと関数が止まるため after で待たせる。要求の外＝試験では何もしない） */
function keepRunning(callSid: string, promise: Promise<CallReply>): void {
  pending.set(callSid, { promise, at: Date.now() });
  try {
    after(() => promise.then(() => undefined));
  } catch {
    // 要求の外
  }
}

/** 答えを作っている途中の状態（Cookie 用の写し。サーバーには保存しない） */
function withPending(s: AgentSession, speech: string, holds: number): AgentSession {
  return { ...s, messages: [...s.messages], draft: { ...s.draft, dates: [...s.draft.dates] }, meta: { ...(s.meta ?? {}), pendingSpeech: speech, holds: String(holds) } };
}

function clearPending(s: AgentSession): AgentSession {
  if (s.meta) {
    delete s.meta.pendingSpeech;
    delete s.meta.holds;
  }
  return s;
}

/** 会話の状態：サーバーの保存（Redis・このインスタンス）と通話の Cookie の、新しいほう（Redis がなく、別のインスタンスに届いたときは Cookie） */
export async function loadCallSession(req: Request, sessionId: string): Promise<AgentSession | null> {
  const stored = await getSession(sessionId).catch(() => null);
  const fromCookie = decodeCallCookie(getCookie(req, CALL_COOKIE), sessionId);
  if (stored && fromCookie) return Date.parse(fromCookie.updatedAt) > Date.parse(stored.updatedAt) ? fromCookie : stored;
  return stored ?? fromCookie;
}

/** 前の問いの種類（聞き取れなかったときに、同じ聞き取り方で聞き直す） */
function lastAsk(session: AgentSession): AskKind {
  const k = session.meta?.ask as AskKind | undefined;
  return k && ["consult", "name", "address", "phone", "dates", "confirm"].includes(k) ? k : "consult";
}

/**
 * AI の発話を読み上げて、お客様の答えを聞く。問いの種類に合わせて聞き取り方を変える（phone-ask.ts）：
 * お電話番号は電話のボタンでも受け（最初の 1 回はご案内を添える）、ご住所は市区町村・町名のヒント、復唱の町名は読み方のひらがなで読む
 */
async function askGather(session: AgentSession, reply: string, actionUrl: string): Promise<string> {
  const kind = askKind(reply, session.stage);
  let text = reply;
  if (kind === "phone" && session.meta?.keypadHinted !== "1" && !/ボタン/.test(reply)) {
    text = `${reply}\n${KEYPAD_HINT}`;
    // 会話の記録にも、お伝えしたとおりに残す
    const last = session.messages[session.messages.length - 1];
    if (last?.role === "assistant" && last.content === reply) last.content = text;
    session.meta = { ...(session.meta ?? {}), keypadHinted: "1" };
  }
  session.meta = { ...(session.meta ?? {}), ask: kind };
  await saveSession(session).catch(() => undefined);
  return gather(townsToKana(text, session.draft.address), actionUrl, env.twilioVoice, { kind, hints: hintsFor(kind, session.draft.address) });
}

/** お客様の発言（Twilio の音声認識の結果）への 1 ターン。問題が起きても TwiML を返す */
async function computeReply(session: AgentSession, speech: string, base: string): Promise<CallReply> {
  const voice = env.twilioVoice;
  const actionUrl = `${base}/api/twilio/gather`;
  clearPending(session);
  try {
    if (!speech) {
      session.emptyTurns += 1;
      await saveSession(session);
      if (session.emptyTurns >= 2) {
        // 2 回続けて聞き取れない：切って終わりにせず、ご用件を伺えていれば折り返しの受付にする（agent.ts の handOff）
        if (session.estimateId) return { body: hangup("お電話ありがとうございました。", voice), session };
        const { result, session: updated } = await handOffTurn(session, "unheard");
        return { body: hangup(result.reply, voice), session: updated };
      }
      // 同じ問いの聞き取り方で聞き直す（お電話番号ならボタンでも受ける）
      const kind = lastAsk(session);
      const again = kind === "phone" ? `恐れ入ります、もう一度お話しください。${KEYPAD_HINT}` : "恐れ入ります、もう一度お話しください。";
      return { body: gather(again, actionUrl, voice, { kind, hints: hintsFor(kind, session.draft.address) }), session };
    }
    session.emptyTurns = 0;
    const { result, session: updated } = await runTurn(session, speech);
    if (updated.meta?.turnErrors) delete updated.meta.turnErrors;
    // 人と話したい（営業時間内・転送先あり）：担当者へつなぐ（受付一覧には先に記録済み。出なければ /api/twilio/dial で折り返しのご案内）
    if (result.transfer) {
      const then = result.estimate ? "callback" : "retry";
      return { body: dial(result.transfer, result.reply, voice, { action: `${base}/api/twilio/dial?then=${then}`, callerId: env.twilioPhoneNumber || undefined }), session: updated };
    }
    if (result.done) return { body: hangup(townsToKana(result.reply, updated.draft.address), voice), session: updated };
    return { body: await askGather(updated, result.reply, actionUrl), session: updated };
  } catch (e) {
    await logError("phone", "AI電話（お客様の発言への応答）", e).catch(() => undefined);
    const errors = Number(session.meta?.turnErrors ?? 0) + 1;
    session.meta = { ...(session.meta ?? {}), turnErrors: String(errors) };
    await saveSession(session).catch(() => undefined);
    const kind = lastAsk(session);
    return errors >= 2
      ? { body: hangup(SYSTEM_DOWN, voice), session }
      : { body: gather(ERROR_RETRY, actionUrl, voice, { kind, hints: hintsFor(kind, session.draft.address) }), session };
  }
}

/** お客様が電話のボタンで押した番号（お電話番号の問い）を、発言として扱う */
function keypadSpeech(digits: string | undefined): string {
  const d = (digits ?? "").replace(/\D/g, "");
  if (!d) return "";
  return `${formatPhone(d) || d}（電話のボタンで入力）`;
}

function holdResponse(base: string, holds: number, cookieSession: AgentSession): Response {
  const text = HOLD_TEXT[Math.min(holds, HOLD_TEXT.length) - 1];
  return xml(twimlResponse(`${say(text, env.twilioVoice)}${redirect(`${base}/api/twilio/gather?resume=1`)}`), { "Set-Cookie": callCookieHeader(cookieSession) });
}

/** POST /api/twilio/gather（お客様の発言）と /api/twilio/gather?resume=1（「少々お待ちください」の続き） */
export async function answerCall(req: Request, params: Record<string, string>, base: string): Promise<Response> {
  prune();
  const callSid = params.CallSid || "unknown";
  const sessionId = `tw_${callSid}`;
  const session =
    (await loadCallSession(req, sessionId)) ?? (await createSession("phone", sessionId, { callSid, callerNumber: params.From ?? "" }));
  if (new URL(req.url).searchParams.get("resume") === "1") return resumeCall(req, session, callSid, base);

  const speech = (params.SpeechResult ?? "").trim() || keypadSpeech(params.Digits);
  // 答えを作る前の状態（時間がかかったときの Cookie。別のインスタンスでも作り直せるように、お客様の発言も入れる）
  const before = withPending(session, speech, 1);
  const work = computeReply(session, speech, base);
  const done = await within(work, holdAfterMs());
  if (done) return respond(done);
  keepRunning(callSid, work);
  return holdResponse(base, 1, before);
}

async function resumeCall(req: Request, session: AgentSession, callSid: string, base: string): Promise<Response> {
  const cookie = decodeCallCookie(getCookie(req, CALL_COOKIE), session.id);
  const holds = Number(cookie?.meta?.holds ?? 1) || 1;
  const speech = cookie?.meta?.pendingSpeech ?? "";
  let entry = pending.get(callSid);
  if (!entry) {
    // 作りかけの答えがこのインスタンスにない：答えを作る前の会話（Cookie）とお客様の発言から作り直す
    const work = computeReply(cookie ?? session, speech, base);
    keepRunning(callSid, work);
    entry = pending.get(callSid)!;
  }
  const done = await within(entry.promise, RESUME_WAIT_MS);
  if (done) {
    pending.delete(callSid);
    return respond(done);
  }
  if (holds >= MAX_HOLDS) {
    pending.delete(callSid);
    await logError("phone", "AI電話（答えに時間がかかり、もう一度お話しいただいた）", `${holds} 回お待たせしても答えができませんでした`).catch(() => undefined);
    const s = clearPending(cookie ?? session);
    const kind = lastAsk(s);
    return respond({ body: gather(SLOW_TEXT, `${base}/api/twilio/gather`, env.twilioVoice, { kind, hints: hintsFor(kind, s.draft.address) }), session: s });
  }
  return holdResponse(base, holds + 1, withPending(cookie ?? session, speech, holds + 1));
}

/**
 * 発信者番号として使える番号か：AI の番号・転送先（お店の電話）の番号は、お客様の番号ではない
 * （転送の仕方によっては、転送元の番号が届くことがある。その番号へ「折り返します」と言わないように。わからなければお客様に伺う）
 */
function callerOf(from: string | undefined, settings: AppSettings): string {
  const n = e164Japan(from);
  if (!n) return from ?? "";
  if (n === e164Japan(env.twilioPhoneNumber) || n === e164Japan(settings.phone.forwardNumber)) return "";
  return from ?? "";
}

/**
 * AI が電話を受ける（着信・担当者が出なかったとき）。staffAway：担当者が出られなかったお電話
 * （dial＝このお電話で担当者へつないだが出なかった・forwarded＝お店の電話が先に鳴り、出られずに転送されてきた）。
 * そのときは、あいさつの代わりに「担当者が出られないため、AI受付が代わりに伺います」と伝える
 */
export async function startAiCall(params: Record<string, string>, base: string, opts: { staffAway?: "dial" | "forwarded" } = {}): Promise<Response> {
  const settings = await getSettings();
  const routing = resolvePhoneRouting(settings.phone);
  const callSid = params.CallSid || uid();
  const session = await createSession("phone", `tw_${callSid}`, {
    callSid,
    callerNumber: callerOf(params.From, settings),
    calledNumber: params.To ?? "",
    ...(params.ForwardedFrom ? { forwardedFrom: params.ForwardedFrom } : {}),
    routing: routing.reason,
    ...(opts.staffAway ? { staffUnanswered: "1" } : {}),
  });
  // 最初のガイダンス（スプレッドシートの「AI電話の案内文」。空なら既定の文）
  const greeting = opts.staffAway ? await staffAwayGreeting(settings, opts.staffAway === "dial") : await greetingFor("phone");
  session.messages.push({ role: "assistant", content: greeting, at: new Date().toISOString() });
  await saveSession(session);
  return xml(twimlResponse(gather(greeting, `${base}/api/twilio/gather`, env.twilioVoice)), { "Set-Cookie": callCookieHeader(session) });
}

/**
 * POST /api/twilio/dial?then=…（担当者へつないだ結果。DialCallStatus）。出たら終わる。出なかったら：
 *   then=ai：着信を担当者へつないだが出なかった → AI が代わりに受ける
 *   then=closed：同じ（AI 停止中＝常にスタッフ対応）→ おかけ直しのご案内（AI は伺わない）
 *   then=callback：AI の会話から担当者へつないだ（折り返しの受付を記録済み）→ 折り返しのご案内
 *   then=retry：同じ（記録できていない）→ AI が続けて伺う
 */
export async function afterDial(req: Request, params: Record<string, string>, base: string): Promise<Response> {
  const status = params.DialCallStatus ?? "";
  if (status === "completed" || status === "answered") return xml(twimlResponse("<Hangup/>"));
  const then = new URL(req.url).searchParams.get("then") ?? "";
  const voice = env.twilioVoice;
  if (then === "ai") return startAiCall(params, base, { staffAway: "dial" });
  if (then === "closed") {
    const settings = await getSettings();
    return xml(twimlResponse(hangup(await closedReply(settings, resolvePhoneRouting(settings.phone).inBusinessHours, false), voice)));
  }
  if (then === "callback") return xml(twimlResponse(hangup(TRANSFER_FAILED, voice)));
  const callSid = params.CallSid || "unknown";
  const session = await loadCallSession(req, `tw_${callSid}`);
  if (!session) return xml(twimlResponse(hangup(TRANSFER_FAILED_RETRY, voice)));
  session.meta = { ...(session.meta ?? {}), staffUnanswered: "1", handoff: "" };
  const reply = "申し訳ございません、ただいま担当者が電話に出られません。代わりに、AI受付がご用件を伺います。どのようなご用件でしょうか？";
  session.messages.push({ role: "assistant", content: reply, at: new Date().toISOString() });
  session.updatedAt = new Date().toISOString();
  await saveSession(session);
  return xml(twimlResponse(gather(reply, `${base}/api/twilio/gather`, voice)), { "Set-Cookie": callCookieHeader(session) });
}

/** 通話が終わった：作りかけの答えは捨てる */
export function forgetCall(callSid: string): void {
  pending.delete(callSid);
}
