// 数量のある質問（「畳の表が6枚」「8畳を古都で」「網戸2枚と障子3枚」）に添える「数量の計算表」：
//   料金表の単価 × 数量を、システムが種類ごとに計算して AI に渡す（AI が計算を誤らないように・聞き方が違っても合計を出せるように）
//   どの料金表を使うかは、質問の品目の言葉（畳・襖・障子・網戸 など）と数量の単位（畳・枚・本・つ）で決める。
//   AI は質問の品目・作業・種類に合う行だけを使う（合わない表は使わない）
import { env } from "./env";
import type { PriceRow, PriceTable } from "./manual";
import { normPrice, tableUnit } from "./price";
import type { ChatMessage } from "./types";

interface Item {
  re: RegExp;
  /** この品目の料金表（見出しで探す） */
  tables: RegExp[];
  /** 数量の単位がこれなら、この品目の数量とみなす */
  units: string[];
}

/** 品目の言葉と料金表。「6畳の」の畳は数量なので品目にしない */
const ITEMS: Item[] = [
  { re: /畳表|表替|おもてがえ|たたみ|(?<![\d一二三四五六七八九十半])畳(?!下)|い草|イ草/, tables: [/^畳（ヘリ付き）$/, /^ヘリ$/], units: ["畳", "帖", "枚"] },
  { re: /ヘリ無し|ヘリなし|へりなし|縁なし|縁無し|琉球/, tables: [/^ヘリ無し半畳$/], units: ["枚"] },
  { re: /置き畳|置畳|ユニット畳/, tables: [/置き畳/], units: ["枚"] },
  { re: /和紙畳|樹脂畳|カラー畳/, tables: [/^ヘリ有り 1畳物$/], units: ["畳", "帖", "枚"] },
  { re: /襖|ふすま/, tables: [/^襖張替え$/], units: ["枚"] },
  { re: /障子|しょうじ/, tables: [/^障子/], units: ["枚"] },
  { re: /網戸|アミ戸|アミド|あみど/, tables: [/^網戸/], units: ["枚"] },
  { re: /カーテンレール|レール/, tables: [/^カーテンレール/], units: ["つ", "個", "本", "セット", "カ所"] },
];

const KANJI: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function toNumber(s: string): number {
  if (/^\d+$/.test(s)) return Number(s);
  // 漢数字（一〜九十九）
  const m = s.match(/^([一二三四五六七八九])?(十)?([一二三四五六七八九])?$/);
  if (!m) return NaN;
  if (!m[2]) return KANJI[m[1] ?? ""] ?? NaN;
  return (m[1] ? KANJI[m[1]] : 1) * 10 + (m[3] ? KANJI[m[3]] : 0);
}

/** 数量（「6枚」「八畳」「2つ」）。「1枚あたり」「4畳半」「6畳間の襖」の 6畳 などは、使い方で判断する */
const QTY = /(\d+|[一二三四五六七八九十]+)\s*(畳|帖|枚|本|つ|個|セット|カ所|箇所|ヶ所|か所)(半)?(?!\s*(?:あたり|当たり|目))/g;

interface Found {
  n: number;
  unit: string;
  at: number;
  half: boolean;
}

function quantities(text: string): Found[] {
  const out: Found[] = [];
  for (const m of text.matchAll(QTY)) {
    const n = toNumber(m[1]);
    if (!Number.isFinite(n) || n < 1 || n > 200) continue;
    const unit = ["箇所", "ヶ所", "か所"].includes(m[2]) ? "カ所" : m[2];
    out.push({ n, unit, at: m.index ?? 0, half: Boolean(m[3]) });
  }
  return out;
}

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
const amount = (s: string) => (/^\d{1,3}(,\d{3})+$|^\d+$/.test(s.trim()) ? Number(s.replace(/,/g, "")) : NaN);

