// 見積依頼の聞き取り（サーバー）
//   ・readDraft：会話からお名前・ご住所・お電話番号・ご希望日時・ご相談内容（AIの要約）を読み取る
//       OpenAI があれば会話全体から（訂正・「来週の火曜」なども反映）、なければ・失敗したときは intake.ts の規則で
//   ・intakeTurn：文字の相談の聞き取りの 1 ターン
//       読み取り → 途中の質問には回答 → 足りない項目だけ伺う → そろったら「内容を確認して送信」ボタン（確認画面）へ
//       伺う文は決まった文（AI が日程を約束したり、確定したりしないように）
import { composeAnswer, planAnswer, type AnswerSource } from "./answer";
import { env } from "./env";
import { logError } from "./errorlog";
import { japanNow } from "./hours";
import {
  CANCEL_RE,
  FIELD_LABEL,
  acceptsOffer,
  INTAKE_CANCEL_TEXT,
  QUESTION_RE,
  addressComplete,
  askedFromText,
  extractFromConversation,
  extractIntake,
  formatPhone,
  keepTouched,
  intakeNeeds,
  intakeQuestion,
  intakeReadyText,
  isPastDate,
  mergeDraft,
  normalizeDateText,
  todayJst,
  wantsEstimate,
  type IntakeField,
  type IntakeState,
} from "./intake";
import { chatCompletionJson } from "./openai";
import { INTAKE_JSON_SCHEMA, buildIntakeExtractPrompt } from "./prompts";
import type { ChatMessage, IntakeDraft } from "./types";
import { isLikelyPhone, truncate } from "./utils";

interface AiIntake {
  name: string | null;
  family_name: string | null;
  address: string | null;
  phone: string | null;
  dates: string[];
  summary: string | null;
  job: string | null;
  latest_is_question: boolean;
  cancel: boolean;
}

/** OpenAI に渡す会話（お客様の発言は長めに、AI の長い回答は短く） */
function transcript(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-20)
    .map((m) => `${m.role === "user" ? "お客様" : "AI"}：${truncate(m.content.replace(/\s+/g, " "), m.role === "user" ? 400 : 160)}`)
    .join("\n");
}

async function readWithAi(messages: ChatMessage[], draft: IntakeDraft): Promise<AiIntake> {
  const known = {
    name: draft.name ?? null,
    address: draft.address ?? null,
    phone: draft.phone ?? null,
    dates: draft.dates,
  };
  return chatCompletionJson<AiIntake>({
    messages: [
      { role: "system", content: buildIntakeExtractPrompt(japanNow().display) },
      { role: "user", content: `【これまでに読み取った内容】\n${JSON.stringify(known)}\n\n【会話】\n${transcript(messages)}` },
    ],
    jsonSchema: INTAKE_JSON_SCHEMA,
    temperature: 0,
    maxTokens: 500,
    purpose: "intake",
  });
}

export interface ReadDraftResult {
  draft: IntakeDraft;
  mode: "openai" | "rules";
  /** 最後の発言に答えるべき質問がある */
  question: boolean;
  /** 最後の発言で見積のご依頼をやめた */
  cancel: boolean;
  /** 過ぎた日付（ご希望日に入れず、伺い直す） */
  past: string[];
  /** 「◯◯様ですね」の呼び方（姓。OpenAI で読み取れたときだけ） */
  callName?: string;
  /** ご依頼の工事（「網戸4枚の張替え」など。OpenAI で読み取れたときだけ） */
  job?: string;
}

/**
 * 会話から下書きを作る。draft はこれまでに読み取った内容（文字の相談の聞き取り・声の相談の AI が渡した内容）。
 * keepSummary：お客様が確認画面でご相談内容を書き直した場合は、その文をそのまま使う。
 */
