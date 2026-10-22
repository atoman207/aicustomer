// 料金の質問に、顧客対応マニュアルの料金表から直接答える（OpenAI を使わない）
//   ・どの表か（畳・襖・障子・網戸 など）、どの品名か（古都・朱雀 など）、どの列か（表替え・両面・大 など）を判定
//   ・表の行にない内容（処分費・ダニ対策など）は、その表の注記から答える
//   ・単価と関連する注記・諸経費を添える（数量があるときの合計の目安は quote.ts。正式なお見積りは現地確認後）
import { formatValue, type PriceRow, type PriceTable } from "./manual";

export type AnswerStyle = "text" | "voice";

export interface PriceAnswer {
  reply: string;
  tableIds: string[];
  rows: number;
}

export const PRICE_INTENT = /(いくら|幾ら|料金|価格|値段|費用|単価|相場|金額|円|安い|安く|高い|コスト|予算|お手頃|手頃|費(は|って|を|が|$|\?|？))/;
export const OTHER_INTENT =
  /(違い|特徴|とは|どんな|おすすめ|オススメ|何日|日数|工期|いつ|期間|仕上が|納期|終わ|強度|破れ|選び方|メリット|デメリット|できますか|対応|何年|年数|耐用|寿命|長持ち|もちます|持ちます|もつ|持つ|タイミング|替え時|時期|目安|人気|選ばれ|種類|効果|効き目|安全|ブヨブヨ|江戸間|京間|サンプル|見本)/;
/** 「値段の違いは？」「大きさで料金は変わる？」は、料金表ではなく理由の説明（会社情報）で答える */
export const WHY_PRICE = /((値段|金額|価格|料金)(の|は|が)?(違い|違う|違います|差|変わ)|価格差|何が違|なぜ(高い|安い)|(高い|安い)(もの|物|の)?と(安い|高い))/;
/** 「処分費は含まれますか」のような、料金に含まれるかどうかの確認（会社情報で答える） */
export const INCLUSION = /(含まれ|込み(です|でしょう|になり)|入って(い)?ますか|別途(かかり|必要))/;
/** 新しく作る（新調）の質問。新調の料金がない表（障子など）では答えない */
const NEW_MAKE = /(新調|作り替え|作りかえ|新しく作)/;
const CHEAP = /(一番安い|いちばん安い|最安|安い|お手頃|手頃|安く|格安)/;
const PREMIUM = /(一番高い|いちばん高い|最高級|高級|一番良い|いちばん良い|グレードの高い)/;
/** 数量から合計の目安を計算できる表（quote.ts） */
const QUOTABLE = /^畳\(ヘリ付き\)$|^ヘリ無し半畳|^ヘリ有り\s*1畳物|置き畳|^襖張替え|^襖新調|^障子張替え|^網戸/;
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
    // 「畳のヘリ（畳の縁）」はヘリのこと
    .replace(/畳のヘリ(?!有り|無し)/g, "ヘリ")
    .replace(/張り替え|貼り替え|貼替え/g, "張替え");
}

const GENERIC_TOKENS = new Set(
  ["その他", "国産", "中国産", "グリーン", "イエロー", "カラー", "無地", "以下", "普通目", "セット", "4枚柄", "柄入り", "樹脂", "和紙", "中国四川", "86cm以下", "86以下", "等プリント紙", "既製品"].map(normPrice),
);

export function labelTokens(label: string): string[] {
  return label
    .split(/[／/・\s（）()【】「」〃,、.[\]]+/)
    .map((t) => normPrice(t))
    .filter((t) => t.length >= 2 && !GENERIC_TOKENS.has(t) && !/^\d+$/.test(t));
}

/** 質問文の中の語（カタカナ・漢字・英数字のまとまり） */
export function questionWords(nq: string, min = 3): string[] {
  const re = min <= 2 ? /[ァ-ヶー]{2,}|[一-鿿々]{2,}|[a-z0-9]{2,}/g : /[ァ-ヶー]{3,}|[一-鿿々]{2,}|[a-z0-9]{2,}/g;
  return nq.match(re) ?? [];
}