/** 質問で使う列だけにする（襖の「中」「天・地袋」、障子の「雪見」など、言われていない列は省く） */
function pickColumns(t: PriceTable, nq: string): number[] {
  const all = t.columns.map((_, i) => i);
  if (!t.columns.length) return [];
  const named = all.filter((i) => {
    const c = normPrice(t.columns[i]).replace(/[（(].*$/, "");
    return c.length >= 1 && nq.includes(c);
  });
  if (named.length) return named;
  if (isTatamiTable(t)) {
    const re =/新調|新しく|新品|丸ごと|畳床/.test(nq);
    const omote = /表替|おもてがえ|畳表|表が|表を|表の/.test(nq);
    if (omote && !re) return all.filter((i) => /表替え/.test(t.columns[i]));
    if (re && !omote) return all.filter((i) => /新調/.test(t.columns[i]));
    return all;
  }
  if (/^襖/.test(t.title)) return all.filter((i) => /^(片面|両面)$/.test(t.columns[i]));
  if (/^障子|^網戸/.test(t.title)) return all.filter((i) => /^(大|中|小)$/.test(t.columns[i]));
  return all;
}

const isTatamiTable = (t: PriceTable) => /^畳（ヘリ付き）$|^ヘリ有り 1畳物$/.test(t.title);

/** 張替え・表替えとは別の作業の行（ウラ返し・枠交換・戸車交換 など）。質問がその作業のことなら別の作業とみなさない */
const OTHER_WORK = /ウラ返|裏返|枠交換|戸車|修理|補修/;
function otherWork(label: string, nq: string): boolean {
  const m = label.match(OTHER_WORK);
  if (!m) return false;
  const word = m[0].replace(/^裏返$/, "ウラ返");
  return !(nq.includes(word) || (word === "ウラ返" && /裏返/.test(nq)) || (word === "枠交換" && /枠/.test(nq)));
}

/** 列のない表（ヘリ）の行の金額（extra に入っている） */
const rowAmount = (row: PriceRow) => row.extra.map(amount).find((x) => Number.isFinite(x));
const rowName = (row: PriceRow) => row.label.replace(/\s+/g, " ").trim();

/** 行の、使う列の単価（金額でない「時価」などは除く） */
function unitPrices(row: PriceRow, t: PriceTable, cols: number[]): number[] {
  if (!t.columns.length) {
    const v = rowAmount(row);
    return v === undefined ? [] : [v];
  }
  return cols.map((i) => amount((row.values[i] ?? "").trim())).filter((v) => Number.isFinite(v));
}

function rowLine(row: PriceRow, t: PriceTable, cols: number[], n: number, unitWord: string): string | null {
  const cells: string[] = [];
  if (!t.columns.length) {
    const v = rowAmount(row);
    if (v === undefined) return null;
    cells.push(`${yen(v)}×${n}${unitWord}＝${yen(v * n)}`);
  } else {
    // 畳の「ウラ返し」は表替え・新調とは別の作業（料金表では最初の列に金額がある）なので、列の名前を付けない
    const own = isTatamiTable(t) && /ウラ返|裏返/.test(row.label);
    for (const i of own ? [0] : cols) {
      const raw = (row.values[i] ?? "").trim();
      if (!raw || raw === "-" || raw === "なし") continue;
      const v = amount(raw);
      const col = own ? "" : `${t.columns[i]} `;
      cells.push(Number.isFinite(v) ? `${col}${yen(v)}×${n}${unitWord}＝${yen(v * n)}` : `${col}${raw}`);
    }
  }
  return cells.length ? `・${rowName(row)}：${cells.join("／")}` : null;
}

/** 行を安い順に（金額のない行「時価」などは最後） */
function cheapestFirst(rows: PriceRow[], t: PriceTable, cols: number[]): PriceRow[] {
  const low = (r: PriceRow) => Math.min(...unitPrices(r, t, cols), Number.POSITIVE_INFINITY);
  return rows.map((r, i) => ({ r, i, v: low(r) })).sort((a, b) => a.v - b.v || a.i - b.i).map((x) => x.r);
}

/**
 * 畳の合計の例（ヘリ代・諸経費込み）：質問に出た種類、なければ資料の「一番人気は〜」「迷ったら〜」の種類で、
 * 資料の「よく選ばれるのは〜円と〜円のグレード」のヘリを使う。資料の書き方が違って読み取れなければ作らない
 */
function tatamiExamples(t: PriceTable, cols: number[], n: number, nq: string, heri: PriceTable | undefined, expenses: number | null, sheetText: string): string[] {
  if (!heri || !cols.length || /ウラ返|裏返/.test(nq)) return [];
  // 表替えと新調の両方の列なら表替えで。新調だけなら資料の「建材床（3型）をベースに答える」の列
  const col = cols.find((i) => /表替え/.test(t.columns[i])) ?? cols.find((i) => /建材3型|3型/.test(t.columns[i])) ?? cols[0];
  // 資料の文は NFKC だけでそろえる（normPrice は「一番」を「1番」にするため）
  const text = sheetText.normalize("NFKC");
  // 会社名と同じ名前の種類（「一畳屋」）は、「一畳屋さんで6枚」のように会社のことを言っていることが多いので、種類の指定とみなさない
  const named = t.rows.filter((r) => {
    const name = normPrice(rowName(r)).replace(/[（(].*$/, "").split(/\s/)[0];
    return name.length >= 2 && name !== normPrice(env.companyName) && !/ウラ返|裏返/.test(name) && nq.includes(name);
  });
  const pick = (re: RegExp, note: string) => {
    const name = text.match(re)?.[1];
    const row = name ? t.rows.find((r) => rowName(r).normalize("NFKC").startsWith(name)) : undefined;
    return row ? [{ row, note }] : [];
  };
  const targets = named.length ? named.map((row) => ({ row, note: "" })) : [...pick(/一番人気は\s*([^\s、。・,]+)/, "一番人気"), ...pick(/迷ったら\s*([^\s、。・,]+)/, "迷ったら")];
  const popular = [...(text.match(/よく選ばれるのは([\d,円と\s]+)のグレード/)?.[1] ?? "").matchAll(/([\d,]+)円/g)]
    .map((m) => amount(m[1]))
    .filter((v) => Number.isFinite(v) && heri.rows.some((r) => rowAmount(r) === v))
    .sort((a, b) => a - b);
  if (!targets.length || !popular.length) return [];
  const out: string[] = [];
  for (const { row, note } of targets.slice(0, 2)) {
    const unit = amount((row.values[col] ?? "").trim());
    if (!Number.isFinite(unit)) continue;
    const parts = popular.map((h) => {
      const total = unit * n + h * n + (expenses ?? 0);
      return `ヘリ 1畳${yen(h)}なら ${yen(unit * n)}＋ヘリ ${yen(h * n)}${expenses ? `＋諸経費 ${yen(expenses)}` : ""}＝${yen(total)}`;
    });
    out.push(`・合計の例（${rowName(row)}${note ? `・${note}` : ""}の${t.columns[col]}、よく選ばれるヘリ${expenses ? "・諸経費込み" : ""}）：${parts.join("／")}`);
  }
  return out;
}

/**
 * 数量の計算表（AI に渡す参考）。数量が 2 以上で、品目と料金表がわかるときだけ作る（1枚・1畳は単価の質問なので作らない）。
 * 4畳半などの半畳を含む数量は、計算の決まり（半畳8掛け・縁は8掛けしない など）が多いので、ここでは作らない（quote.ts の計算に任せる）。
 * 行は安い順。畳は合計の例（ヘリ代・諸経費込み）、ほかの品目は諸経費込みの合計の範囲も添える（sheetText＝資料の文章：おすすめ・よく選ばれるヘリ）
 */
export function quantityReference(question: string, history: ChatMessage[], tables: PriceTable[], sheetText = ""): string | null {
  const nq = normPrice(question);
  let found = quantities(nq);
  let text = nq;
  // 「古都だと？」のような続きの質問：直前のお客様の発言の数量を使う
  if (!found.length && nq.length <= 30) {
    const prev = [...history].reverse().find((m) => m.role === "user" && quantities(normPrice(m.content)).length);
    if (prev) {
      text = `${normPrice(prev.content)} ${nq}`;
      found = quantities(text);
    }
  }
  if (!found.length || found.some((f) => f.half)) return null;
  const mentions = ITEMS.flatMap((item) => [...text.matchAll(new RegExp(item.re.source, "g"))].map((m) => ({ item, at: m.index ?? 0 })));
  if (!mentions.length) return null;
  const blocks: string[] = [];
  const used = new Set<string>();
  const expRaw = tables.flatMap((t) => t.notes).map((n) => n.match(/諸経費\s*([\d,]+)\s*円/)?.[1]).find(Boolean);
  const expenses = expRaw ? Number(expRaw.replace(/,/g, "")) : null;
  const heri = tables.find((t) => /^ヘリ$/.test(t.title));
  // 諸経費込みの合計の範囲は、品目が 1 つのときだけ（複数の品目の組み合わせの合計は AI が計算表から足す）
  const ranges: string[] = [];
  // 標準の目安（畳は「合計の例」があるので、畳を含む質問では作らない）
  const standards: Standard[] = [];
  let hasTatami = false;
  for (const f of found) {
    if (f.n < 2) continue;
    // 数量のすぐ前（なければすぐ後）に出た品目の数量とみなす（「網戸2枚と障子3枚」）
    const candidates = mentions.filter((m) => m.item.units.includes(f.unit));
    const before = candidates.filter((m) => m.at < f.at).sort((a, b) => b.at - a.at)[0];
    const after = candidates.filter((m) => m.at > f.at).sort((a, b) => a.at - b.at)[0];
    const target = before ?? after;
    if (!target) continue;
    for (const re of target.item.tables) {
      for (const t of tables.filter((x) => re.test(x.title))) {
        const key = `${t.id}:${f.n}`;
        if (used.has(key)) continue;
        used.add(key);
        const cols = pickColumns(t, nq);
        const unitWord = f.unit === "帖" ? "畳" : f.unit;
        // 畳の「ウラ返し」・襖の「枠交換」などは、張替え・表替えの種類ではない別の作業なので、聞かれたときだけ
        // （安い順に並べると先頭に来て、張替えの料金と取り違えないように）
        const rows = t.rows.filter((r) => !otherWork(r.label, nq));
        const lines = cheapestFirst(rows, t, cols)
          .map((r) => rowLine(r, t, cols, f.n, unitWord))
          .filter((x): x is string => Boolean(x));
        if (!lines.length) continue;
        const unit = tableUnit(t);
        if (isTatamiTable(t)) {
          lines.push(...tatamiExamples(t, cols, f.n, nq, heri, expenses, sheetText));
          hasTatami = true;
        } else if (t !== heri) {
          const all = t.rows.flatMap((r) => unitPrices(r, t, cols));
          if (expenses && all.length) ranges.push(`・諸経費込みの合計（${t.title}だけの場合）：${yen(Math.min(...all) * f.n + expenses)}〜${yen(Math.max(...all) * f.n + expenses)}`);
          const std = standardPart(t, cols, nq);
          if (std) standards.push({ ...std, title: t.title, n: f.n, unitWord });
        }
        blocks.push(`■ ${t.title}${unit ? `（${unit}の単価）` : ""} × ${f.n}${unitWord}（安い順）\n${lines.join("\n")}`);
      }
    }
  }
  if (!blocks.length) return null;
  return [
    "## 数量の計算表（システムが料金表の単価×数量で計算した金額。質問の品目・作業・種類に合う行だけを使い、合計はこの数字のとおりに伝える）",
    ...blocks,
    ...(hasTatami ? [] : standardLines(standards, expenses)),
    ...(ranges.length === 1 ? ranges : []),
    expenses ? `・諸経費：工事全体に一式 ${yen(expenses)}（数量によらない）` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

interface Standard {
  title: string;
  name: string;
  col: string;
  unit: number;
  n: number;
  unitWord: string;
}

/**
 * 標準の目安（「網戸4枚でいくら？」のような漠然とした質問用）：張替えなどの基本の作業で、いちばん安い種類を、
 * 最初の列（網戸・障子は「大」、襖は「片面」＝一般的な大きさ・作業）で。質問で列（中・両面 など）や新調を言われていれば、それに合わせる
 */
function standardPart(t: PriceTable, cols: number[], nq: string): { name: string; col: string; unit: number } | null {
  if (!t.columns.length) return null;
  const col = cols[0] ?? 0;
  const wantNew = /新調|新しく|作り替|作りかえ|丸ごと/.test(nq);
  const pool = t.rows.filter((r) => /新調/.test(r.label) === wantNew && !OTHER_WORK.test(r.label));
  const best = (pool.length ? pool : t.rows)
    .map((r) => ({ r, v: amount((r.values[col] ?? "").trim()) }))
    .filter((x) => Number.isFinite(x.v))
    .sort((a, b) => a.v - b.v)[0];
  return best ? { name: rowName(best.r), col: t.columns[col], unit: best.v } : null;
}

/** 標準の目安の行（品目が 1 つなら諸経費込みの合計、複数なら品目ごとの金額と、諸経費を一式で 1 回足した合計） */
function standardLines(list: Standard[], expenses: number | null): string[] {
  if (!list.length) return [];
  const exp = expenses ? `＋諸経費 ${yen(expenses)}` : "";
  const total = list.reduce((s, x) => s + x.unit * x.n, 0) + (expenses ?? 0);
  if (list.length === 1) {
    const x = list[0];
    return [`・標準の目安（${x.name}・${x.col}×${x.n}${x.unitWord}${expenses ? "・諸経費込み" : ""}）：${yen(x.unit)}×${x.n}＝${yen(x.unit * x.n)}${exp}＝${yen(total)}`];
  }
  return [
    ...list.map((x) => `・標準の目安（${x.title}：${x.name}・${x.col}）：${yen(x.unit)}×${x.n}${x.unitWord}＝${yen(x.unit * x.n)}`),
    `・標準の目安の合計（諸経費は工事全体で1回）：${list.map((x) => yen(x.unit * x.n)).join("＋")}${exp}＝${yen(total)}`,
  ];
}