export async function readDraft(messages: ChatMessage[], draft: IntakeDraft, opts: { keepSummary?: boolean } = {}): Promise<ReadDraftResult> {
  const today = todayJst();
  const rules = extractFromConversation(messages, today);
  const base = mergeDraft(rules.draft, draft);
  const keep = opts.keepSummary && draft.summary ? draft.summary : undefined;
  // OpenAI なし：ご相談内容は、聞き取りの答えを除いたお客様の発言から（声の相談の簡易な要約より正確なため）
  const fallback: IntakeDraft = { ...base, summary: keep ?? (rules.summary || draft.summary || undefined) };
  const hasUser = messages.some((m) => m.role === "user" && m.content.trim());
  if (!env.hasOpenAI || !hasUser) return { draft: fallback, mode: "rules", question: false, cancel: false, past: [] };
  try {
    const ai = await readWithAi(messages, base);
    const phone = ai.phone?.trim() ? formatPhone(ai.phone) : "";
    const read = (ai.dates ?? []).map((d) => normalizeDateText(d, today)).filter(Boolean);
    const past = read.filter((d) => isPastDate(d, today));
    const dates = read.filter((d) => !past.includes(d));
    const out: IntakeDraft = {
      name: ai.name?.trim().replace(/(?:様|さま)$/, "") || base.name,
      address: ai.address?.trim() || base.address,
      // AI が読んだ番号の桁が合わず、規則で正しい番号が読めていればそちら
      phone: phone && (isLikelyPhone(phone) || !base.phone || !isLikelyPhone(base.phone)) ? phone : base.phone,
      dates: [...new Set(dates)].slice(0, 3).length ? [...new Set(dates)].slice(0, 3) : base.dates,
      summary: keep ?? (ai.summary?.trim() || fallback.summary),
    };
    const callName = ai.family_name?.trim().replace(/(?:様|さま)$/, "") || undefined;
    return { draft: out, mode: "openai", question: ai.latest_is_question, cancel: ai.cancel, past, callName, job: ai.job?.trim() || undefined };
  } catch (e) {
    await logError("openai", "見積依頼の聞き取り（会話からの読み取り）", e);
    return { draft: fallback, mode: "rules", question: false, cancel: false, past: [] };
  }
}

/** 聞き取りのやりとり（「見積をお願いします」・お名前などの答え・AI の質問）を除いた会話（途中のご質問の話題を取り違えないように） */
function consultHistory(history: ChatMessage[]): ChatMessage[] {
  const today = todayJst();
  return history.filter((m) =>
    m.role === "user"
      ? !wantsEstimate(m.content) && extractIntake(m.content, [], today).found.length === 0
      : !/お伺いするために|伺うため、|ご希望日時|ご希望日はございますか|お見積りのご依頼|確認画面|内容をご確認|番地まで|お電話番号を|お電話番号をお願い|お名前を教えて|ご住所をお願い|様ですね/.test(m.content),
  );
}

/** 聞き取りの途中のご質問に答える（ふだんの相談と同じ回答のモデル・同じ指示で。同じ質問は学習済みの回答） */
async function answerQuestion(question: string, fullHistory: ChatMessage[], company: string): Promise<{ text: string; sources: AnswerSource[] }> {
  const history = consultHistory(fullHistory);
  const plan = await planAnswer(question, history, { channel: "web_text" });
  if (plan.mode !== "openai") return { text: plan.reply, sources: plan.sources };
  try {
    const recent = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-6)
      .map((m) => ({ role: m.role as "user" | "assistant", content: truncate(m.content, 500) }));
    const text = await composeAnswer(plan, company, [...recent, { role: "user", content: question }], "chat");
    if (text.trim()) return { text: text.trim(), sources: plan.sources };
  } catch (e) {
    await logError("openai", "文字の相談（見積依頼の聞き取り中のご質問）", e);
  }
  const top = plan.hits[0];
  return { text: top ? `「${top.entry.title.replace(/^.*｜/, "")}」についてご案内します。\n${truncate(top.entry.content, 600)}` : "", sources: plan.sources };
}

/**
 * このターンを聞き取りとして扱うか（聞き取り中・見積のご依頼・AI の「お伺いしましょうか？」への「お願いします」・
 * 確認画面の準備後の訂正）。prevAi は直前の AI の発言
 */
export function intakeApplies(text: string, state: IntakeState, prevAi = ""): boolean {
  if (state.active || wantsEstimate(text) || acceptsOffer(text, prevAi)) return true;
  if (!state.ready) return false;
  const x = extractIntake(text, [], todayJst());
  return x.found.length > 0 && !QUESTION_RE.test(x.leftover);
}

export interface IntakeTurnResult {
  reply: string;
  state: IntakeState;
  mode: "openai" | "rules";
  sources: AnswerSource[];
}

const filledNow = (before: IntakeDraft, after: IntakeDraft): IntakeField[] =>
  (["name", "address", "phone", "dates"] as IntakeField[]).filter((f) =>
    f === "dates" ? after.dates.join("|") !== before.dates.join("|") && after.dates.length > 0 : (after[f] ?? "") !== (before[f] ?? "") && Boolean(after[f]),
  );

/**
 * 文字の相談の聞き取りの 1 ターン。messages の最後はお客様の発言。
 * 返す state はブラウザが保存し、次の発言と一緒に送り返す（サーバーには持たない）。
 */
