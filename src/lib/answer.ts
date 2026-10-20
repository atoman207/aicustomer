// 回答エンジン：OpenAI を使うのは「学習済みのナレッジだけでは答えきれない質問」に限る
//   1. あいさつ・お礼                → 定型文
//   2. 料金の質問                    → 料金表から直接（price.ts）
//   3. 「○○町は来てもらえる？」      → 営業範囲から直接（area.ts）
//   4. 会社情報・よくある質問に当てはまる → 登録済みの回答をそのまま
//   5. 以前に AI が作った回答（学習済み）で、根拠のナレッジが変わっていない → その回答
//   6. 関係するナレッジが見つからない  → 「担当者より折り返し」の定型文（管理画面の「答えられなかった質問」に記録）
//   7. それ以外                       → 関係するナレッジ数件だけを渡して OpenAI が回答（回答は学習して次回から再利用）
import { answerArea } from "./area";
import { env } from "./env";
import { entryHash, getKnowledge } from "./knowledge";
import { findLearned, logUnanswered, questionKey, saveLearned } from "./learned";
import { answerPrice, normPrice, sliceTableForQuestion, voiceClean, type AnswerStyle } from "./price";
import { hybridSearch, keywordScore, keywordSearch } from "./retrieval";
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
  kind: "price" | "area" | "faq" | "learned" | "smalltalk" | "notfound" | "search" | "llm";
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

const ORIGIN_LABEL: Record<string, string> = { manual: "顧客対応マニュアル", company: "会社情報", website: "ホームページ", admin: "管理画面で追加" };

function toSource(h: SearchHit): AnswerSource {
  return { id: h.entry.id, title: h.entry.title, category: h.entry.category, origin: h.entry.origin, score: Math.round(h.score * 100) / 100 };
}

/** 「じゃあ両面は？」のような続きの質問は、直前の質問とあわせて検索する */
function expandQuery(question: string, history: ChatMessage[]): { query: string; standalone: boolean } {
  const prev = [...history].reverse().filter((m) => m.role === "user").map((m) => m.content.trim()).find((c) => c && c !== question.trim());
  if (!prev) return { query: question, standalone: true };
  const q = question.trim();
  const short = q.replace(/[\s?？。！!]/g, "").length <= 12;
  const anaphor = /^(じゃあ|では|それ|その|あと|ちなみに|なら|だと|ほか|他に|それぞれ|両方|どちら)/.test(q);
  const hasTopic = /(畳|たたみ|襖|ふすま|障子|網戸|アミ戸|ヘリ|縁|クロス|カーテン|ブラインド|店|営業|エリア|見積|工期|日数|土日|祝日|ショールーム|イベント|リフォーム)/.test(q);
  return (short || anaphor) && !hasTopic ? { query: `${prev} ${q}`, standalone: false } : { query: question, standalone: true };
}

/** 質問から言い回し（ありますか・できますか・してもらえますか・教えてください など）を除いた語 */
function contentQuery(q: string): string {
  const s = questionKey(q)
    .replace(/(はあり|がありま|ありま|あり|でき|できま|してもらえ|してもらえま|もらえ|いただけ|頂け|お願いでき|でしょう|教えてくだ|教えて|知りた|について|とは|って|って何|ってなに)$/g, "")
    .replace(/(は|が|を|も|の|に|で)$/g, "");
  return s.length >= 2 ? s : questionKey(q) || q;
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 2 <= s.length; i++) out.add(s.slice(i, i + 2));
  if (s.length === 1) out.add(s);
  return out;
}

/** 2 つの質問の近さ（文字の 2 文字組の重なり。0〜1） */
function similarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let n = 0;
  A.forEach((x) => {
    if (B.has(x)) n++;
  });
  return (2 * n) / (A.size + B.size);
}

/**
 * 会社情報・管理画面で追加したナレッジのうち、質問にはっきり当てはまるもの。
 * 「お客様の聞き方の例（questions）」との近さを主に、キーワードの一致も合わせて判定する。
 */
/** 商品の種類（「ヘリ無し畳」「ヘリ付き」は畳として数える） */
const PRODUCT_FAMILIES = ["畳", "襖", "障子", "網戸", "ヘリ"];
function productFamilies(text: string): string[] {
  const n = normPrice(text).replace(/ヘリ(無し|有り)/g, "");
  return PRODUCT_FAMILIES.filter((f) => n.includes(f));
}

function matchFaq(query: string, entries: KnowledgeEntry[]): SearchHit | null {
  const qk = questionKey(query);
  if (!qk) return null;
  // 質問と違う商品の項目には答えない（「障子紙の違い」に襖紙の項目、「網戸」に障子の項目、など）
  const asked = productFamilies(query);
  const candidates = entries.filter((e) => {
    if (e.origin !== "company" && e.origin !== "admin") return false;
    if (!asked.length) return true;
    const own = productFamilies(`${e.title} ${(e.questions ?? []).join(" ")}`);
    return own.length === 0 || own.some((f) => asked.includes(f));
  });
  const scored = candidates
    .map((entry) => {
      const ex = Math.max(0, ...(entry.questions ?? []).map((x) => similarity(qk, questionKey(x))));
      const kw = keywordScore(query, entry);
      return { entry, ex, kw, score: Math.max(ex, kw * 0.9) };
    })
    .sort((a, b) => b.score - a.score);
  const [a, b] = scored;
  if (!a) return null;
  const margin = a.score - (b?.score ?? 0);
  if (a.ex >= 0.62 && margin >= 0.04) return { entry: a.entry, score: a.score };
  if (a.ex >= 0.5 && a.kw >= 0.3 && margin >= 0.06) return { entry: a.entry, score: a.score };
  if (a.kw >= 0.5 && margin >= 0.06) return { entry: a.entry, score: a.score };
  return null;
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

  // 2. 料金表
  const price = answerPrice(q, snapshot.tables, style) ?? (standalone ? null : answerPrice(query, snapshot.tables, style));
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

  // 4. 会社情報・よくある質問
  const faq = matchFaq(query, snapshot.entries);
  if (faq) {
    const reply = style === "voice" ? voiceClean(faq.entry.content) : faq.entry.content;
    return finish({ ...base, mode: "local", kind: "faq", reply, sources: [toSource(faq)], hits: [faq] });
  }

  // 5. 学習済みの回答（同じ質問に以前 AI が答えたもの）
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

  // 6. 関係するナレッジの検索（OpenAI があれば意味の近さも使う）
  // キーワードの照合は「ありますか」「できますか」などの言い回しを除いた語で行う（どの項目にも当たる語で誤って一致しないように）
  const kq = contentQuery(query);
  const search = llm ? await hybridSearch(query, snapshot.entries, 5, kq) : { hits: keywordSearch(kq, snapshot.entries, 5, 0.2), mode: "keyword" as const };
  const hits = search.hits;
  const sources = hits.map(toSource);
  if (hits.length === 0) {
    return finish({ ...base, mode: "notfound", kind: "notfound", reply: style === "voice" ? NOT_FOUND_VOICE : NOT_FOUND_REPLY });
  }
  if (!llm) {
    return finish({ ...base, mode: env.hasOpenAI ? "local" : "demo", kind: "search", reply: demoReply(hits, snapshot, query, style), sources, hits });
  }
  // 7. OpenAI（参考情報は関係するものだけ）
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
