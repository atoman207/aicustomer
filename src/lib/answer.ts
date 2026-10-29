// 回答エンジン（2026-10-23〜：NotebookLM と同じく、指定のスプレッドシートの全文を AI が読んで答える）
//   1. あいさつ・お礼 → 定型文
//   2. それ以外（料金・工期・営業範囲・店舗など、事実の質問はすべて）→ AI（OPENAI_ANSWER_MODEL）が資料の全文を読み、
//      根拠の文を書き写してから答える。料金に数量があるとき（「8畳だと？」）は、料金表からシステムが計算した合計を
//      「参考」として添える（品目・作業・数量が質問と合うときだけ AI が使う）
//   料金表から直接の回答（price.ts）・営業範囲の判定（area.ts）は、品目の取り違え（「1枚」で襖の枠交換を
//   答えるなど）が起きたため、AI を使えないとき（デモモード・ANSWER_CONTEXT=search）だけに使う。
//   3. 同じ質問（AI に渡す内容とお客様の質問がまったく同じ）には、前に AI が作った回答をそのまま使う（learned.ts・トークンの節約）。
//      照合は呼び出し側（文字の相談のストリーミング・composeAnswer）で、AI に渡す直前の指示と会話で行う
import { answerArea } from "./area";
import { env } from "./env";
import { logError } from "./errorlog";
import { getKnowledge } from "./knowledge";
import { findLearned, learnedKey, logUnanswered, questionKey, saveLearned, type LearnedAnswer } from "./learned";
import { canRetryWithChatModel, chatCompletionResult } from "./openai";
import { OTHER_INTENT, PRICE_INTENT, answerPrice, normPrice, sliceTableForQuestion, tableUnit, voiceClean, type AnswerStyle } from "./price";
import { DOCUMENT_HEADING, buildChatSystemPrompt, splitEvidence, usesEvidence } from "./prompts";
import { quantityReference } from "./quantity";
import { answerQuote } from "./quote";
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
  kind: "price" | "area" | "learned" | "smalltalk" | "notfound" | "search" | "llm";
  /** mode が openai 以外のときの回答文 */
  reply: string;
  /** お客様の質問（そのまま） */
  question: string;
  query: string;
  key: string;
  standalone: boolean;
  style: AnswerStyle;
  channel: Channel;
  sources: AnswerSource[];
  hits: SearchHit[];
  /** mode が openai のときに AI へ渡す参考情報（資料の全文、または関係するナレッジだけ） */
  context: string;
  /** context が資料の全文か（学習した回答は、資料のどこかが変われば使わない） */
  fullContext: boolean;
  snapshot: KnowledgeSnapshot;
}

export const NOT_FOUND_REPLY =
  "恐れ入りますが、その件はこの場では正確にお答えできかねます。担当者より折り返しご案内いたします。\n折り返しやお見積りをご希望の場合は、「見積をお願いします」と送ってください。お名前やご連絡先を伺います。\n畳・襖・障子・網戸や住まいのリフォームのことでしたら、ほかにもお気軽にお尋ねください。";

const NOT_FOUND_VOICE =
  "恐れ入りますが、その件はこの場では正確にお答えできかねますので、担当者より折り返しご案内いたします。ご希望でしたら、お見積りや折り返しのご依頼を承ります。";

const SMALLTALK: { re: RegExp; reply: string }[] = [
  { re: /^(こんにちは|こんばんは|おはよう(ございます)?|はじめまして|どうも|もしもし|よろしく(お願い(します|いたします))?)[!！。、…〜ー]*$/, reply: "こんにちは。一畳屋のAI相談員です。料金の目安や工期、対応エリアなど、お気軽にご質問ください。" },
  { re: /^(ありがとう(ございます|ございました)?|助かりました|わかりました|分かりました|了解(です|しました)?|ok|おけ|なるほど)[!！。、…〜ー]*$/i, reply: "どういたしまして。ほかにもご不明な点があれば、お気軽にお尋ねください。" },
  { re: /^(さようなら|失礼します|またね|では(また)?|以上です)[!！。、…〜ー]*$/, reply: "ご相談ありがとうございました。またいつでもお気軽にご相談ください。" },
];

