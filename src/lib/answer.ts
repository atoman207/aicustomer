// 回答エンジン：OpenAI を使うのは「学習済みのナレッジだけでは答えきれない質問」に限る
//   1. あいさつ・お礼                → 定型文
//   2. 料金の質問                    → 料金表から直接（price.ts）。数量があれば合計の目安を計算（quote.ts）
//   3. 「○○町は来てもらえる？」      → 営業範囲から直接（area.ts）
//   4. 以前に AI が作った回答（学習済み）で、根拠のナレッジが変わっていない → その回答
//   5. 関係するナレッジが見つからない  → 「担当者より折り返し」の定型文（管理画面の「答えられなかった質問」に記録）
//   6. それ以外                       → スプレッドシート・ホームページの関係する部分だけを渡して OpenAI が回答（回答は学習して次回から再利用）
import { answerArea } from "./area";
import { env } from "./env";
import { entryHash, getKnowledge } from "./knowledge";
import { findLearned, logUnanswered, questionKey, saveLearned } from "./learned";
import { OTHER_INTENT, PRICE_INTENT, answerPrice, normPrice, sliceTableForQuestion, voiceClean, type AnswerStyle } from "./price";
import { answerQuote } from "./quote";
import { hybridSearch, keywordSearch } from "./retrieval";
import { recordAnswer, type AnswerOriginKind } from "./usage";
import type { Channel, ChatMessage, KnowledgeEntry, KnowledgeSnapshot, SearchHit } from "./types";
import { truncate } from "./utils";

export interface AnswerSource {
  id: string;
  title: string;
  category: string;
  origin?: string;
  score: number;
}

export interface AnswerPlan {
  /** 回答の出どころ（openai 以外は OpenAI を使っていない） */
  mode: AnswerOriginKind;
  kind: "price" | "area" | "learned" | "smalltalk" | "notfound" | "search" | "llm";
  /** mode が openai 以外のときの回答文 */
  reply: string;
  query: string;
  key: string;
  standalone: boolean;
  style: AnswerStyle;
  channel: Channel;
  sources: AnswerSource[];
  hits: SearchHit[];
  /** mode が openai のときに AI へ渡す参考情報（関係するナレッジだけ） */
  context: string;
  snapshot: KnowledgeSnapshot;
}

export const NOT_FOUND_REPLY =
  "恐れ入りますが、その件はこの場で正確にお答えできかねます。担当者より折り返しご案内いたしますので、ご希望の場合はお見積り・折り返しのご依頼から承ります。畳・襖・障子・網戸や住まいのリフォームのことでしたら、ほかにもお気軽にお尋ねください。";

const NOT_FOUND_VOICE =
  "恐れ入りますが、その件はこの場で正確にお答えできかねますので、担当者より折り返しご案内いたします。ご希望でしたら、お見積りや折り返しのご依頼を承ります。";

const SMALLTALK: { re: RegExp; reply: string }[] = [
  { re: /^(こんにちは|こんばんは|おはよう(ございます)?|はじめまして|どうも|もしもし|よろしく(お願い(します|いたします))?)[!！。、…〜ー]*$/, reply: "こんにちは。一畳屋のAI相談員です。料金の目安や工期、対応エリアなど、お気軽にご質問ください。" },
  { re: /^(ありがとう(ございます|ございました)?|助かりました|わかりました|分かりました|了解(です|しました)?|ok|おけ|なるほど)[!！。、…〜ー]*$/i, reply: "どういたしまして。ほかにもご不明な点があれば、お気軽にお尋ねください。" },
  { re: /^(さようなら|失礼します|またね|では(また)?|以上です)[!！。、…〜ー]*$/, reply: "ご相談ありがとうございました。またいつでもお気軽にご相談ください。" },
];

const ORIGIN_LABEL: Record<string, string> = {
  manual: "顧客対応マニュアル（Googleスプレッドシート）",
  website: "ホームページ",
};

function toSource(h: SearchHit): AnswerSource {
  return { id: h.entry.id, title: h.entry.title, category: h.entry.category, origin: h.entry.origin, score: Math.round(h.score * 100) / 100 };
}

/** 話題の語（「8畳」の畳は数量なので話題にしない） */
const TOPIC = /((?<![\d０-９一二三四五六七八九十半])畳|たたみ|襖|ふすま|障子|網戸|アミ戸|ヘリ|縁|クロス|カーテン|ブラインド|店|営業|エリア|見積|工期|日数|土日|祝日|ショールーム|イベント|リフォーム)/;

function isFollowUp(text: string): boolean {
  const q = text.trim();
  const short = q.replace(/[\s?？。！!]/g, "").length <= 12;
  const anaphor = /^(じゃあ|では|それ|その|あと|ちなみに|なら|だと|ほか|他に|それぞれ|両方|どちら|やっぱり|やはり)/.test(q);
  return (short || anaphor) && !TOPIC.test(q);
}

