// 料金の質問に、顧客対応マニュアルの料金表から直接答える（OpenAI を使わない）
//   ・どの表か（畳・襖・障子・網戸 など）、どの品名か（古都・朱雀 など）、どの列か（表替え・両面・大 など）を判定
//   ・表の行にない内容（処分費・ダニ対策など）は、その表の注記から答える
//   ・概算の合計は出さず、単価と関連する注記・諸経費を添える（正式なお見積りは現地確認後）
import { formatValue, type PriceRow, type PriceTable } from "./manual";

export type AnswerStyle = "text" | "voice";

export interface PriceAnswer {
  reply: string;
  tableIds: string[];
  rows: number;
}

const PRICE_INTENT = /(いくら|幾ら|料金|価格|値段|費用|単価|相場|金額|円|安い|安く|高い|コスト|予算|お手頃|手頃|費(は|って|を|が|$|\?|？))/;
const OTHER_INTENT = /(違い|特徴|とは|どんな|おすすめ|オススメ|何日|日数|工期|いつ|期間|仕上が|納期|強度|破れ|選び方|メリット|デメリット|できますか|対応)/;
const CHEAP = /(一番安い|いちばん安い|最安|安い|お手頃|手頃|安く|格安)/;
const PREMIUM = /(一番高い|いちばん高い|最高級|高級|一番良い|いちばん良い|グレードの高い)/;
const QUANTITY = /([0-9０-９]+|[一二三四五六七八九十]+)\s*(畳|帖|枚|本|部屋|間|か所|箇所)/;
/** 商品の種類（「襖と障子の料金」のように 2 種類を聞かれたときの判定） */
const FAMILIES = ["畳", "襖", "障子", "網戸", "ヘリ", "クロス", "カーテンレール"];
/** 注記の照合に使わない一般的な語 */
const STOP_WORDS = new Set(["張替え", "張替", "取り付け", "取付", "取付け", "交換", "料金", "価格", "値段", "費用", "工事", "リフォーム", "教えて", "場合", "金額", "一式", "別途"]);

/** 照合用：全角半角・空白をそろえ、お客様の言い方（ふすま／縁なし など）を表の表記に寄せる */
export function normPrice(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　]/g, "")
    .replace(/[・、,，]/g, "")
    .replace(/へり/g, "ヘリ")
    .replace(/(縁|ヘリ)(なし|無し|無)/g, "ヘリ無し")
    .replace(/(縁|ヘリ)(あり|有り|有|付き|付)/g, "ヘリ有り")
    .replace(/畳縁|縁(?!側)/g, "ヘリ")
    .replace(/ふすま/g, "襖")
    .replace(/しょうじ/g, "障子")
    .replace(/あみど|アミ戸|アミド/g, "網戸")
    .replace(/たたみ/g, "畳")
    .replace(/張り替え|貼り替え|貼替え/g, "張替え");
}

const GENERIC_TOKENS = new Set(
  ["その他", "国産", "中国産", "グリーン", "イエロー", "カラー", "無地", "以下", "普通目", "セット", "4枚柄", "柄入り", "樹脂", "和紙", "中国四川", "86cm以下", "86以下", "等プリント紙", "既製品"].map(normPrice),
);

function labelTokens(label: string): string[] {
  return label
    .split(/[／/・\s（）()【】「」〃,、.[\]]+/)
    .map((t) => normPrice(t))
    .filter((t) => t.length >= 2 && !GENERIC_TOKENS.has(t) && !/^\d+$/.test(t));
}

/** 質問文の中の語（カタカナ・漢字・英数字のまとまり） */
function questionWords(nq: string, min = 3): string[] {
  const re = min <= 2 ? /[ァ-ヶー]{2,}|[一-鿿々]{2,}|[a-z0-9]{2,}/g : /[ァ-ヶー]{3,}|[一-鿿々]{2,}|[a-z0-9]{2,}/g;
  return nq.match(re) ?? [];
}

function rowMatches(row: PriceRow, nq: string, words: string[]): boolean {
  return labelTokens(row.label).some((tok) => nq.includes(tok) || words.some((w) => w.length >= 3 && tok.startsWith(w)));
}