/** OpenAI に渡す参考情報の見出し（同じ内容はスプレッドシートが正であることを明示） */
const CONTEXT_LABEL: Record<string, string> = {
  manual: "スプレッドシート（正）",
  website: "ホームページ（補足）",
};

/**
 * スプレッドシートを正にする：ホームページの項目と同じ話題（畳・襖・障子・網戸・店舗・会社・工期）の
 * スプレッドシートの項目を、そのホームページの項目より前に置く。検索に出ていなければ、同じ話題で質問に
 * いちばん近い項目を足す（最大 2 件。検索と同じ範囲から＝料金の質問でなければ料金表は足さない）。
 * 話題がホームページにしかないもの（スタッフの紹介など）はそのまま
 */
function preferSheet(hits: SearchHit[], pool: KnowledgeEntry[], query: string): SearchHit[] {
  if (!hits.some((h) => h.entry.origin === "website" && h.entry.topics?.length)) return hits;
  const kq = contentQuery(query);
  const out: SearchHit[] = [];
  const used = new Set<string>();
  let added = 0;
  const push = (h: SearchHit) => {
    if (used.has(h.entry.id)) return;
    used.add(h.entry.id);
    out.push(h);
  };
  for (const h of hits) {
    const topics = h.entry.origin === "website" ? (h.entry.topics ?? []) : [];
    // 話題ごとに：検索に出ているスプレッドシートの項目を先に。出ていなければ、その話題で質問にいちばん近い項目を足す
    for (const t of topics) {
      const same = (e: KnowledgeEntry) => e.origin !== "website" && (e.topics ?? []).includes(t);
      const inHits = hits.filter((x) => same(x.entry));
      inHits.forEach(push);
      if (inHits.length || added >= 2) continue;
      const best = pool
        .filter((e) => same(e) && !used.has(e.id))
        .map((e) => ({ entry: e, score: keywordScore(kq, e) }))
        .sort((a, b) => b.score - a.score)[0];
      if (best && best.score >= 0.1) {
        push(best);
        added++;
      }
    }
    push(h);
  }
  return out;
}

/**
 * OpenAI を使わずに答えるときに使う項目：スプレッドシートを先に並べた順で、いちばん近い項目と同じくらい近いもの
 * （ホームページにしかない内容の質問＝スタッフの紹介などは、ホームページの項目で答える）
 */
function bestForReply(hits: SearchHit[]): SearchHit {
  const top = Math.max(...hits.map((h) => h.score));
  return hits.find((h) => h.score >= top * 0.85) ?? hits[0];
}

function toSource(h: SearchHit): AnswerSource {
  return { id: h.entry.id, title: h.entry.title, category: h.entry.category, origin: h.entry.origin, score: Math.round(h.score * 100) / 100 };
}

/**
 * 料金と一緒に聞かれた、料金表では答えられないこと（「6畳の表替えはいくらで、何日かかる？」の工期・耐用年数・おすすめ・違い など）。
 * 資料の全文で答えるときは、料金はシステムが計算した目安のまま、ほかのことは AI が資料から答える
 */
const WITH_PRICE_OTHER = /(何日|日数|工期|期間|仕上が|納期|終わ|いつ|何年|年数|耐用|寿命|長持ち|もちます|持ちます|おすすめ|オススメ|人気|違い|特徴|支払|土日)/;

/**
 * 数量のある料金の質問に添える、システムの計算の見出し。計算は品目・数量の読み取りを誤ることがあるので、
 * AI が質問と照らし合わせて、合っているときだけ使う
 */
const QUOTE_REFERENCE_HEADING =
  "## 参考：この質問の数量で、料金表からシステムが計算した見積の目安（半畳の8掛けなど料金表の注記も反映済み。品目・作業・数量・種類が質問と合っているときだけ使い、合っていれば金額はこのとおりに伝える。ヘリ代や諸経費を含む・含まないの区別もこのとおりに書く）";