/**
 * 「じゃあ両面は？」「何日かかる？」「8畳だと？」のような続きの質問は、前の質問とあわせて検索する。
 * 話題（畳の表替え など）は前の質問から、聞きたいこと（料金・工期 など）は一番新しい質問から取る
 * （「6畳の表替えはいくら？」→「何日かかる？」→「8畳だと？」は、表替えの工期の質問）。
 */
function expandQuery(question: string, history: ChatMessage[]): { query: string; standalone: boolean } {
  const q = question.trim();
  const users = history.filter((m) => m.role === "user").map((m) => m.content.trim()).filter((c) => c && c !== q);
  if (!users.length || !isFollowUp(q)) return { query: question, standalone: true };
  const parts: string[] = [];
  for (const prev of [...users].reverse()) {
    parts.unshift(prev);
    if (!isFollowUp(prev) || parts.length >= 3) break;
  }
  const chain = [...parts, q];
  const intentOf = (s: string) => {
    const n = normPrice(s);
    if (OTHER_INTENT.test(n) && !PRICE_INTENT.test(n)) return "other";
    return PRICE_INTENT.test(n) ? "price" : null;
  };
  const latest = [...chain].reverse().map(intentOf).find(Boolean);
  const older = parts.map((p) => {
    if (latest === "other") return p.replace(new RegExp(PRICE_INTENT.source, "g"), "");
    if (latest === "price") return p.replace(new RegExp(OTHER_INTENT.source, "g"), "");
    return p;
  });
  return { query: [...older, q].join(" "), standalone: false };
}

/** 質問から言い回し（ありますか・できますか・してもらえますか・教えてください など）を除いた語 */
function contentQuery(q: string): string {
  let s = questionKey(q)
    .replace(/(はあり|がありま|ありま|あり|でき|できま|してもらえ|してもらえま|もらえ|いただけ|頂け|お願いでき|でしょう|教えてくだ|教えて|知りた|について|とは|って|って何|ってなに)$/g, "")
    .replace(/(は|が|を|も|の|に|で)$/g, "");
  // 「支払方法は何が」「色はどんな」などの聞き方の語を除く（キーワードの照合が言い回しに引っぱられないように）
  for (let i = 0; i < 3; i++) s = s.replace(/(?:は|には|では|って)(?:何|なに|どう|どんな|どれ|どこ|いくつ)(?:が|か|を)?$/, "");
  return s.length >= 2 ? s : questionKey(q) || q;
}

function manualText(snapshot: KnowledgeSnapshot): string {
  return snapshot.entries
    .filter((e) => e.origin === "manual")
    .map((e) => e.content)
    .join("\n");
}

/** AI に渡す参考情報（関係するナレッジだけを、合計 3,000 字ほどに） */
function buildContext(hits: SearchHit[], snapshot: KnowledgeSnapshot, query: string): string {
  const blocks: string[] = [];
  let total = 0;
  hits.forEach((h, i) => {
    const e = h.entry;
    let body = e.content;
    const table = snapshot.tables.find((t) => t.id === e.id);
    if (table) body = sliceTableForQuestion(table, query) ?? truncate(e.content, 1400);
    else body = truncate(body, 800);
    const block = `[${i + 1}] ${ORIGIN_LABEL[e.origin ?? ""] ?? e.category}｜${e.title}\n${body}`;
    if (total + block.length > 3200 && blocks.length > 0) return;
    blocks.push(block);
    total += block.length;
  });
  return blocks.join("\n\n");
}

/** ナレッジ検索の結果からの回答（OpenAI 未設定のデモモード用） */
function demoReply(hits: SearchHit[], snapshot: KnowledgeSnapshot, query: string, style: AnswerStyle): string {
  const top = hits[0];
  const table = snapshot.tables.find((t) => t.id === top.entry.id);
  const body = table ? (sliceTableForQuestion(table, query) ?? top.entry.content) : top.entry.content;
  const text = `「${top.entry.title.replace(/^.*｜/, "")}」についてご案内します。\n${truncate(body, 900)}`;
  return style === "voice" ? voiceClean(truncate(text.replace(/\n/g, " "), 260)) : text;
}

function finish(plan: AnswerPlan): AnswerPlan {
  if (plan.mode !== "openai") void recordAnswer(plan.mode);
  if (plan.mode === "notfound") void logUnanswered(plan.query, plan.channel);
  return plan;
}

/**
 * 質問への回答方法を決める。OpenAI が必要なとき（mode === "openai"）は context に参考情報が入る。
 * 呼び出し側は回答後に learnAnswer() を呼ぶと、その回答が次回から再利用される。
 */
