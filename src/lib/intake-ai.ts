// 見積依頼の聞き取り（サーバー）
//   ・readDraft：会話からお名前・ご住所・お電話番号・ご希望日時・ご相談内容（AIの要約）を読み取る
//       OpenAI があれば会話全体から（訂正・「来週の火曜」なども反映）、なければ・失敗したときは intake.ts の規則で
//   ・intakeTurn：文字の相談の聞き取りの 1 ターン
//       読み取り → 途中の質問には回答 → 足りない項目だけ伺う → そろったら「内容を確認して送信」ボタン（確認画面）へ
//       伺う文は決まった文（AI が日程を約束したり、確定したりしないように）
import { fixAddress } from "./address-ai";
import { composeAnswer, planAnswer, type AnswerSource } from "./answer";
import { areaOf, outOfAreaNote, serviceAreaFrom } from "./area";
import { env } from "./env";
import { lookupAddress } from "./gazetteer";
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
  notAName,
  plausibleAddress,
  todayJst,
  wantsEstimate,
  type IntakeField,
  type IntakeState,
} from "./intake";
import { getKnowledge } from "./knowledge";
import { chatCompletionJson } from "./openai";
import { INTAKE_JSON_SCHEMA, buildIntakeExtractPrompt } from "./prompts";
import { SALES_DECLINE, isSalesPitch } from "./sales";
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

/**
 * OpenAI に渡す会話。ご相談内容（要約）は会話の最初のほうにあり、お名前・ご連絡先と訂正は最後のほうにあるので、
 * 長い会話は最初の 10 件と最後の 50 件を渡す（以前は最後の 20 件だけで、声の相談の長い会話では最初の
 * ご相談（外壁塗装など）が抜け、要約が訪問の日程の話だけになった：2026-10-27 一畳屋様のご指摘）。
 * AI の発言には、お客様の言葉を復唱して確かめた内容（お電話番号など）が入るので、短くしすぎない
 */
function transcript(messages: ChatMessage[]): string {
  const list = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const HEAD = 10;
  const TAIL = 50;
  const line = (m: ChatMessage) => `${m.role === "user" ? "お客様" : "AI"}：${truncate(m.content.replace(/\s+/g, " "), m.role === "user" ? 600 : 500)}`;
  if (list.length <= HEAD + TAIL) return list.map(line).join("\n");
  return [...list.slice(0, HEAD).map(line), `（…途中の ${list.length - HEAD - TAIL} 件は省略…）`, ...list.slice(-TAIL).map(line)].join("\n");
}

async function readWithAi(messages: ChatMessage[], draft: IntakeDraft): Promise<AiIntake> {
  const known = {
    name: draft.name ?? null,
    address: draft.address ?? null,
    phone: draft.phone ?? null,
    dates: draft.dates,
  };
  return chatCompletionJson<AiIntake>({
    model: env.intakeModel,
    reasoningEffort: env.intakeReasoning,
    messages: [
      { role: "system", content: buildIntakeExtractPrompt(japanNow().display) },
      { role: "user", content: `【これまでに読み取った内容】\n${JSON.stringify(known)}\n\n【会話】\n${transcript(messages)}` },
    ],
    jsonSchema: INTAKE_JSON_SCHEMA,
    temperature: 0,
    maxTokens: 800,
    timeoutMs: 30_000,
    purpose: "intake",
  });
}

/** ご住所の町名の部分を、お客様が文字で入力していた（声の相談の途中で入力欄に書いた）：書かれたとおりに使う */
function typedAddress(messages: ChatMessage[], address: string | undefined): boolean {
  const head = address ? lookupAddress(address).head : "";
  if (!head) return false;
  return messages.some((m) => m.role === "user" && m.via === "text" && m.content.normalize("NFKC").replace(/\s+/g, "").includes(head));
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
  /** 確かめられなかった項目（ご住所の町名が熊本県・大牟田市の一覧になく、直せなかった）。確認画面で「修正」をお願いする */
  unsure?: IntakeField[];
  /** ご住所の町名を一覧の町名に直したとき、直す前のご住所 */
  addressFixedFrom?: string;
}

