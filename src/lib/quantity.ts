// 数量のある質問（「畳の表が6枚」「8畳を古都で」「網戸2枚と障子3枚」）に添える「数量の計算表」：
//   料金表の単価 × 数量を、システムが種類ごとに計算して AI に渡す（AI が計算を誤らないように・聞き方が違っても合計を出せるように）
//   どの料金表を使うかは、質問の品目の言葉（畳・襖・障子・網戸 など）と数量の単位（畳・枚・本・つ）で決める。
//   AI は質問の品目・作業・種類に合う行だけを使う（合わない表は使わない）
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
  if (/^畳（ヘリ付き）$|^ヘリ有り 1畳物$/.test(t.title)) {
    const re = /新調|新しく|新品|丸ごと|畳床/.test(nq);
    const omote = /表替|おもてがえ|畳表|表が|表を|表の/.test(nq);
    if (omote && !re) return all.filter((i) => /表替え/.test(t.columns[i]));
    if (re && !omote) return all.filter((i) => /新調/.test(t.columns[i]));
    return all;
  }
  if (/^襖/.test(t.title)) return all.filter((i) => /^(片面|両面)$/.test(t.columns[i]));
  if (/^障子|^網戸/.test(t.title)) return all.filter((i) => /^(大|中|小)$/.test(t.columns[i]));
  return all;
}

function rowLine(row: PriceRow, t: PriceTable, cols: number[], n: number, unitWord: string): string | null {
  const cells: string[] = [];
  if (!t.columns.length) {
    // 列のない表（ヘリ）：金額は extra に入っている
    const v = row.extra.map(amount).find((x) => Number.isFinite(x));
    if (v === undefined) return null;
    cells.push(`${yen(v)}×${n}${unitWord}＝${yen(v * n)}`);
  } else {
    for (const i of cols) {
      const raw = (row.values[i] ?? "").trim();
      if (!raw || raw === "-" || raw === "なし") continue;
      const v = amount(raw);
      cells.push(Number.isFinite(v) ? `${t.columns[i]} ${yen(v)}×${n}${unitWord}＝${yen(v * n)}` : `${t.columns[i]} ${raw}`);
    }
  }
  return cells.length ? `・${row.label.replace(/\s+/g, " ").trim()}：${cells.join("／")}` : null;
}

/**
 * 数量の計算表（AI に渡す参考）。数量が 2 以上で、品目と料金表がわかるときだけ作る（1枚・1畳は単価の質問なので作らない）。
 * 4畳半などの半畳を含む数量は、計算の決まり（半畳8掛け・縁は8掛けしない など）が多いので、ここでは作らない（quote.ts の計算に任せる）
 */
export function quantityReference(question: string, history: ChatMessage[], tables: PriceTable[]): string | null {
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
        const lines = t.rows.map((r) => rowLine(r, t, cols, f.n, unitWord)).filter((x): x is string => Boolean(x));
        if (!lines.length) continue;
        const unit = tableUnit(t);
        blocks.push(`■ ${t.title}${unit ? `（${unit}の単価）` : ""} × ${f.n}${unitWord}\n${lines.join("\n")}`);
      }
    }
  }
  if (!blocks.length) return null;
  const expenses = tables.flatMap((t) => t.notes).map((n) => n.match(/諸経費\s*([\d,]+)\s*円/)?.[1]).find(Boolean);
  return [
    "## 数量の計算表（システムが料金表の単価×数量で計算した金額。質問の品目・作業・種類に合う行だけを使い、合計はこの数字のとおりに伝える）",
    ...blocks,
    expenses ? `・諸経費：工事全体に一式 ${yen(Number(expenses.replace(/,/g, "")))}（数量によらない）` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
