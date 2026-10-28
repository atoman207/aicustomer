// 電話・LINE・音声フォールバックで共通利用する会話エージェント
//   ・相談中の質問は回答エンジン（answer.ts）で答え、学習済みのナレッジで答えられるものは OpenAI を使わない
//     （OpenAI で答えるときは資料の全文を渡し、根拠の引用＝evidence を先に作らせる）
//   ・見積受付の聞き取り・復唱は OpenAI（構造化出力）で行い、そのときはナレッジを渡さない（トークン節約）
import { fixAddress } from "./address-ai";
import { learnAnswer, planAnswer } from "./answer";
import { env } from "./env";
import { logError } from "./errorlog";
import { createEstimate } from "./estimates";
import { BYE, INTENT_ESTIMATE, fallbackTurn } from "./fallback";
import { japanNow } from "./hours";
import { normalizeDraft } from "./intake";
import { getKnowledge } from "./knowledge";
import { canRetryWithChatModel, chatCompletionJson } from "./openai";
import { AGENT_JSON_SCHEMA, buildAgentSystemPrompt, isFullDocumentContext } from "./prompts";
import { getSession, getSettings, saveSession, upsertConversation } from "./store";
import { summarizeConversation } from "./summarize";
import type { AgentSession, AgentStage, AgentTurnResult, Channel, IntakeDraft, SearchHit } from "./types";
import { domesticPhone, fillTemplate, headTail, readDigits, truncate, uid } from "./utils";

const CHANNEL_WHERE: Record<string, string> = { phone: "AI電話", line: "LINE", web_voice: "声の相談", web_text: "文字の相談" };

interface ModelTurn {
  reply: string;
  stage: AgentStage;
  draft: { name: string | null; address: string | null; phone: string | null; dates: string[]; summary: string | null };
  customer_confirmed: boolean;
  end_call: boolean;
}

export async function createSession(channel: Channel, id?: string, meta?: Record<string, string>): Promise<AgentSession> {
  const now = new Date().toISOString();
  const session: AgentSession = {
    id: id ?? uid(),
    channel,
    stage: "consult",
    draft: { dates: [] },
    messages: [],
    createdAt: now,
    updatedAt: now,
    emptyTurns: 0,
    meta,
  };
  await saveSession(session);
  return session;
}

export async function getOrCreateSession(id: string, channel: Channel, meta?: Record<string, string>): Promise<AgentSession> {
  return (await getSession(id)) ?? createSession(channel, id, meta);
}

export async function greetingFor(channel: Channel): Promise<string> {
  const settings = await getSettings();
  const company = settings.companyName;
  if (channel === "phone") return fillTemplate(settings.greeting, { company });
  if (channel === "line")
    return `畳の${company}の公式LINEにご登録ありがとうございます。\n畳・襖・障子・網戸から住まいのリフォームまで、ご相談や無料お見積りのご依頼を承ります。ご用件をメッセージでお送りください。\nホームページのAI相談でお見積りを受付済みの方は、受付番号（EST-から始まる番号）をお送りいただくと、ご依頼とこのLINEをおつなぎします。`;
  return `こんにちは。畳の${company}のAI相談員です。畳・襖・障子・網戸から住まいのリフォームまで、お気軽にご質問ください。無料お見積りのご依頼も承ります。`;
}

/** HP の声の相談：伺った内容は画面の確認画面に表示し、お客様が確認して送信する */
const FORM_READY_REPLY =
  "ありがとうございます。お名前・ご住所・お電話番号・訪問のご希望日をまとめて確認画面に表示しましたので、内容をご確認ください。修正があれば直して、送信ボタンを押してください。訪問の日程は、担当者よりお電話でご相談のうえ確定いたします。";
const FORM_REMIND_REPLY = "画面の確認画面で「この内容で送信する」を押していただくと、受付が完了します。修正したい項目は、画面の「修正」から直せます。";

function draftComplete(d: IntakeDraft): boolean {
  return Boolean(d.name && d.address && d.phone && d.dates.length > 0);
}