/**
 * 会話から下書きを作る。draft はこれまでに読み取った内容（文字の相談の聞き取り・声の相談の AI が渡した内容）。
 * keepSummary：お客様が確認画面でご相談内容を書き直した場合は、その文をそのまま使う。
 * spoken：ご住所を声で伺った（声の聞き違いの町名を直す。文字で入力されたご住所は書かれたとおり）
 */
export async function readDraft(messages: ChatMessage[], draft: IntakeDraft, opts: { keepSummary?: boolean; spoken?: boolean } = {}): Promise<ReadDraftResult> {
  const today = todayJst();
  const rules = extractFromConversation(messages, today);
  const base = mergeDraft(rules.draft, draft);
  const keep = opts.keepSummary && draft.summary ? draft.summary : undefined;
  // OpenAI なし：ご相談内容は、聞き取りの答えを除いたお客様の発言から（声の相談の簡易な要約より正確なため）
  const fallback: IntakeDraft = { ...base, summary: keep ?? (rules.summary || draft.summary || undefined) };
  const hasUser = messages.some((m) => m.role === "user" && m.content.trim());
  if (!env.hasOpenAI || !hasUser) {
    // OpenAI なし：声で伺ったご住所の町名が熊本県・大牟田市の一覧になければ、確認画面で「修正」をお願いする
    const unknownTown = opts.spoken && fallback.address ? lookupAddress(fallback.address).status === "town_unknown" : false;
    return { draft: fallback, mode: "rules", question: false, cancel: false, past: [], ...(unknownTown ? { unsure: ["address" as IntakeField] } : {}) };
  }
  try {
    const ai = await readWithAi(messages, base);
    const phone = ai.phone?.trim() ? formatPhone(ai.phone) : "";
    const read = (ai.dates ?? []).map((d) => normalizeDateText(d, today)).filter(Boolean);
    const past = read.filter((d) => isPastDate(d, today));
    const dates = read.filter((d) => !past.includes(d));
    // お名前・ご住所らしくないもの（「一番安いのでお願いします」をお名前、「亀井」をご住所に）は使わない（EST-20261029-KIJJ）
    const aiName = ai.name?.trim().replace(/(?:様|さま)$/, "");
    const aiAddress = ai.address?.trim();
    const out: IntakeDraft = {
      name: (aiName && !notAName(aiName) ? aiName : undefined) || (notAName(base.name) ? undefined : base.name),
      address: (aiAddress && plausibleAddress(aiAddress) ? aiAddress : undefined) || (base.address && !plausibleAddress(base.address) ? undefined : base.address),
      // AI が読んだ番号の桁が合わず、規則で正しい番号が読めていればそちら
      phone: phone && (isLikelyPhone(phone) || !base.phone || !isLikelyPhone(base.phone)) ? phone : base.phone,
      dates: [...new Set(dates)].slice(0, 3).length ? [...new Set(dates)].slice(0, 3) : base.dates,
      summary: keep ?? (ai.summary?.trim() || fallback.summary),
    };
    // 声で伺ったご住所の町名の聞き違い（「岱明町」→「大名町」）を、熊本県・大牟田市の町名の一覧で直す
    const fixed = await fixAddress(out.address, messages, { spoken: opts.spoken === true && !typedAddress(messages, out.address) });
    if (fixed) out.address = fixed.address;
    const callName = ai.family_name?.trim().replace(/(?:様|さま)$/, "") || undefined;
    return {
      draft: out,
      mode: "openai",
      question: ai.latest_is_question,
      cancel: ai.cancel,
      past,
      callName,
      job: ai.job?.trim() || undefined,
      ...(fixed?.unsure ? { unsure: ["address" as IntakeField] } : {}),
      ...(fixed?.from ? { addressFixedFrom: fixed.from } : {}),
    };
  } catch (e) {
    await logError("openai", "見積依頼の聞き取り（会話からの読み取り）", e);
    return { draft: fallback, mode: "rules", question: false, cancel: false, past: [] };
  }
}