/** 畳の大きさ（江戸間・京間など）で料金が変わるかの質問 */
const SIZE_PRICE = /(江戸間|京間|本間|団地間|中京間|五八|六一).{0,20}(安|高|違|変わ|同じ)|(安|高|違|変わ|同じ).{0,12}(江戸間|京間|本間|団地間|中京間)/;

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
/** ホームページの文の金額（「11,000」「3300円」「¥27,500」）。寸法（185×92cm）や年は残す */
const SITE_AMOUNT = /[¥￥]?\d{1,3}(?:,\d{3})+(?:\s*円)?(?:\s*[〜~～]\s*)?|\d{3,6}\s*円(?:\s*[〜~～])?/g;
const hasAmount = (s: string) => /\d{1,3},\d{3}|\d{3,6}\s*円/.test(s.normalize("NFKC"));

/**
 * OpenAI に渡す参考情報。料金はスプレッドシートの料金表が正なので、
 * 同じ話題の料金表がスプレッドシートにあるときは、ホームページの項目から金額を消し、その料金表を前に入れる
 * （ホームページの「ワーロン柄入り 11,000」を料金表の「ワーロンシート 9,900円」より優先して答えないように）
 */
function buildContext(hits: SearchHit[], snapshot: KnowledgeSnapshot, query: string): string {
  const tableIds = new Set(snapshot.tables.map((t) => t.id));
  const inHits = new Set(hits.map((h) => h.entry.id));
  const kq = contentQuery(query);
  const list: { entry: KnowledgeEntry; priceFromSheet?: boolean }[] = [];
  const addedTables = new Set<string>();
  for (const h of hits) {
    const e = h.entry;
    if (e.origin === "website" && hasAmount(e.content) && e.topics?.length) {
      const sheetTables = snapshot.entries.filter((x) => tableIds.has(x.id) && (x.topics ?? []).some((t) => e.topics!.includes(t)));
      if (sheetTables.length) {
        // 同じ話題で質問（とこの項目の見出し）にいちばん近い料金表を、まだなければ先に入れる
        if (!sheetTables.some((t) => inHits.has(t.id) || addedTables.has(t.id))) {
          const best = sheetTables
            .map((t) => ({ t, s: keywordScore(`${kq} ${e.title.split("｜").slice(1).join(" ")}`, t) }))
            .sort((a, b) => b.s - a.s)[0].t;
          addedTables.add(best.id);
          list.push({ entry: best });
        }
        list.push({ entry: e, priceFromSheet: true });
        continue;
      }
    }
    list.push({ entry: e });
  }
  const blocks: string[] = [];
  let total = 0;
  list.forEach(({ entry: e, priceFromSheet }, i) => {
    let body = e.content;
    const table = snapshot.tables.find((t) => t.id === e.id);
    if (table) body = sliceTableForQuestion(table, query) ?? truncate(e.content, 1400);
    else if (priceFromSheet) body = `${truncate(body.normalize("NFKC").replace(SITE_AMOUNT, "").replace(/[ \t]{2,}/g, " "), 800)}\n（この項目の金額は使わない。料金はスプレッドシートの料金表のとおりに答える）`;
    else body = truncate(body, 800);
    const block = `[${i + 1}] ${CONTEXT_LABEL[e.origin ?? ""] ?? e.category}｜${e.title}\n${body}`;
    if (total + block.length > 3600 && blocks.length > 0) return;
    blocks.push(block);
    total += block.length;
  });
  return blocks.join("\n\n");
}

/** 資料の全文がこれより長くなったら、関係する部分だけを渡す（トークンと応答時間が増えすぎないように） */
const FULL_CONTEXT_MAX_CHARS = 150_000;
const docCache: { version: string; doc: string } = { version: "", doc: "" };

/**
 * 料金表の見方（資料の料金表を読むための、システムの補足。料金表の単位・税込・「時価」・行の名前の数の意味）。
 * 「襖の張替えは1枚いくら？」に、行の名前に「１枚」とある「枠交換（１枚）」を答えないように
 */