/** 足りない項目を 1 つ伺う（お名前 → ご住所 → ご希望日 → お電話番号の順。文字の相談と同じ） */
function missingPrompt(d: IntakeDraft): string {
  if (!d.name) return "恐れ入ります、お名前をフルネームでお聞かせください。";
  if (!d.address) return "恐れ入ります、訪問先のご住所を市区町村から番地までお聞かせください。";
  if (!d.dates.length) return "恐れ入ります、訪問のご希望日を、日にちと午前・午後でお聞かせください。第3希望までお伺いできます。";
  return "恐れ入ります、ご連絡先のお電話番号をお聞かせください。";
}

function summaryFromMessages(session: AgentSession): string {
  const texts = session.messages.filter((m) => m.role === "user").map((m) => m.content.trim());
  return truncate(texts.join(" ／ "), 220) || "（会話から抽出できませんでした）";
}

function appendSummary(prev: string | undefined, text: string): string {
  return truncate([prev, text.trim()].filter((s): s is string => !!s && s.length > 0).join(" ／ "), 220);
}

/** 「〇〇です」「〇〇と申します」などから答えの部分だけを取り出す */
function cleanAnswer(text: string): string {
  return text
    .trim()
    .replace(/^(はい|えっと|えーと|あの)[、,]?\s*/u, "")
    .replace(/^(名前は|お名前は|氏名は|住所は|ご住所は)[、,]?\s*/u, "")
    .replace(/(と申します|といいます|と言います|です|になります|でお願いします)[。.!！]?$/u, "")
    .replace(/[。.]$/u, "")
    .trim();
}

/**
 * AI が直前にお名前・ご住所を伺い、お客様が短く答えたのに draft に入らなかった場合の補い。
 * （モデルが「電話試験51083」のような珍しい名前を名前と判断しないことがあるため）
 */
function fillAnsweredField(session: AgentSession, draft: IntakeDraft): IntakeDraft {
  const msgs = session.messages;
  const user = msgs[msgs.length - 1];
  const asked = [...msgs.slice(0, -1)].reverse().find((m) => m.role === "assistant")?.content ?? "";
  if (!user || user.role !== "user") return draft;
  const answer = cleanAnswer(user.content);
  if (!answer || answer.length > 40 || /[?？]/.test(user.content) || /^(はい|いいえ|いえ|ok|大丈夫|お願いします)$/i.test(answer)) return draft;
  const next = { ...draft, dates: [...draft.dates] };
  if (!next.name && /(お名前|ご氏名|フルネーム)/.test(asked) && !/(住所|番号|希望)/.test(asked)) next.name = answer;
  else if (!next.address && /ご住所/.test(asked) && !/(お名前|番号|希望)/.test(asked) && /[市区町村郡丁目番地\d-]/.test(answer)) next.address = answer;
  return next;
}