export function rowMatches(row: PriceRow, nq: string, words: string[]): boolean {
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

/** 列名のうち、ほかの列と区別できる部分（「新調（畳床：本ワラ）」なら「本ワラ」）が質問に含まれるか */
function colDistinct(label: string, nq: string): boolean {
  const n = normPrice(label);
  if (nq.includes(n)) return true;
  const parts = n
    .split(/[（）():：]/)
    .filter((p) => p.length >= 2)
    .slice(1)
    .filter((p) => p !== "畳床");
  return (
    parts.some((p) => nq.includes(p)) ||
    (/ボード/.test(n) && /ボード/.test(nq)) ||
    (/ワラ/.test(n) && /ワラ/.test(nq)) ||
    (/床暖/.test(n) && /床暖/.test(nq)) ||
    (/3型/.test(n) && /(3型|建材)/.test(nq)) ||
    (/置き畳/.test(n) && /置き畳/.test(nq))
  );
}

/**
 * 「新調はいくら？」のように列の共通部分（新調）だけで一致したときは、その種類の最初の列だけで答える。
 * 畳の新調は最も一般的な建材床（3型）が最初の列（一畳屋の案内の基準）。
 */
function narrowCols(t: PriceTable, cols: number[], nq: string): number[] {
  if (cols.length < 2) return cols;
  const head = (i: number) => normPrice(t.columns[i]).split("(")[0];
  const out = cols.filter((i) => colDistinct(t.columns[i], nq));
  const heads = new Set(out.map(head));
  for (const i of cols) {
    if (out.includes(i) || heads.has(head(i))) continue;
    out.push(i);
    heads.add(head(i));
  }
  return out.sort((a, b) => a - b);
}

/** この表で新調の料金を答えられるか（列名・品名・表題に「新調」がある） */
function hasNewPrices(t: PriceTable): boolean {
  return /新調/.test(t.title) || t.columns.some((c) => /新調/.test(c)) || t.rows.some((r) => /新調/.test(r.label));
}

/** 表に添える一畳屋からの案内（manual-rules.json の tableGuides） */
function guidesFor(t: PriceTable, nq: string): string[] {
  return (t.guides ?? [])
    .filter((g) => {
      if (!g.when) return true;
      try {
        return new RegExp(g.when).test(nq);
      } catch {
        return false;
      }
    })
    .map((g) => g.text);
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
    // 表題そのもの（「ヘリ」など短いものも）が質問にあれば優先（「ヘリ無し」「ヘリ有り」は別の表）
    const title = normPrice(t.title);
    if (title.length >= 2 && nq.replace(/ヘリ(無し|有り)/g, "").includes(title)) score += 2;
    const rows = t.rows.filter((r) => rowMatches(r, nq, words));
    if (rows.length) score += 3;
    const cols = narrowCols(
      t,
      t.columns.map((c, i) => (colMatches(c, nq) ? i : -1)).filter((i) => i >= 0),
      nq,
    );
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
    expenses: exp ? `${Number(exp[1].replace(/,/g, "")).toLocaleString("ja-JP")}円` : "",
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
  const guides = guidesFor(t, nq);
  const newRows = NEW_MAKE.test(nq) && t.rows.some((r) => /新調/.test(r.label));
  if (!s.rows.length && !s.cols.length && words.length && !newRows) {
    const notes = matchingNotes(t, words, true);
    if (notes.length) {
      const text =
        style === "voice"
          ? `${notes.slice(0, 2).join("、").replace(/※/g, "")}です。${guides.slice(0, 1).join("").replace(/※/g, "")}`
          : [`【${name}】の料金表の注記より`, ...notes.slice(0, 4), ...guides].join("\n");
      return { text, rows: 0 };
    }
  }

  let rows = s.rows.length ? s.rows : t.rows.filter((r) => r.values.some(Boolean) || r.extra.length);
  // 「網戸の新調は？」のように品名に「新調」がある表は、新調の行だけで答える
  if (!s.rows.length && NEW_MAKE.test(nq) && !/張替え/.test(nq) && rows.some((r) => /新調/.test(r.label))) rows = rows.filter((r) => /新調/.test(r.label));
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
    if (guides.length) text += guides[0].replace(/※/g, "");
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
    others.length ? `（このほか、${others.join("・")}の料金もご案内できます）` : "",
    ...notes,
    ...guides,
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
    if (notes.length) found.push({ t, notes: [...notes.slice(0, 4), ...guidesFor(t, nq)] });
  }
  if (found.length === 0 || found.length > 2) return null;
  const info = globalInfo(tables);
  if (style === "voice") {
    const text = found.flatMap((f) => f.notes.slice(0, 2)).join("、").replace(/※/g, "");
    const spoken = /。$/.test(text) ? text : `${text}です。`;
    return { reply: voiceClean(`${spoken}正式なお見積りは、担当者が現地を見てから無料でお出しします。`), tableIds: found.map((f) => f.t.id), rows: 0 };
  }
  const blocks = found.map((f) => [`【${displayTitle(f.t).name}】の料金表の注記より`, ...f.notes].join("\n"));
  const footer = [info.expenses ? `※このほか、工事全体に対して諸経費（一式）${info.expenses}がかかります。` : "", "正式なお見積りは、担当者が現地を見てから無料で提出します。"];
  void question;
  return { reply: [...blocks, ...footer].filter(Boolean).join("\n"), tableIds: found.map((f) => f.t.id), rows: 0 };
}