const PRICE_TABLE_GUIDE = `### 料金表の見方（システムの補足）
- 料金表の金額は税込みです。各料金表の見出しのかっこ内に、金額の単位（1畳あたり・1枚あたり など）を書いています。
- 畳の「表替え」は畳表の張替え、「新調」は畳床ごと新しくすること、「ウラ返し」は畳表の裏返しです。畳のヘリ（畳縁）代は畳の料金とは別で、ヘリの料金表も1畳あたりです。
- 行の名前の中の数（「枠交換（１枚）」「枠交換（１本）」など）は、その行の作業の単位です。その行は名前のとおりの作業（例：枠交換）の料金で、張替えの料金ではありません。
- 「時価」は金額が決まっていないもの（担当者が確認してご案内）です。
- 「諸経費3300円/一式」は、資料の料金表の最後（襖・障子・網戸の料金表の側と、畳の料金表の側の両方）に書かれている、工事全体に一式でかかる諸経費です。`;

/**
 * AI に渡す資料の全文（NotebookLM と同じく、資料全体を読んで答えるため）。中身は指定のスプレッドシートだけ（ホームページは使わない）。
 * 料金表は見出しに金額の単位を添える。ナレッジの版ごとに同じ文字列になるので、OpenAI のプロンプトキャッシュが効く
 */
export function knowledgeDocument(snapshot: KnowledgeSnapshot): string {
  if (docCache.version === snapshot.version && docCache.doc) return docCache.doc;
  const tableOf = new Map(snapshot.tables.map((t) => [t.id, t]));
  const sheet = snapshot.entries.filter((e) => e.origin !== "website");
  const block = (e: KnowledgeEntry) => {
    const t = tableOf.get(e.id);
    const unit = t ? tableUnit(t) : null;
    const title = t ? `${e.title}（料金表${unit ? `・金額は${unit}` : ""}）` : e.title;
    return `■ ${title}\n${e.content.trim()}`;
  };
  const doc = [`${DOCUMENT_HEADING}\n\n${PRICE_TABLE_GUIDE}`, ...sheet.map(block)].join("\n\n");
  docCache.version = snapshot.version;
  docCache.doc = doc;
  return doc;
}