function colMatches(label: string, nq: string): boolean {
  const n = normPrice(label);
  if (n.length === 1) return new RegExp(`(^|[^特雪])${n}(サイズ|の|は|で|って|を|だと|なら|$)`).test(nq);
  if (nq.includes(n)) return true;
  // 「新調（畳床：建材3型）」のような列は「新調」「3型」「ボード」「ワラ」「床暖」などでも一致
  const parts = n.split(/[（）():：]/).filter((p) => p.length >= 2);
  return parts.some((p) => nq.includes(p)) || (/ボード/.test(n) && /ボード/.test(nq)) || (/ワラ/.test(n) && /ワラ/.test(nq)) || (/床暖/.test(n) && /床暖/.test(nq));
}

function num(v: string): number {
  const n = Number(v.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && /\d/.test(v) ? n : NaN;
}

interface Scored {
  t: PriceTable;
  index: number;
  score: number;
  rows: PriceRow[];
  cols: number[];
  keywordHit: boolean;
}

function scoreTables(nq: string, tables: PriceTable[]): Scored[] {
  const words = questionWords(nq);
  const kwCount = new Map<string, number>();
  for (const t of tables) for (const k of new Set(t.keywords.map(normPrice))) kwCount.set(k, (kwCount.get(k) ?? 0) + 1);
  return tables.map((t, index) => {
    let score = 0;
    let keywordHit = false;
    for (const k of new Set(t.keywords.map(normPrice))) {
      if (!k || !nq.includes(k)) continue;
      keywordHit = true;
      score += ((kwCount.get(k) ?? 1) === 1 ? 2 : 1) + k.length / 6;
    }
    if (labelTokens(t.title).some((tok) => tok.length >= 3 && nq.includes(tok))) score += 1.5;
    const rows = t.rows.filter((r) => rowMatches(r, nq, words));
    if (rows.length) score += 3;
    const cols = t.columns.map((c, i) => (colMatches(c, nq) ? i : -1)).filter((i) => i >= 0);
    if (cols.length) score += 0.5;
    return { t, index, score, rows, cols, keywordHit };
  });
}

/** 料金表の注記から「諸経費」「改定日」などの全体に関わる情報を取り出す */
function globalInfo(tables: PriceTable[]) {
  const notes = tables.flatMap((t) => [...t.notes, t.caption]);
  const exp = notes.map((n) => n.match(/諸経費\s*([\d,]+)\s*円\s*\/?\s*(一式)?/)).find(Boolean);
  const date = notes.map((n) => n.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/)).find(Boolean);
  const tax = notes.some((n) => /税込/.test(n));
  const heri = tables.find((t) => /^ヘリ$/.test(t.title));
  const heriVals = heri ? heri.rows.flatMap((r) => r.extra.map(num)).filter((n) => Number.isFinite(n)) : [];
  return {
    expenses: exp ? `${Number(exp[1].replace(/,/g, "")).toLocaleString("ja-JP")}円／一式` : "",
    revised: date ? `${date[1]}年${Number(date[2])}月${Number(date[3])}日` : "",
    tax,
    heriRange: heriVals.length ? `${Math.min(...heriVals).toLocaleString("ja-JP")}円〜${Math.max(...heriVals).toLocaleString("ja-JP")}円` : "",
  };
}

const UNIT: [RegExp, string][] = [
  [/^畳（ヘリ付き）$/, "1畳あたり"],
  [/^ヘリ有り 1畳物$/, "1畳あたり"],
  [/^ヘリ無し半畳$/, "半畳1枚あたり"],
  [/置き畳/, "1枚（半畳）あたり"],
  [/^襖/, "1枚あたり"],
  [/^障子/, "1枚あたり"],
  [/^網戸/, "1枚あたり"],
];

function displayTitle(t: PriceTable): { name: string; extra: string } {
  const m = t.title.match(/^(.*?)[（(]([^）)]*\d[^）)]*)[）)]$/);
  return m ? { name: m[1], extra: m[2] } : { name: t.title, extra: "" };
}