/** AI の聞き取りの文（お名前・ご住所などを伺う文・確認画面の案内） */
const INTAKE_ASK = /お伺いするために|伺うため、|ご希望日時|ご希望日はございますか|お見積りのご依頼|確認画面|内容をご確認|番地まで|お電話番号を|お電話番号をお願い|お名前を教えて|ご住所をお願い|様ですね|無料でお見積りに伺います/;

/**
 * 聞き取りのやりとり（お名前などの答え・AI の伺う文）を除いた会話（途中のご質問の話題を取り違えないように）。
 * 品物・数量の入ったお客様の発言（「団地を退去するので、畳と襖の見積もりをお願いしたい」）と、AI の答えの部分
 * （料金の目安。あとに続く伺う文は除く）は残す（退去のご相談なのに、ふつうの料金で答えないように。EST-20261029-KIJJ）
 */
function consultHistory(history: ChatMessage[]): ChatMessage[] {
  const today = todayJst();
  const out: ChatMessage[] = [];
  for (const m of history) {
    if (m.role === "user") {
      const job = JOB_WORD.test(m.content) || CONSULT_TALK.test(m.content.normalize("NFKC"));
      if (job || (!wantsEstimate(m.content) && extractIntake(m.content, [], today).found.length === 0)) out.push(m);
      continue;
    }
    const kept = m.content
      .split(/\n{2,}/)
      .filter((p) => !INTAKE_ASK.test(p) && !/^（お見積りのご依頼の続きです）/.test(p.trim()))
      .join("\n\n")
      .trim();
    if (kept) out.push({ ...m, content: kept });
  }
  return out;
}

/** ご依頼の品物・作業の言葉 */
const JOB_WORD = /畳|襖|ふすま|障子|網戸|アミ戸|クロス|壁紙|カーテン|ブラインド|ガラス|床|外壁|屋根|塗装|リフォーム|トイレ|浴室|キッチン|水まわり|水回り/;
/** ご依頼の内容の話（品物・数量・大きさ・種類の好み・退去など）。聞き取りの途中でも、先に答える */
const CONSULT_TALK = new RegExp(
  `${JOB_WORD.source}|[0-9一二三四五六七八九十]+\\s*(?:枚|本|畳|帖|部屋|間|箇所|か所|m|メートル|センチ|cm)|一番安|安いの|安いもの|高いの|種類|グレード|おすすめ|片面|両面|押入れ|退去|団地|賃貸`,
);