/** OpenAI による 1 ターン（参考情報は相談中の質問に関係するものだけ。受付の聞き取り中は渡さない） */
async function openaiTurn(session: AgentSession, company: string, context: string, hits: SearchHit[]): Promise<AgentTurnResult> {
  const now = japanNow();
  // スタッフの修正点・要望（スプレッドシートの「修正点など」）も指示に入れる
  const notes = (await getKnowledge().catch(() => null))?.staffNotes?.text;
  let system = buildAgentSystemPrompt(company, context, session.channel, now.display, notes);
  system += `\n\n# 現在の受付状態\nstage=${session.stage}\ndraft=${JSON.stringify(session.draft)}`;
  if (session.channel === "phone") {
    const caller = domesticPhone(session.meta?.callerNumber);
    system += caller
      ? `\n発信者番号: ${caller}（お電話番号を伺う際は「いまおかけの、末尾${readDigits(caller.slice(-4))}の番号へ折り返してよろしいでしょうか」のように下4桁だけで確認してください。番号全体を読み上げたり、ほかの番号と混同したりしないでください。同意されたら draft.phone に ${caller} を入れてください）`
      : "\n発信者番号: 非通知（お電話番号は市外局番から伺ってください）";
  }
  const history = session.messages.slice(-12).map((m) => ({ role: m.role, content: truncate(m.content, 400) }));
  // 資料の全文で答えるとき（相談中の質問）は精度の高いモデル（電話は声の相談と同じ速いモデル）。根拠（evidence）の引用が入る分だけ長く
  const full = isFullDocumentContext(context);
  const answerModel = session.channel === "phone" ? env.voiceAnswerModel : env.answerModel;
  const answerEffort = session.channel === "phone" ? env.voiceAnswerReasoning : env.answerReasoning;
  const ask = (model: string) =>
    chatCompletionJson<ModelTurn>({
      model,
      reasoningEffort: model === answerModel ? answerEffort : model === env.answerFallbackModel ? "none" : undefined,
      messages: [{ role: "system", content: system }, ...history],
      jsonSchema: AGENT_JSON_SCHEMA,
      temperature: 0.3,
      maxTokens: full ? 2000 : 500,
      timeoutMs: 90_000,
      purpose: "agent",
    });
  const model = full ? answerModel : env.chatModel;
  let out: ModelTurn;
  try {
    out = await ask(model);
  } catch (e) {
    // 混み合っている・一時的な障害・この API キーでは使えないモデル：答え直しのモデルで答える（理由は管理画面のエラー履歴に）
    const backup = full ? env.answerFallbackModel : null;
    if (!backup || backup === model || !canRetryWithChatModel(e)) throw e;
    await logError("openai", `AI受付（${model} が使えないため ${backup} で回答）`, e);
    out = await ask(backup);
  }
  // モデルが既に伺った項目を null で返しても消さない（訂正時は新しい値で上書きされる）
  const prev = session.draft;
  const dates = (out.draft.dates ?? []).map((d) => d.trim()).filter(Boolean).slice(0, 3);
  const draft: IntakeDraft = fillAnsweredField(session, {
    name: out.draft.name?.trim() || prev.name,
    address: out.draft.address?.trim() || prev.address,
    phone: out.draft.phone?.trim() || prev.phone,
    dates: dates.length > 0 ? dates : prev.dates,
    summary: out.draft.summary?.trim() || prev.summary,
  });
  let stage: AgentStage = out.stage;
  if (out.stage === "completed" && !out.customer_confirmed) stage = "confirming";
  return { reply: out.reply.trim(), stage, draft, done: out.end_call, mode: "openai", sources: hits, answeredBy: "openai" };
}