function rowLine(t: PriceTable, r: PriceRow, cols: number[]): string {
  const label = r.extra.length && t.columns.length ? `${r.label}（${r.extra.join("・")}）` : r.label;
  if (t.columns.length === 0) return `${label}：${r.extra.map(formatValue).join("・")}`;
  const filled = r.values.map((v, i) => [i, v] as const).filter(([, v]) => v);
  if (filled.length === 1) return `${label}：${formatValue(filled[0][1])}`;
  const parts = cols.filter((i) => r.values[i]).map((i) => `${t.columns[i]} ${formatValue(r.values[i])}`);
  return parts.length ? `${label}：${parts.join("／")}` : `${label}：料金はお問い合わせください`;
}

/** 質問の語のうち、表の種類や列名ではない「中身の語」（処分・ダニ・殺菌・うす畳 など） */
function contentWords(nq: string, t: PriceTable): string[] {
  const known = [...t.keywords.map(normPrice), ...t.columns.map(normPrice), ...FAMILIES.map(normPrice)].filter(Boolean);
  const isKnown = (w: string) => known.some((k) => k.includes(w));
  const out = new Set<string>();
  for (const w of questionWords(nq, 2)) {
    out.add(w);
    // 「処分費」→「処分」のように 2 文字ずつでも照合
    if (/^[一-鿿々]{3,}$/.test(w)) for (let i = 0; i + 2 <= w.length; i++) out.add(w.slice(i, i + 2));
  }
  return [...out].filter((w) => w.length >= 2 && !STOP_WORDS.has(w) && !isKnown(w) && !PRICE_INTENT.test(w));
}

function matchingNotes(t: PriceTable, words: string[], requireYen: boolean): string[] {
  return t.notes.filter((n) => {
    if (requireYen && !/円/.test(n)) return false;
    const nn = normPrice(n);
    return !/諸経費/.test(nn) && words.some((w) => nn.includes(w));
  });
}

/** 文章だけの表（雑工事など）：【見出し】と続く「・」行をひとまとまりにする */
function noteItems(t: PriceTable): string[][] {
  const items: string[][] = [];
  for (const n of t.notes) {
    if (/^[・･]/.test(n) && items.length) items[items.length - 1].push(n);
    else items.push([n]);
  }
  return items;
}

function answerNotesTable(s: Scored, nq: string, style: AnswerStyle): string | null {
  const words = [...contentWords(nq, s.t), ...s.t.keywords.map(normPrice).filter((k) => k.length >= 2 && nq.includes(k) && !STOP_WORDS.has(k))];
  const hits = noteItems(s.t).filter((item) => {
    const text = normPrice(item.join(""));
    return /円/.test(text) && words.some((w) => w.length >= 2 && text.includes(w));
  });
  if (hits.length === 0) return null;
  const lines = hits.slice(0, 3).flat();
  if (style === "voice") return `${lines.slice(0, 3).join("、").replace(/[【】]/g, "")}です。`;
  return lines.map((l) => (l.startsWith("・") ? l : `・${l}`)).join("\n");
}