/** 聞き取りの途中の答えの決まり（このあとシステムがお名前などを伺うので、提案・質問を重ねない） */
const DURING_INTAKE = `# この答えについて
お客様は、すでに無料のお見積りのご依頼中です（この答えのあとに、システムがお名前・ご住所などを伺います）。この答えでは、お見積りの提案・個人情報の質問・お客様への質問はしない。ご相談の内容（品物・数量・種類のご希望）を短く受け止めて、料金の目安などに答えるだけにする。`;

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
    const text = await composeAnswer(plan, company, [...recent, { role: "user", content: question }], "chat", DURING_INTAKE);
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
  // 営業・売り込みの会話では、お名前などを伺い始めない（一畳屋様のご要望 2026-10-30。sales.ts）
  if (starting && (await isSalesPitch(messages.filter((m) => m.role === "user").map((m) => m.content).join("\n")))) {
    return { reply: SALES_DECLINE, state: { ...state, active: false, ready: false, asked: [] }, mode: "rules", sources: [] };
  }
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
  let unsure = state.unsure;
  if (env.hasOpenAI) {
    const r = await readDraft(messages, draft, { keepSummary: state.summaryEdited });
    if (r.mode === "openai") {
      // AI の読んだご住所が短い（番地が抜けた）ときは規則で読んだご住所。ただし町名を直したご住所はそのまま
      const keepRules = Boolean(address && r.draft.address && r.draft.address.length < address.length && !r.addressFixedFrom);
      draft = { ...r.draft, address: keepRules ? address : r.draft.address };
      unsure = r.unsure;
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
  const carry = { summaryEdited: state.summaryEdited, touched: state.touched, aiFilled: state.aiFilled, ...(unsure?.length ? { unsure } : {}) };
  // 伺った項目の答えがなく、ご依頼の内容（「畳は6枚、襖は押入れが2枚です」「一番安いのでお願いします」）を話された：
  // 決まった文で伺い直すだけにせず、その内容に先に答えてから伺う（一畳屋様のご指摘 2026-10-29「会話が成立してない」EST-20261029-KIJJ）
  const gotAsked = filledNow(state.draft, draft).some((f) => asked.includes(f));
  if (!starting && !gotAsked && !cancel && CONSULT_TALK.test(last.normalize("NFKC"))) question = true;
  // 最初の見積のご依頼に品物が入っていて、まだ料金をご案内していない：先に目安をご案内してからお名前を伺う（同じ返事の中で）
  // （「団地を退去するので、畳と襖の見積もりをお願いしたい」→ 資料の「退去に伴う…の問い合わせは AI 窓口で完結させ…金額を伝える」）
  const priced = history.some((m) => m.role === "assistant" && /\d[\d,]*円/.test(m.content));
  if (starting && !offered && wantsEstimate(last) && !priced && JOB_WORD.test(last)) question = true;

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

  // ご住所が営業エリアの外：配送費が別途かかることを伝える（一畳屋様のご指摘 2026-10-30「配送費のことを説明せずに受け付けた」。area.ts）
  const got = filledNow(state.draft, draft);
  const areaNote =
    got.includes("address") && draft.address && areaOf(draft.address, serviceAreaFrom((await getKnowledge()).entries)) === "out" ? outOfAreaNote(draft.address) : "";

  // 4. 足りない項目を伺う／そろったら確認画面へ
  let needs = intakeNeeds(draft, asked, state.draft);
  // お名前を 2 回伺っても読み取れなかった：それ以上は伺わずに先へ進む（確認画面で入力していただく。
  // 一畳屋様のご指摘 2026-10-30「何度も名前を聞かれ先に進めない」）
  const nameAsks = history.filter((m) => m.role === "assistant" && NAME_ASK.test(m.content)).length;
  const skipName = needs.includes("name") && nameAsks >= 2;
  if (skipName) needs = needs.filter((f) => f !== "name");
  const carried = skipName ? { ...carry, unsure: [...new Set([...(unsure ?? []), "name" as IntakeField])] } : carry;
  const nameLater = skipName ? "お名前は、このあと表示される確認画面でご入力ください。" : "";
  if (needs.length === 0) {
    if (!draft.summary) draft = { ...draft, summary: extractFromConversation(messages, today).summary || undefined };
    const ready = intakeReadyText(draft, job);
    return {
      reply: [answer, areaNote, nameLater, ready].filter(Boolean).join("\n\n"),
      state: { ...carried, active: false, ready: true, asked: [], draft, summaryAt: messages.length },
      mode,
      sources,
    };
  }
  const q = intakeQuestion(draft, { needs, start: starting, offered, got, past, today, callName });
  const ask = [areaNote, nameLater, q.text].filter(Boolean).join("\n");
  const reply = !answer ? ask : starting ? `${answer}\n\n${ask}` : `${answer}\n\n（お見積りのご依頼の続きです）\n${ask.replace(/^ありがとうございます。/, "")}`;
  return {
    reply,
    state: { ...carried, active: true, ready: false, asked: q.asked, draft, summaryAt: draft.summary ? messages.length : state.summaryAt },
    mode,
    sources,
  };
}

/** AI がお名前を伺った文（intakeQuestion の「お名前を教えていただけますか？」など） */
const NAME_ASK = /お名前を(?:教えて|お願い|もう一度|伺)/;