/** 1ターン処理：ユーザー発話 → 応答。受付完了時はスプレッドシート等へ記録 */
export async function runTurn(
  session: AgentSession,
  userText: string,
): Promise<{ result: AgentTurnResult; session: AgentSession }> {
  const text = userText.trim();
  const settings = await getSettings();
  const at = new Date().toISOString();
  const history = [...session.messages];
  session.messages.push({ role: "user", content: text, at });
  const aiMode = env.hasOpenAI ? "openai" : "demo";
  const fallback = async () => fallbackTurn(session, text, (await getKnowledge()).entries);

  let result: AgentTurnResult;
  const consulting = session.stage === "consult" && !INTENT_ESTIMATE.test(text) && !BYE.test(text);
  if (consulting) {
    // 相談中の質問：学習済みのナレッジで答えられるものは OpenAI を使わない
    const plan = await planAnswer(text, history, { channel: session.channel, style: session.channel === "line" ? "text" : "voice" });
    if (plan.mode !== "openai") {
      result = {
        reply: plan.reply,
        stage: "consult",
        draft: { ...session.draft, dates: [...session.draft.dates], summary: appendSummary(session.draft.summary, text) },
        done: false,
        mode: aiMode,
        sources: plan.hits,
        answeredBy: plan.mode,
      };
    } else {
      try {
        result = await openaiTurn(session, settings.companyName, plan.context, plan.hits);
        if (result.stage === "consult") await learnAnswer(plan, result.reply);
      } catch (e) {
        session.meta = { ...(session.meta ?? {}), lastError: truncate((e as Error).message, 200) };
        await logError(session.channel === "phone" ? "phone" : "openai", `${CHANNEL_WHERE[session.channel] ?? session.channel}（相談への回答）`, e);
        result = await fallback();
      }
    }
  } else if (env.hasOpenAI) {
    // 見積受付の聞き取り・復唱：ナレッジは渡さない（トークン節約）
    try {
      result = await openaiTurn(session, settings.companyName, "", []);
    } catch (e) {
      session.meta = { ...(session.meta ?? {}), lastError: truncate((e as Error).message, 200) };
      await logError(session.channel === "phone" ? "phone" : "openai", `${CHANNEL_WHERE[session.channel] ?? session.channel}（見積受付の聞き取り）`, e);
      result = await fallback();
    }
  } else {
    result = await fallback();
  }

  // HP（声の相談）：そろったら確認画面を表示する。受付の記録はお客様が画面で送信したとき（/api/estimates）
  const viaForm = session.channel === "web_voice" || session.channel === "web_text";
  if (viaForm) result.draft = normalizeDraft(result.draft);
  if (viaForm && (result.stage === "confirming" || result.stage === "completed")) {
    if (draftComplete(result.draft)) {
      result.reply = session.stage === "confirming" ? FORM_REMIND_REPLY : FORM_READY_REPLY;
      result.stage = "confirming";
      result.formReady = true;
      result.done = false;
    } else {
      result.stage = "collecting";
      result.reply = missingPrompt(result.draft);
    }
  }

  if (!viaForm && result.stage === "completed" && !session.estimateId) {
    if (draftComplete(result.draft)) {
      // ご相談内容は会話の全体（最初のご相談から）でまとめ直す（聞き取り中の AI は直近 12 件しか見ていないため）
      // 電話で伺ったご住所の町名の聞き違い（「岱明町」→「大名町」）は、熊本県・大牟田市の町名の一覧で直す（LINE は文字のまま）
      const [whole, fixed] = await Promise.all([summarizeConversation(session.messages), fixAddress(result.draft.address, session.messages, { spoken: session.channel === "phone" })]);
      const estimate = await createEstimate({
        channel: session.channel,
        name: result.draft.name ?? "",
        address: fixed?.address ?? result.draft.address ?? "",
        phone: result.draft.phone ?? "",
        summary: (whole.mode === "openai" && whole.summary) || result.draft.summary || summaryFromMessages(session),
        preferredDates: result.draft.dates,
        sessionId: session.id,
        confirmedByCustomer: true,
      });
      session.estimateId = estimate.id;
      result.estimate = estimate;
      if (session.channel !== "phone") result.reply = `${result.reply}\n受付番号：${estimate.id}`;
      // 電話：受付を記録したら、お礼を伝えて通話を終える（AI が終了を判断しなかったときも、無言のまま待たせない）。
      // AI がほかのご用件を伺っている（質問で終わる）ときは、お答えを待つ
      else if (!/[?？]\s*$/.test(result.reply)) {
        if (!/ありがとうございました/.test(result.reply)) result.reply = `${result.reply}\nお電話ありがとうございました。`;
        result.done = true;
      }
    } else {
      result.stage = "collecting";
      result.reply = missingPrompt(result.draft);
      result.done = false;
    }
  }

  session.stage = result.stage;
  session.draft = result.draft;
  session.messages.push({ role: "assistant", content: result.reply, at: new Date().toISOString() });
  // 長い会話も最初のご相談は残す（要約に使う）
  session.messages = headTail(session.messages);
  session.updatedAt = new Date().toISOString();
  await saveSession(session);
  await upsertConversation({
    id: session.id,
    channel: session.channel,
    startedAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: session.messages,
    estimateId: session.estimateId,
    meta: { ...(session.meta ?? {}), mode: result.mode, stage: session.stage, answer: result.answeredBy ?? "" },
  });
  return { result, session };
}