export async function planAnswer(
  question: string,
  history: ChatMessage[],
  opts: { channel: Channel; style?: AnswerStyle; allowLLM?: boolean },
): Promise<AnswerPlan> {
  const style: AnswerStyle = opts.style ?? (opts.channel === "web_text" || opts.channel === "line" ? "text" : "voice");
  const snapshot = await getKnowledge();
  const q = question.trim();
  const { query, standalone } = expandQuery(q, history);
  const key = questionKey(q);
  const base = { query, key, standalone, style, channel: opts.channel, snapshot, context: "", hits: [] as SearchHit[], sources: [] as AnswerSource[] };
  const llm = env.hasOpenAI && opts.allowLLM !== false;

  // 1. あいさつ・お礼
  const plain = q.normalize("NFKC").replace(/\s+/g, "");
  const talk = SMALLTALK.find((s) => s.re.test(plain));
  if (talk) return finish({ ...base, mode: "smalltalk", kind: "smalltalk", reply: talk.reply });

  // 2. 料金表（数量があれば合計の目安を計算。「やっぱり8畳で」などの訂正もそれまでの発言から反映）
  // 続きの質問は、前の質問とあわせた query でも料金表を探す（ただし今の質問が工期などなら料金表では答えない）
  const nq = normPrice(q);
  const otherNow = OTHER_INTENT.test(nq) && !PRICE_INTENT.test(nq);
  const price =
    answerQuote(q, history, snapshot.tables, style) ??
    answerPrice(q, snapshot.tables, style) ??
    (standalone || otherNow ? null : answerPrice(query, snapshot.tables, style));
  if (price) {
    const sources = price.tableIds
      .map((id) => snapshot.entries.find((e) => e.id === id))
      .filter((e): e is KnowledgeEntry => Boolean(e))
      .map((e) => ({ id: e.id, title: e.title, category: e.category, origin: e.origin, score: 1 }));
    return finish({ ...base, mode: "local", kind: "price", reply: price.reply, sources });
  }

  // 3. 営業範囲（○○町は対応？）
  const area = answerArea(q, manualText(snapshot));
  if (area) {
    const src = snapshot.entries.find((e) => e.id === "c-area") ?? snapshot.entries.find((e) => /営業範囲/.test(e.content));
    return finish({ ...base, mode: "local", kind: "area", reply: area.reply, sources: src ? [{ id: src.id, title: src.title, category: src.category, origin: src.origin, score: 1 }] : [] });
  }

  // 4. 学習済みの回答（同じ質問に以前 AI が答えたもの）
  if (standalone && key) {
    const valid = new Set(snapshot.entries.map(entryHash));
    const learned = await findLearned(key, style, valid);
    if (learned) {
      return finish({
        ...base,
        mode: "cache",
        kind: "learned",
        reply: learned.answer,
        sources: learned.sources.map((s) => ({ id: s.id, title: s.title, category: "学習済み", score: 1 })),
      });
    }
  }

  // 5. 関係するナレッジの検索（OpenAI があれば意味の近さも使う）
  // キーワードの照合は「ありますか」「できますか」などの言い回しを除いた語で行う（どの項目にも当たる語で誤って一致しないように）
  // 料金の質問でなければ料金表は探さない（料金表は「表替え」などの語が多く、工期などの質問で文章より上に来てしまうため）
  const pool = PRICE_INTENT.test(normPrice(q)) ? snapshot.entries : snapshot.entries.filter((e) => !snapshot.tables.some((t) => t.id === e.id));
  const find = async (text: string) => (llm ? (await hybridSearch(text, pool, 5, contentQuery(text))).hits : keywordSearch(contentQuery(text), pool, 5, 0.2));
  let hits = await find(query);
  // 続きの質問（「8畳だと？」）で見つからなければ、話題を持つ前の質問だけで探し直す
  if (!hits.length && !standalone && query.endsWith(q)) {
    const before = query.slice(0, query.length - q.length).trim();
    if (before) hits = await find(before);
  }
  const sources = hits.map(toSource);
  if (hits.length === 0) {
    return finish({ ...base, mode: "notfound", kind: "notfound", reply: style === "voice" ? NOT_FOUND_VOICE : NOT_FOUND_REPLY });
  }
  if (!llm) {
    return finish({ ...base, mode: env.hasOpenAI ? "local" : "demo", kind: "search", reply: demoReply(hits, snapshot, query, style), sources, hits });
  }
  // 6. OpenAI（参考情報は関係するものだけ）
  return { ...base, mode: "openai", kind: "llm", reply: "", sources, hits, context: buildContext(hits, snapshot, query) };
}

/** OpenAI が作った回答を学習する（答えられなかった場合は「答えられなかった質問」に記録） */
export async function learnAnswer(plan: AnswerPlan, reply: string): Promise<void> {
  void recordAnswer("openai");
  const text = reply.trim();
  if (!text) return;
  if (/お答えできかねます/.test(text)) {
    await logUnanswered(plan.query, plan.channel);
    return;
  }
  if (!plan.standalone || !plan.key || text.length < 8) return;
  await saveLearned({
    key: plan.key,
    question: plan.query.slice(0, 300),
    answer: text.slice(0, 2000),
    sources: plan.hits.slice(0, 5).map((h) => ({ id: h.entry.id, title: h.entry.title, hash: entryHash(h.entry) })),
    style: plan.style,
    channel: plan.channel,
  });
}