function tableBlock(s: Scored, nq: string, style: AnswerStyle, info: ReturnType<typeof globalInfo>): { text: string; rows: number } | null {
  const t = s.t;
  if (t.columns.length === 0 && t.rows.length === 0) {
    const text = answerNotesTable(s, nq, style);
    return text ? { text: style === "voice" ? text : `【${displayTitle(t).name}】\n${text}`, rows: 0 } : null;
  }
  const { name, extra } = displayTitle(t);
  const unit = UNIT.find(([re]) => re.test(t.title))?.[1];
  const head = [unit, info.tax ? "税込" : ""].filter(Boolean).join("・");

  // 行・列の指定がなく、質問の中身の語が注記に当たる場合（処分費・ダニ対策など）は注記で答える
  const words = contentWords(nq, t);
  if (!s.rows.length && !s.cols.length && words.length) {
    const notes = matchingNotes(t, words, true);
    if (notes.length) {
      const text = style === "voice" ? `${notes.slice(0, 2).join("、").replace(/※/g, "")}です。` : [`【${name}】の料金表の注記より`, ...notes.slice(0, 4)].join("\n");
      return { text, rows: 0 };
    }
  }

  let rows = s.rows.length ? s.rows : t.rows.filter((r) => r.values.some(Boolean) || r.extra.length);
  const cheap = CHEAP.test(nq);
  const premium = PREMIUM.test(nq);
  if (!s.rows.length && (cheap || premium) && t.columns.length) {
    const key = (r: PriceRow) => num(r.values.find((v) => Number.isFinite(num(v))) ?? "");
    rows = rows.filter((r) => Number.isFinite(key(r))).sort((a, b) => (cheap ? key(a) - key(b) : key(b) - key(a))).slice(0, 3);
  }
  const maxCols = rows.length <= 3 ? t.columns.length : 3;
  const cols = s.cols.length ? s.cols : t.columns.map((_, i) => i).slice(0, maxCols);

  if (style === "voice") {
    const take = rows.slice(0, 3);
    const sentences = take.map((r) => rowLine(t, r, cols.slice(0, 2)).replace(/：/, "は、").replace(/／/g, "、"));
    const spoken = name.replace(/[（(][^）)]*[）)]/g, "").trim() || name;
    let text = `${spoken}の料金${unit ? `は${unit}` : "は"}、${sentences.join("。")}です。`;
    if (rows.length > take.length) {
      const vals = rows.map((r) => num(r.values[cols[0]] ?? "")).filter((n) => Number.isFinite(n));
      if (vals.length) text += `種類によって${Math.min(...vals).toLocaleString("ja-JP")}円から${Math.max(...vals).toLocaleString("ja-JP")}円まであります。`;
    }
    return { text: text.replace(/。です。/g, "です。"), rows: rows.length };
  }
  const lines = rows.slice(0, 24).map((r) => `・${rowLine(t, r, cols)}`);
  const others = s.cols.length || rows.length <= 3 ? [] : t.columns.filter((_, i) => !cols.includes(i));
  // 注記：質問の中身の語に当たるもの＋選んだ列（新調など）に関わるもの
  const colWords = s.cols
    .filter((i) => /[（(]/.test(t.columns[i]))
    .map((i) => normPrice(t.columns[i]).split(/[（）():：]/)[0])
    .filter((w) => w.length >= 2 && w !== "表替え");
  const notes = [...new Set([...matchingNotes(t, [...words, ...colWords], false), ...t.notes.filter((n) => /^目安：/.test(n) && s.cols.length > 0 && colWords.length === 0)])].slice(0, 4);
  if (extra) notes.unshift(`※${extra.replace(/\+|＋/g, "＋").replace(/(\d{3,})/g, (m) => Number(m).toLocaleString("ja-JP"))}円`);
  const text = [
    `【${name}】${head ? `（${head}）` : ""}`,
    ...lines,
    others.length ? `（このほか ${others.join("・")} の料金もご案内できます）` : "",
    ...notes,
  ]
    .filter(Boolean)
    .join("\n");
  return { text, rows: rows.length };
}