/**
 * 料金の質問なら料金表から回答文を作る。料金の質問でない／表が特定できない場合は null。
 */
export function answerPrice(question: string, tables: PriceTable[], style: AnswerStyle = "text"): PriceAnswer | null {
  if (tables.length === 0) return null;
  const nq = normPrice(question);
  if (INCLUSION.test(nq)) return null;
  const priceIntent = PRICE_INTENT.test(nq);
  const scored = scoreTables(nq, tables).filter((s) => s.score >= 1);
  // 品名・列の指定がない「値段の違いは？」は理由の説明で答える（「古都とさくらの値段の違い」は料金表で）
  if (WHY_PRICE.test(nq) && !scored.some((s) => s.rows.length > 0 || s.cols.length > 0)) return null;
  if (scored.length === 0) return priceIntent ? answerFromAnyNotes(question, nq, tables, style) : null;
  const specific = scored.some((s) => s.rows.length > 0 || (s.cols.length > 0 && s.keywordHit));
  if (!priceIntent && (!specific || OTHER_INTENT.test(nq))) return null;

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  // 「襖と障子の料金」のように複数の種類を聞かれたら、種類ごとに一番合う表を答える（文字の相談のみ）
  // 種類が 1 つなのに、一番合った表が別の種類の表なら、聞かれた種類の表で答える
  // （「網戸の張替えと新調」が「新調」の語で畳の表にならないように）。「ヘリ無し畳」「ヘリ有り畳」は畳として数える
  const famQ = nq.replace(/ヘリ(無し|有り)/g, "");
  const families = FAMILIES.filter((f) => famQ.includes(normPrice(f)));
  const tableOf = (f: string) => {
    const nf = normPrice(f);
    return (
      scored.find((s) => normPrice(s.t.title) === nf) ??
      scored.find((s) => s.t.keywords.some((k) => normPrice(k) === nf) || normPrice(s.t.title).startsWith(nf))
    );
  };
  const familyOfTable = (t: PriceTable) => {
    const title = normPrice(t.title).replace(/^ヘリ(無し|有り)/, "畳");
    return FAMILIES.find((f) => title.startsWith(normPrice(f)));
  };
  let picks: Scored[] = [scored[0]];
  if (families.length === 1) {
    const top = familyOfTable(scored[0].t);
    if (top && top !== families[0]) picks = [tableOf(families[0]) ?? scored[0]];
  } else if (style === "text" && families.length >= 2) {
    picks = families
      .map(tableOf)
      .filter((s): s is Scored => Boolean(s))
      .filter((s, i, arr) => arr.indexOf(s) === i)
      .slice(0, 3);
    if (picks.length === 0) picks = [scored[0]];
  }
  // 新調の料金がない表（障子など）では新調の質問に答えない（現場を見てからのお見積り。会社情報で案内）
  if (NEW_MAKE.test(nq)) picks = picks.filter((s) => hasNewPrices(s.t));
  if (picks.length === 0) return null;

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
    footer.push(`このほか、工事全体に諸経費が${info.expenses ? `一式${info.expenses}` : ""}かかります。正式なお見積りは、担当者が現地を見てから無料でお出しします。`);
  } else {
    if (tatamiOmote && info.heriRange) footer.push(`※表替えはヘリ代が別途かかります（ヘリ：${info.heriRange}）。`);
    if (info.expenses) footer.push(`※このほか、工事全体に対して諸経費（一式）${info.expenses}がかかります。`);
    if (QUANTITY.test(question)) footer.push("※正式な合計金額は、担当者が現地を見てからのお見積りでご案内します。");
    else if (picks.some((s) => QUOTABLE.test(s.t.title.normalize("NFKC")))) footer.push("※畳数・枚数を教えていただければ、料金表から合計の目安を計算します。");
    if (info.revised) footer.push(`※${info.revised}改定の料金表による料金です。`);
    footer.push("正式なお見積りは、担当者が現地を見てから無料で提出します。");
  }
  const reply = [...blocks, ...footer].join(style === "voice" ? "" : "\n");
  return { reply: style === "voice" ? voiceClean(reply) : reply, tableIds: used, rows: rowsShown };
}