/** ナレッジ検索の結果からの回答（OpenAI 未設定のデモモード用） */
function demoReply(hits: SearchHit[], snapshot: KnowledgeSnapshot, query: string, style: AnswerStyle): string {
  const top = bestForReply(hits);
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
  const base = { question: q, query, key, standalone, style, channel: opts.channel, snapshot, context: "", fullContext: false, hits: [] as SearchHit[], sources: [] as AnswerSource[] };
  const llm = env.hasOpenAI && opts.allowLLM !== false;
  const doc = llm && env.answerContext === "full" ? knowledgeDocument(snapshot) : "";
  const full = doc.length > 0 && doc.length <= FULL_CONTEXT_MAX_CHARS;

  // 1. あいさつ・お礼
  const plain = q.normalize("NFKC").replace(/\s+/g, "");
  const talk = SMALLTALK.find((s) => s.re.test(plain));
  if (talk) return finish({ ...base, mode: "smalltalk", kind: "smalltalk", reply: talk.reply });

  // 2. 資料の全文を AI が読んで答える（NotebookLM と同じ）。数量のある料金の質問だけ、システムが計算した合計を参考に添える
  if (full) {
    // 数量の計算表（単価×数量を種類ごとに。聞き方が違っても合計を出せるように）。半畳を含む数量（4畳半など）は、
    // 計算の決まりが多いので見積の計算（quote.ts）を添える。数量が 1（「1枚いくら」）は単価の質問なので計算は添えない
    const qty = SIZE_PRICE.test(normPrice(q)) ? null : quantityReference(q, history, snapshot.tables, manualText(snapshot));
    const quoted = qty || SIZE_PRICE.test(normPrice(q)) ? null : answerQuote(q, history, snapshot.tables, style);
    const quote = quoted && !quoted.single ? quoted : null;
    const hits = keywordSearch(contentQuery(query), snapshot.entries, 5, 0.2);
    const quoteSources = (quote?.tableIds ?? [])
      .map((id) => snapshot.entries.find((e) => e.id === id))
      .filter((e): e is KnowledgeEntry => Boolean(e))
      .map((e) => ({ id: e.id, title: e.title, category: e.category, origin: e.origin, score: 1 }));
    const sources = [...quoteSources, ...hits.map(toSource).filter((s) => !quoteSources.some((p) => p.id === s.id))];
    // 計算は資料の全文のあと（資料の部分が質問をまたいで同じ文字列になり、プロンプトキャッシュが効く）
    const calc = qty ? `\n\n${qty}` : quote ? `\n\n${QUOTE_REFERENCE_HEADING}\n${quote.reply}` : "";
    return { ...base, mode: "openai", kind: "llm", reply: "", sources, hits, fullContext: true, context: `${doc}${calc}` };
  }

  // ---- ここから下は、AI に資料の全文を渡せないとき（デモモード・ANSWER_CONTEXT=search）だけ ----
  // 3. 料金表（数量があれば合計の目安を計算。「やっぱり8畳で」などの訂正もそれまでの発言から反映）
  // 続きの質問は、前の質問とあわせた query でも料金表を探す（ただし今の質問が工期などなら料金表では答えない）
  const nq = normPrice(q);
  const otherNow = OTHER_INTENT.test(nq) && !PRICE_INTENT.test(nq);
  // 「江戸間だと京間より安い？」は料金表ではなく、資料の説明（大きさで金額は変わらない）で答える
  const sizeQuestion = SIZE_PRICE.test(nq);
  const price = sizeQuestion
    ? null
    : (answerQuote(q, history, snapshot.tables, style) ??
      answerPrice(q, snapshot.tables, style) ??
      (standalone || otherNow ? null : answerPrice(query, snapshot.tables, style)));
  let priced: { reply: string; sources: AnswerSource[] } | null = null;
  if (price) {
    const sources = price.tableIds
      .map((id) => snapshot.entries.find((e) => e.id === id))
      .filter((e): e is KnowledgeEntry => Boolean(e))
      .map((e) => ({ id: e.id, title: e.title, category: e.category, origin: e.origin, score: 1 }));
    if (!(full && PRICE_INTENT.test(nq) && WITH_PRICE_OTHER.test(nq))) return finish({ ...base, mode: "local", kind: "price", reply: price.reply, sources });
    // 料金と一緒にほかのこと（工期など）も聞かれた：料金はこの計算のまま AI に渡し、ほかのことは資料の全文から答えさせる
    priced = { reply: price.reply, sources };
  }

  // 4. 営業範囲（○○町は対応？）
  const area = answerArea(q, manualText(snapshot));
  if (area) {
    const src = snapshot.entries.find((e) => e.id === "c-area") ?? snapshot.entries.find((e) => /営業範囲/.test(e.content));
    return finish({ ...base, mode: "local", kind: "area", reply: area.reply, sources: src ? [{ id: src.id, title: src.title, category: src.category, origin: src.origin, score: 1 }] : [] });
  }

  // 5. 関係するナレッジの検索（OpenAI があれば意味の近さも使う）
  // キーワードの照合は「ありますか」「できますか」などの言い回しを除いた語で行う（どの項目にも当たる語で誤って一致しないように）
  // 料金の質問でなければ料金表は探さない（料金表は「表替え」などの語が多く、工期などの質問で文章より上に来てしまうため）
  const pool = PRICE_INTENT.test(normPrice(q)) ? snapshot.entries : snapshot.entries.filter((e) => !snapshot.tables.some((t) => t.id === e.id));
  // 資料の全文を渡すときは、検索は「根拠」の表示に使うだけなので、意味の近さ（OpenAI の埋め込み）は使わずキーワードで（速く・安く）
  const find = async (text: string) =>
    llm && !full ? (await hybridSearch(text, pool, 5, contentQuery(text))).hits : keywordSearch(contentQuery(text), pool, 5, 0.2);
  let hits = await find(query);
  // 続きの質問（「8畳だと？」）で見つからなければ、話題を持つ前の質問だけで探し直す
  if (!hits.length && !standalone && query.endsWith(q)) {
    const before = query.slice(0, query.length - q.length).trim();
    if (before) hits = await find(before);
  }
  // 同じ話題がスプレッドシートとホームページの両方にあるときは、スプレッドシートを先に（回答・参考の表示とも）
  hits = preferSheet(hits, pool, query);
  const sources = [...(priced?.sources ?? []), ...hits.map(toSource).filter((s) => !priced?.sources.some((p) => p.id === s.id))];
  // 資料の全文を読むときは、検索で見つからない言い回しの質問も AI が資料全体から探す（答えられなければ AI が折り返しを案内）
  if (hits.length === 0 && !full) {
    return finish({ ...base, mode: "notfound", kind: "notfound", reply: style === "voice" ? NOT_FOUND_VOICE : NOT_FOUND_REPLY });
  }
  if (!llm) {
    return finish({ ...base, mode: env.hasOpenAI ? "local" : "demo", kind: "search", reply: demoReply(hits, snapshot, query, style), sources, hits });
  }
  // 6. OpenAI（参考情報は関係するものだけ。検索の結果は「根拠」の表示に使う）
  // 料金の計算は資料の全文のあと（資料の部分が質問をまたいで同じ文字列になり、プロンプトキャッシュが効く）
  const calc = priced
    ? `\n\n## この質問の料金（料金表からシステムが計算した目安。金額・合計は、ヘリ代や諸経費を含む・含まないの区別も含めてこの文のとおりに伝え、計算し直さない）\n${priced.reply}`
    : "";
  return { ...base, mode: "openai", kind: "llm", reply: "", sources, hits, fullContext: full, context: full ? `${doc}${calc}` : buildContext(hits, snapshot, query) };
}