/** 音声で読み上げる文から記号を除く（かっこ・スラッシュ・コロン） */
export function voiceClean(s: string): string {
  return s
    .replace(/[（(【\[]/g, "、")
    .replace(/[）)】\]]/g, "")
    .replace(/[：:]/g, " ")
    .replace(/[／/]/g, "、")
    .replace(/※/g, "")
    .replace(/、\s*、+/g, "、")
    .replace(/、(です|は|。)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * AI に渡す参考情報用：表のうち質問に関係する行と注記だけ。
 * 品名が特定できなくても、質問の語が注記に当たれば（「ダニ」「処分」など）その注記と代表的な行を返す。
 * どちらにも当たらない場合は null（呼び出し側で表全体を使う）。
 */
export function sliceTableForQuestion(t: PriceTable, question: string): string | null {
  const nq = normPrice(question);
  const words = questionWords(nq);
  const rows = t.rows.filter((r) => rowMatches(r, nq, words));
  const notes = matchingNotes(t, contentWords(nq, t), false).slice(0, 4);
  if (rows.length === 0 && notes.length === 0) return null;
  const head = `【${t.title}】${t.caption ? `（${t.caption}）` : ""}`;
  const shown = rows.length ? rows : t.rows.slice(0, 4);
  return [head, ...shown.map((r) => rowLine(t, r, t.columns.map((_, i) => i))), ...(rows.length ? [] : ["（ほかの品名は省略）"]), ...notes].join("\n");
}

/** どの表とも決まらない料金の質問（「ダニ対策はいくら？」など）は、全ての表の注記から探す */
function answerFromAnyNotes(question: string, nq: string, tables: PriceTable[], style: AnswerStyle): PriceAnswer | null {
  const found: { t: PriceTable; notes: string[] }[] = [];
  for (const t of tables) {
    const notes = matchingNotes(t, contentWords(nq, t), true);
    if (notes.length) found.push({ t, notes });
  }
  if (found.length === 0 || found.length > 2) return null;
  const info = globalInfo(tables);
  if (style === "voice") {
    const text = found.flatMap((f) => f.notes.slice(0, 2)).join("、").replace(/※/g, "");
    return { reply: `${text}です。正式なお見積りは、担当者が現地を見てから無料でお出しします。`, tableIds: found.map((f) => f.t.id), rows: 0 };
  }
  const blocks = found.map((f) => [`【${displayTitle(f.t).name}】の料金表の注記より`, ...f.notes.slice(0, 4)].join("\n"));
  const footer = [info.expenses ? `※別途、諸経費${info.expenses}が工事全体に対してかかります。` : "", "正式なお見積りは、担当者が現地を見てから無料で提出します。"];
  void question;
  return { reply: [...blocks, ...footer].filter(Boolean).join("\n"), tableIds: found.map((f) => f.t.id), rows: 0 };
}

/**
 * 料金の質問なら料金表から回答文を作る。料金の質問でない／表が特定できない場合は null。
 */
export function answerPrice(question: string, tables: PriceTable[], style: AnswerStyle = "text"): PriceAnswer | null {
  if (tables.length === 0) return null;
  const nq = normPrice(question);
  const priceIntent = PRICE_INTENT.test(nq);
  const scored = scoreTables(nq, tables).filter((s) => s.score >= 1);
  if (scored.length === 0) return priceIntent ? answerFromAnyNotes(question, nq, tables, style) : null;
  const specific = scored.some((s) => s.rows.length > 0 || (s.cols.length > 0 && s.keywordHit));
  if (!priceIntent && (!specific || OTHER_INTENT.test(nq))) return null;

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  // 「襖と障子の料金」のように複数の種類を聞かれたら、種類ごとに一番合う表を答える（文字の相談のみ）
  const families = FAMILIES.filter((f) => nq.includes(normPrice(f)));
  let picks: Scored[] = [scored[0]];
  if (style === "text" && families.length >= 2) {
    picks = families
      .map((f) => scored.find((s) => s.t.keywords.some((k) => normPrice(k) === normPrice(f)) || normPrice(s.t.title).startsWith(normPrice(f))))
      .filter((s): s is Scored => Boolean(s))
      .filter((s, i, arr) => arr.indexOf(s) === i)
      .slice(0, 3);
    if (picks.length === 0) picks = [scored[0]];
  }

  const info = globalInfo(tables);
  const blocks: string[] = [];
  const used: string[] = [];
  let rowsShown = 0;
  for (const s of picks) {
    const b = tableBlock(s, nq, style, info);
    if (!b) continue;
    blocks.push(b.text);
    used.push(s.t.id);
    rowsShown += b.rows;
  }
  if (blocks.length === 0) return null;

  const tatamiOmote = picks.some((s) => /^畳（ヘリ付き）$/.test(s.t.title)) && /表替え|畳替え/.test(nq);
  const footer: string[] = [];
  if (style === "voice") {
    footer.push(`別途、${info.expenses ? `諸経費${info.expenses}が` : "諸経費が"}かかります。正式なお見積りは、担当者が現地を見てから無料でお出しします。`);
  } else {
    if (tatamiOmote && info.heriRange) footer.push(`※表替えはヘリ代が別途かかります（ヘリ：${info.heriRange}）。`);
    if (info.expenses) footer.push(`※別途、諸経費${info.expenses}が工事全体に対してかかります。`);
    if (QUANTITY.test(question)) footer.push("※数量を掛けた合計金額は、担当者が現地を見てからのお見積りでご案内します（概算は基本的に行っていません）。");
    footer.push(`正式なお見積りは、担当者が現地を見てから無料で提出します。${info.revised ? `（${info.revised}改定の料金表より）` : ""}`);
  }
  const reply = [...blocks, ...footer].join(style === "voice" ? "" : "\n");
  return { reply: style === "voice" ? voiceClean(reply) : reply, tableIds: used, rows: rowsShown };
}