export async function intakeTurn(messages: ChatMessage[], state: IntakeState, opts: { company: string }): Promise<IntakeTurnResult> {
  const today = todayJst();
  const last = messages[messages.length - 1]?.content ?? "";
  const history = messages.slice(0, -1);
  const prevAi = [...history].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const starting = !state.active;
  const asked: IntakeField[] = state.active ? (state.asked?.length ? state.asked : askedFromText(prevAi)) : [];

  // AI の「お伺いしましょうか？」に「お願いします」と答えて、伺い始める
  const offered = starting && !wantsEstimate(last) && acceptsOffer(last, prevAi);
  // 確認画面の準備後の訂正（「電話番号は080-…でした」など）
  if (!state.active && state.ready && !wantsEstimate(last) && !offered) {
    const x = extractIntake(last, [], today);
    const draft = mergeDraft(state.draft, x.draft);
    const changed = filledNow(state.draft, draft);
    const list = changed.map((f) => `${FIELD_LABEL[f]}（${f === "dates" ? draft.dates.join("、") : draft[f]}）`).join("・");
    return {
      reply: `承知しました。${list || "内容"}を確認画面に反映しました。\n下の「内容を確認して送信」ボタンから、ご確認のうえ送信してください。`,
      state: { ...state, draft },
      mode: "rules",
      sources: [],
    };
  }

  // 1. 読み取り（規則：この発言から。OpenAI：会話全体から）
  const x = extractIntake(last, asked, today);
  let leftover = x.leftover;
  let address = x.draft.address;
  // 「熊本市東区」のあと番地だけを答えた場合はつなげる
  if (!address && asked.includes("address") && state.draft.address && !addressComplete(state.draft.address) && /\d/.test(leftover) && !QUESTION_RE.test(leftover)) {
    address = `${state.draft.address}${leftover.replace(/^(?:の|で)/, "")}`.trim();
    leftover = "";
  }
  const dates = x.draft.dates && x.appendDates ? [...state.draft.dates, ...x.draft.dates].slice(0, 3) : x.draft.dates;
  let draft = mergeDraft(state.draft, { ...x.draft, address, dates });
  if (starting) draft = mergeDraft(extractFromConversation(history, today).draft, draft);
  let question = Boolean(leftover) && QUESTION_RE.test(leftover);
  let cancel = !starting && x.found.length === 0 && CANCEL_RE.test(last);
  let mode: "openai" | "rules" = "rules";
  let past = x.past;
  let callName: string | undefined;
  let job: string | undefined;
  if (env.hasOpenAI) {
    const r = await readDraft(messages, draft, { keepSummary: state.summaryEdited });
    if (r.mode === "openai") {
      draft = { ...r.draft, address: address && r.draft.address && r.draft.address.length < address.length ? address : r.draft.address };
      // 「お願いします」だけの返事は質問ではない
      question = offered ? false : r.question;
      cancel = !starting && r.cancel;
      past = [...new Set([...past, ...r.past])];
      callName = r.callName;
      job = r.job;
      mode = "openai";
    }
  }
  // 確認画面でお客様が直した項目は、会話からの読み取りで上書きしない
  draft = keepTouched(draft, state.draft, state.touched);
  const carry = { summaryEdited: state.summaryEdited, touched: state.touched, aiFilled: state.aiFilled };

  // 2. 見積のご依頼をやめる
  if (cancel) {
    return { reply: INTAKE_CANCEL_TEXT, state: { ...state, active: false, ready: false, asked: [], draft }, mode, sources: [] };
  }

  // 3. 途中のご質問には先に答える
  let answer = "";
  let sources: AnswerSource[] = [];
  if (question) {
    const a = await answerQuestion(leftover || last, history, opts.company);
    answer = a.text;
    sources = a.sources;
  }

  // 4. 足りない項目を伺う／そろったら確認画面へ
  const needs = intakeNeeds(draft, asked, state.draft);
  if (needs.length === 0) {
    if (!draft.summary) draft = { ...draft, summary: extractFromConversation(messages, today).summary || undefined };
    const ready = intakeReadyText(draft, job);
    return {
      reply: answer ? `${answer}\n\n${ready}` : ready,
      state: { ...carry, active: false, ready: true, asked: [], draft, summaryAt: messages.length },
      mode,
      sources,
    };
  }
  const q = intakeQuestion(draft, { needs, start: starting, offered, got: filledNow(state.draft, draft), past, today, callName });
  const reply = !answer ? q.text : starting ? `${answer}\n\n${q.text}` : `${answer}\n\n（お見積りのご依頼の続きです）\n${q.text.replace(/^ありがとうございます。/, "")}`;
  return {
    reply,
    state: { ...carry, active: true, ready: false, asked: q.asked, draft, summaryAt: draft.summary ? messages.length : state.summaryAt },
    mode,
    sources,
  };
}