/** 回答のモデルと考える深さ（声の相談は、待ち時間が短くなるように別のモデル・考える深さにできる：OPENAI_VOICE_ANSWER_MODEL） */
export function answerModelFor(plan: AnswerPlan): { model: string; effort?: string } {
  if (!plan.fullContext) return { model: env.chatModel };
  return plan.style === "voice" ? { model: env.voiceAnswerModel, effort: env.voiceAnswerReasoning } : { model: env.answerModel, effort: env.answerReasoning };
}

/** お名前・電話番号・住所など、その人だけの内容を含む会話（学習済みの回答として保存も再利用もしない） */
const PERSONAL = /(?<![\d,])0\d{1,4}[-‐ー－(（]\d{1,4}[-‐ー－)）]\d{3,4}(?!\d)|(?<![\d,])0\d{9,10}(?![\d,])|[\w.+-]+@[\w-]+\.[\w.]+|様です|と申します|番地|丁目/;

/**
 * 学習済みの回答の照合キー（AI に渡す指示の全文・モデル・考える深さ・お客様の発言がまったく同じときだけ同じ）。
 * 保存も再利用もしない会話（その人だけの内容を含む・設定で使わない）は null
 */
export function learnedKeyFor(
  plan: AnswerPlan,
  ai: { model: string; effort?: string; system: string },
  messages: { role: "user" | "assistant"; content: string }[],
): string | null {
  if (!env.answerCache || plan.mode !== "openai") return null;
  const questions = messages.filter((m) => m.role === "user").map((m) => m.content);
  if (!questions.length || questions.some((q) => PERSONAL.test(q.normalize("NFKC")))) return null;
  return learnedKey({ ...ai, questions });
}

/** 学習済みの回答（同じ質問に前に AI が作った回答）があれば、その回答。利用状況と「答えられなかった質問」も記録する */
export async function learnedReply(plan: AnswerPlan, key: string | null): Promise<LearnedAnswer | null> {
  if (!key) return null;
  const hit = await findLearned(key);
  if (!hit) return null;
  void recordAnswer("cache");
  if (/お答えできかねます/.test(hit.answer)) void logUnanswered(plan.query, plan.channel);
  return hit;
}

/** 学習済みの回答の根拠を、回答の根拠の形に戻す（画面の「根拠」の表示用） */
export function learnedSources(hit: LearnedAnswer): AnswerSource[] {
  return hit.sources.map((s) => ({ id: s.id, title: s.title, category: s.category ?? "", score: 1 }));
}

/**
 * OpenAI で回答を作る（文字の相談のストリーミング以外：音声相談の search_knowledge・管理画面の回答テスト）。
 * 文字の相談と同じ指示・同じ参考情報で答え、回答は学習する（同じ質問には学習済みの回答をそのまま返す）
 */
export async function composeAnswer(
  plan: AnswerPlan,
  company: string,
  messages: { role: "user" | "assistant"; content: string }[],
  purpose: string,
  /** 指示の最後に足す（見積依頼の聞き取りの途中の答えでは、お見積りの提案をさせない など） */
  extraSystem?: string,
): Promise<string> {
  const evidence = usesEvidence(plan.context);
  const voice = plan.style === "voice";
  const { model, effort } = answerModelFor(plan);
  const system = `${buildChatSystemPrompt(company, plan.context, plan.channel, plan.snapshot.staffNotes?.text)}${extraSystem ? `\n\n${extraSystem}` : ""}`;
  const key = learnedKeyFor(plan, { model, effort, system }, messages);
  const learned = await learnedReply(plan, key);
  if (learned) return learned.answer;
  const ask = (m: string) =>
    chatCompletionResult({
      model: m,
      // 回答のモデルは設定の考える深さ。答え直しのモデル（gpt-5.6-sol）は考えずにすぐ答える
      reasoningEffort: m === model ? effort : m === env.answerFallbackModel ? "none" : undefined,
      messages: [{ role: "system", content: system }, ...messages],
      temperature: 0.3,
      // 料金の一覧なども省略せずに答えられる長さ（根拠の引用の分も）。声は短く
      maxTokens: voice ? (evidence ? 1600 : 700) : evidence ? 3000 : 2000,
      // 考える深さのあるモデルは時間がかかるので、待ち時間の上限を長めに
      timeoutMs: 90_000,
      purpose,
    });
  let raw: { text: string; finish: string };
  let primary = true;
  try {
    raw = await ask(model);
  } catch (e) {
    // 混み合っている・一時的な障害・この API キーでは使えないモデル：答え直しのモデルで答える（理由は管理画面のエラー履歴に）
    const backup = plan.fullContext ? env.answerFallbackModel : null;
    if (!backup || backup === model || !canRetryWithChatModel(e)) throw e;
    await logError("openai", `資料からの回答（${model} が使えないため ${backup} で回答）`, e);
    raw = await ask(backup);
    primary = false;
  }
  const reply = evidence ? splitEvidence(raw.text).answer : raw.text.trim();
  // 学習するのは、回答のモデルで最後まで書けた回答だけ（答え直しのモデルの回答・途中で切れた回答は次回は作り直す）
  await learnAnswer(plan, reply, primary && raw.finish === "stop" ? key : null);
  return reply;
}

/**
 * OpenAI が作った回答を記録する（答えられなかった場合は「答えられなかった質問」に）。
 * key（learnedKeyFor）があれば学習済みの回答として覚え、同じ質問には次回から AI を使わずに答える
 */
export async function learnAnswer(plan: AnswerPlan, reply: string, key?: string | null): Promise<void> {
  void recordAnswer("openai");
  const text = reply.trim();
  if (!text) return;
  if (/お答えできかねます/.test(text)) await logUnanswered(plan.query, plan.channel);
  if (!key || text.length < 8) return;
  await saveLearned({
    key,
    question: plan.question,
    answer: text,
    sources: plan.sources.slice(0, 6).map((s) => ({ id: s.id, title: s.title, category: s.category, hash: plan.snapshot.version })),
    style: plan.style,
    channel: plan.channel,
    docVersion: plan.snapshot.version,
  });
}
