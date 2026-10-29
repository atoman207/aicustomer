// 顧客対応マニュアル（Excel／スプレッドシートの指定1シート）をナレッジに変換する
//   ・上部の文章（会社情報・よくある問い合わせ など）… 見出しごとのまとまりに分割
//   ・下部の料金表（畳・襖・障子・網戸 など、列が横に並ぶ表）… 表ごとに「品名：列名 金額」の形に展開
//   ・社内向けの書き込み（思案中のメモ・原価の計算式・仕入先名など）は database/manual-rules.json の規則で除外
//   ・Excel → database/manual.json の変換（scripts/build-knowledge.mjs）からも直接読み込むため、型以外の import は持たない
import type { KnowledgeEntry } from "./types";

export interface ManualRules {
  /** この語を含む行から次の見出しまでを社内向けとして除外 */
  internalSectionStart: string[];
  /** この語（正規表現）を含む行・メモは除外 */
  excludeLine: string[];
  /** 文中から取り除く表記（正規表現） */
  removeText: string[];
  /** 表の列名の言い換え（表題 → { 元の列名: わかりやすい列名 }） */
  columnAlias: Record<string, Record<string, string>>;
  /** 表題ごとの検索語（お客様の言い方） */
  tableKeywords: Record<string, string[]>;
  /** 料金表の回答に添える案内（一畳屋からの補足。when は質問に含まれる語の正規表現。省略時は常に添える） */
  tableGuides?: (TableGuide & { table: string })[];
  /** 料金表の下にある文章の見出し（正規表現。「畳について」など）。料金表ではなく文章として扱う */
  textSectionTitle?: string[];
}

export interface TableGuide {
  when?: string;
  text: string;
}

export const DEFAULT_MANUAL_RULES: ManualRules = {
  internalSectionStart: ["思案中", "【社内】", "社内用", "社内メモ"],
  excludeLine: ["要らないかもしれません", "載せときました", "^↑$", "原価", "売値", "仕入", "(もって|持って)これないか"],
  removeText: ["【個人[^】]*】", "（スエヨシ）", "\\(スエヨシ\\)", "（安企画）", "\\(安企画\\)", "（これからは[^）]*）"],
  columnAlias: {},
  tableKeywords: {},
  tableGuides: [],
  textSectionTitle: ["について$"],
};

export interface PriceRow {
  label: string;
  /** 列（columns）と同じ並び。空欄は "" */
  values: string[];
  /** 見出しのない列に入っていた補足（素材名など） */
  extra: string[];
}

export interface PriceTable {
  id: string;
  title: string;
  caption: string;
  columns: string[];
  rows: PriceRow[];
  notes: string[];
  keywords: string[];
  /** 回答に添える案内（manual-rules.json の tableGuides から） */
  guides?: TableGuide[];
}

export interface ParsedManual {
  textEntries: KnowledgeEntry[];
  tables: PriceTable[];
  tableEntries: KnowledgeEntry[];
  excluded: string[];
}

// ---------------- 共通の整形 ----------------

/** 半角カナ → 全角、空白（全角含む）を 1 つに */
export function tidy(s: string): string {
  return s
    .replace(/[｡-ﾟ]+/g, (m) => m.normalize("NFKC"))
    .replace(/[\s　]+/g, " ")
    .trim();
}

function compile(list: string[]): RegExp[] {
  return list
    .map((p) => {
      try {
        return new RegExp(p);
      } catch {
        return null;
      }
    })
    .filter((r): r is RegExp => r !== null);
}

interface CompiledRules {
  internal: RegExp[];
  exclude: RegExp[];
  remove: RegExp[];
  alias: Record<string, Record<string, string>>;
  keywords: Record<string, string[]>;
  guides: (TableGuide & { table: string })[];
  textSection: RegExp[];
}

function compileRules(r: ManualRules): CompiledRules {
  return {
    internal: compile(r.internalSectionStart),
    exclude: compile(r.excludeLine),
    remove: compile(r.removeText).map((x) => new RegExp(x.source, "g")),
    alias: r.columnAlias ?? {},
    keywords: r.tableKeywords ?? {},
    guides: r.tableGuides ?? [],
    textSection: compile(r.textSectionTitle ?? []),
  };
}

function clean(s: string, rules: CompiledRules): string {
  let t = tidy(s);
  for (const re of rules.remove) t = t.replace(re, "");
  return tidy(t);
}

const isNumeric = (s: string) => /^-?\d[\d,]*(\.\d+)?$/.test(s.trim());
const isValueCell = (s: string) => isNumeric(s) || /^(時価|なし|[-－―ー])$/.test(s.trim());

/** 金額の表記（44000 → 44,000円） */
export function formatValue(s: string): string {
  const t = s.trim();
  if (isNumeric(t)) {
    const n = Number(t.replace(/,/g, ""));
    return n >= 100 ? `${n.toLocaleString("ja-JP")}円` : String(n);
  }
  if (/^[-－―ー]$/.test(t)) return "—";
  return t;
}

// ---------------- 文章部分 ----------------

interface Line {
  text: string;
  row: number;
}

function isHeadingText(t: string): boolean {
  if (t.length > 24) return false;
  if (/^[・→※【（(「\d]/.test(t)) return false;
  if (/[：:→、]/.test(t)) return false;
  return true;
}

function bulletHead(t: string): string {
  const s = t.replace(/^・\s*/, "");
  return tidy(s.split(/[:：→]/)[0]).slice(0, 30);
}

function parseText(rows: string[][], end: number, rules: CompiledRules, excluded: string[]): KnowledgeEntry[] {
  const raw: string[] = [];
  for (let r = 0; r < end; r++) raw.push(tidy((rows[r] ?? []).filter((c) => c && c.trim()).join(" ")));
  const blank = (i: number) => i < 0 || i >= raw.length || raw[i] === "";
  const isHeadingAt = (i: number) =>
    raw[i] !== "" && isHeadingText(raw[i]) && blank(i - 1) && (blank(i + 1) || /^[【・]/.test(raw[i + 1] ?? ""));

  // 除外（社内向けの区間・行）
  const kept: (Line | null)[] = [];
  let internal = false;
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    if (!t) {
      kept.push(null);
      continue;
    }
    if (internal && isHeadingAt(i)) internal = false;
    if (rules.internal.some((re) => re.test(t))) {
      internal = true;
      excluded.push(t);
      kept.push(null);
      continue;
    }
    if (internal || rules.exclude.some((re) => re.test(t))) {
      excluded.push(t);
      kept.push(null);
      continue;
    }
    const c = clean(t, rules);
    kept.push(c ? { text: c, row: i + 1 } : null);
  }

  // 見出しで区切る
  interface Section {
    title: string;
    heading: boolean;
    lines: (Line | null)[];
  }
  const sections: Section[] = [];
  let cur: Section | null = null;
  for (let i = 0; i < kept.length; i++) {
    const l = kept[i];
    if (l && isHeadingAt(i)) {
      cur = { title: l.text, heading: true, lines: [] };
      sections.push(cur);
      continue;
    }
    if (!l && !cur) continue;
    if (!cur) {
      cur = { title: bulletHead(l!.text), heading: false, lines: [] };
      sections.push(cur);
    }
    cur.lines.push(l);
  }

  const entries: KnowledgeEntry[] = [];
  const push = (title: string, lines: Line[]) => {
    const content = lines.map((l) => l.text).join("\n");
    if (!content.trim()) return;
    entries.push({
      id: `m-r${lines[0].row}`,
      category: "顧客対応マニュアル",
      title,
      content,
      keywords: [],
      note: `シート ${lines[0].row}〜${lines[lines.length - 1].row} 行目`,
    });
  };
  for (const s of sections) {
    const lines = s.lines.filter((l): l is Line => l !== null);
    if (lines.length === 0) continue;
    const total = lines.reduce((n, l) => n + l.text.length, 0);
    const bullets = lines.filter((l) => l.text.startsWith("・")).length;
    if (bullets >= 2 && total > 350) {
      // 「・」の項目ごとに分ける（続きの行「→…」は同じ項目）
      let group: Line[] = [];
      let lead: Line[] = [];
      const flush = () => {
        if (group.length) push(s.heading ? `${s.title}｜${bulletHead(group[0].text)}` : bulletHead(group[0].text), group);
        group = [];
      };
      for (const l of lines) {
        if (l.text.startsWith("・")) {
          flush();
          group = [l];
        } else if (group.length) group.push(l);
        else lead.push(l);
      }
      flush();
      if (lead.length) push(s.title, lead);
      lead = [];
    } else if (total > 450) {
      // 段落（空行区切り）をまとめて 450 文字程度ごとに
      let buf: Line[] = [];
      let n = 0;
      let part = 1;
      for (const l of s.lines) {
        if (l === null) {
          if (n > 300) {
            push(`${s.title}（${part++}）`, buf);
            buf = [];
            n = 0;
          }
          continue;
        }
        buf.push(l);
        n += l.text.length;
      }
      if (buf.length) push(part > 1 ? `${s.title}（${part}）` : s.title, buf);
    } else {
      push(s.title, lines);
    }
  }
  return entries;
}

// ---------------- 料金表部分 ----------------

interface Cell {
  c: number;
  v: string;
}

function bandsOf(rows: string[][], start: number): [number, number][] {
  const width = rows.reduce((w, r) => Math.max(w, r?.length ?? 0), 0);
  const text = new Array(width).fill(0);
  const num = new Array(width).fill(0);
  for (let r = start; r < rows.length; r++) {
    (rows[r] ?? []).forEach((v, c) => {
      if (!v || !v.trim()) return;
      if (isValueCell(v)) num[c]++;
      else text[c]++;
    });
  }
  const used = (c: number) => text[c] + num[c] > 0;
  const bands: [number, number][] = [];
  let s = -1;
  for (let c = 0; c <= width; c++) {
    if (c < width && used(c)) {
      if (s < 0) s = c;
      continue;
    }
    if (s < 0) continue;
    // 空の列：左隣が品名の列（文字が多い列）なら結合セルの一部とみなして区切らない
    let e = c;
    while (e < width && !used(e)) e++;
    const labelLeft = text[c - 1] > num[c - 1];
    if (c < width && labelLeft && e < width) {
      c = e - 1;
      continue;
    }
    bands.push([s, c - 1]);
    s = -1;
  }
  return bands;
}

type Kind = "blank" | "header" | "super" | "data" | "labelOnly" | "title" | "note";

function cellsIn(row: string[] | undefined, c0: number, c1: number): Cell[] {
  const out: Cell[] = [];
  for (let c = c0; c <= c1; c++) {
    const v = row?.[c];
    if (v && v.trim()) out.push({ c, v: v.trim() });
  }
  return out;
}

/**
 * 表の見出しの横の注記（「2026.8.1」「【税込み 】」）。「税込」を含む長い文（「退去に伴う…8250円（へり込み・税込）」
 * 「畳床（たたみどこ）…税込（ぜいこみ）…」の読み方の一覧など）は注記ではなく資料の文（2026-10-28 まで、
 * この 3 行が注記とみなされて資料から抜けていた）
 */
const isMeta = (s: string) => /^\d{4}[./]\d{1,2}[./]\d{1,2}$/.test(s.trim()) || (s.trim().length <= 12 && /税込|税抜/.test(s));
const stripBrackets = (s: string) => tidy(s.replace(/[【】]/g, " "));

function parseBand(rows: string[][], start: number, c0: number, c1: number, rules: CompiledRules, excluded: string[]): PriceTable[] {
  const tables: PriceTable[] = [];
  // 行の種類：見出し行・値のある行・品名だけの行・メモ など（日付や「税込み」の注記は判定に使わない）
  const kindOf = (r: number): Kind => {
    const cells = cellsIn(rows[r], c0, c1).filter((x) => !isMeta(x.v));
    if (cells.length === 0) return "blank";
    const first = cells.find((x) => x.c === c0)?.v ?? "";
    const others = cells.filter((x) => x.c !== c0);
    const values = others.filter((x) => isValueCell(x.v));
    const texts = others.filter((x) => !isValueCell(x.v));
    if (values.length > 0) return "data";
    if (others.length >= 2 && !first.startsWith("※") && texts.every((x) => x.v.length <= 32 && !x.v.startsWith("※") && !/円/.test(x.v)))
      return "header";
    if (!first && others.length === 1 && !others[0].v.startsWith("※") && others[0].v.length <= 12) return "super";
    if (first && others.length === 0) return "labelOnly";
    return "note";
  };
  const nextNonBlank = (r: number): number => {
    for (let i = r + 1; i < rows.length; i++) if (kindOf(i) !== "blank") return i;
    return -1;
  };

  let table = null as PriceTable | null; // newTable() の中で書き換えるため、null への絞り込みを避ける
  let colIdx: number[] = [];
  let group = "";
  let lastNote = "";
  let notesSinceTitle = 0;
  const newTable = (title: string, notes: string[] = [], caption = ""): PriceTable => {
    const t: PriceTable = { id: "", title, caption, columns: [], rows: [], notes: [...notes], keywords: [] };
    table = t;
    colIdx = [];
    group = "";
    lastNote = "";
    notesSinceTitle = 0;
    tables.push(t);
    return t;
  };
  const addNote = (text: string) => {
    if (!text) return;
    if (rules.exclude.some((re) => re.test(text))) {
      excluded.push(tidy(text));
      return;
    }
    const c = clean(text, rules);
    if (!c) return;
    (table ?? newTable("料金表")).notes.push(c);
    lastNote = c;
    notesSinceTitle++;
  };

  for (let r = start; r < rows.length; r++) {
    const kind = kindOf(r);
    if (kind === "blank") continue;
    const all = cellsIn(rows[r], c0, c1);
    const cells = all.filter((x) => !isMeta(x.v));
    const meta = all.filter((x) => isMeta(x.v)).map((x) => stripBrackets(x.v));
    const first = cells.find((x) => x.c === c0)?.v ?? "";
    const others = cells.filter((x) => x.c !== c0);

    if ((kind === "labelOnly" && !first.startsWith("※")) || (kind === "note" && first && !first.startsWith("※") && first.length <= 40)) {
      const nx = nextNonBlank(r);
      const nk = nx >= 0 ? kindOf(nx) : "blank";
      // 値のない品名（同じ表の続きの行と同じ列に値が並ぶ場合）
      if (kind === "labelOnly" && (table as PriceTable | null) && colIdx.length > 0 && nk === "data") {
        const nextVals = cellsIn(rows[nx], c0, c1).filter((x) => x.c !== c0 && isValueCell(x.v)).map((x) => x.c);
        const overlap = nextVals.filter((c) => colIdx.includes(c)).length;
        if (nextVals.length >= 2 && overlap >= Math.ceil(nextVals.length / 2)) {
          (table as PriceTable).rows.push({ label: clean(first, rules), values: colIdx.map(() => ""), extra: [] });
          continue;
        }
      }
      // 表題（短い単独の語、または直後に見出し行・値の行が続く行）
      const shortTitle = kind === "labelOnly" && first.length <= 12 && !/^[・→※（(]/.test(first);
      if (shortTitle || nk === "header" || nk === "super" || (nk === "data" && kind === "labelOnly")) {
        const parts = clean(first, rules).split(/\s*※/);
        const notes = parts.slice(1).map((p) => `※${tidy(p)}`);
        const rest = others.map((x) => clean(x.v, rules)).filter(Boolean);
        newTable(stripBrackets(parts[0]) || "料金表", [...notes, ...rest], meta.join("・"));
        continue;
      }
    }

    if (kind === "super") {
      const nx = nextNonBlank(r);
      if (nx >= 0 && kindOf(nx) === "header") {
        group = clean(others[0].v, rules);
        continue;
      }
      addNote(others.map((x) => x.v).join(" "));
      continue;
    }

    if (kind === "header") {
      let t: PriceTable | null = table as PriceTable | null;
      if (!t) t = newTable("料金表");
      else if (t.rows.length > 0 || t.columns.length > 0) t = newTable(`${t.title}（続き）`);
      else if (notesSinceTitle > 0 && lastNote) {
        // 「雑工事」のように文章のあとに小さな表が続く場合は、直前の行を表題にした別の表にする
        const parent = t;
        const title = stripBrackets(lastNote);
        if (parent.notes[parent.notes.length - 1] === lastNote) parent.notes.pop();
        t = newTable(title);
        t.caption = parent.title;
      }
      const cap = first ? clean(first, rules) : "";
      t.caption = [t.caption, ...meta, group, cap].filter(Boolean).join("・");
      const alias = rules.alias[t.title] ?? {};
      colIdx = others.map((x) => x.c);
      t.columns = others.map((x) => {
        const label = clean(x.v, rules);
        return alias[label] ?? label;
      });
      group = "";
      continue;
    }

    if (kind === "data") {
      const t: PriceTable = table ?? newTable("料金表");
      const label = clean(first, rules);
      if (colIdx.length === 0) {
        // 見出しのない表（ヘリの価格など）は値をそのまま
        t.rows.push({ label, values: [], extra: others.map((x) => clean(x.v, rules)).filter(Boolean) });
        continue;
      }
      const values = colIdx.map((c) => {
        const v = cells.find((x) => x.c === c)?.v ?? "";
        return v ? clean(v, rules) : "";
      });
      const extra: string[] = [];
      for (const x of others.filter((o) => !colIdx.includes(o.c))) {
        const v = clean(x.v, rules);
        if (!v) continue;
        // 見出しのない列の金額は、左隣の文字の値（引手の品番など）に添える
        const j = colIdx.reduce((best, c, i) => (c < x.c && values[i] && !isValueCell(values[i]) ? i : best), -1);
        if (isValueCell(v) && j >= 0) values[j] = `${values[j]}（${formatValue(v)}）`;
        else extra.push(v);
      }
      t.rows.push({ label, values, extra });
      continue;
    }

    // メモ。列の見出しにそろった短い補足（サイズの目安など）は「列名 値」にする
    const t = table as PriceTable | null;
    const aligned = others.filter((x) => colIdx.includes(x.c) && !/円/.test(x.v) && !x.v.startsWith("※"));
    if (t && aligned.length >= 2) {
      if (first) addNote(first);
      addNote(`目安：${aligned.map((x) => `${t.columns[colIdx.indexOf(x.c)]} ${clean(x.v, rules)}`).join("／")}`);
      for (const x of others.filter((o) => !aligned.includes(o))) addNote(x.v);
      continue;
    }
    const parts: string[] = [];
    for (const x of cells) {
      if (rules.exclude.some((re) => re.test(x.v))) excluded.push(tidy(x.v));
      else parts.push(x.v);
    }
    addNote(parts.join(" "));
  }
  return tables;
}

function rowText(t: PriceTable, row: PriceRow, onlyCols?: number[]): string {
  const label = row.extra.length && t.columns.length ? `${row.label}（${row.extra.join("・")}）` : row.label;
  if (t.columns.length === 0) {
    const vals = row.extra.map(formatValue).filter(Boolean);
    return vals.length ? `${label}：${vals.join("・")}` : label;
  }
  const parts: string[] = [];
  const filled = row.values.map((v, i) => [i, v] as const).filter(([, v]) => v);
  const cols = onlyCols ?? filled.map(([i]) => i);
  if (filled.length === 1 && !onlyCols) {
    return `${label}：${formatValue(filled[0][1])}`;
  }
  for (const i of cols) {
    const v = row.values[i];
    // 料金表の「-」（その大きさ・種類は取り扱いがない）は書かない（「中 —」ではお客様に伝わらないため）
    if (!v || /^[-－―ー—]$/.test(v.trim())) continue;
    parts.push(`${t.columns[i] || "料金"} ${formatValue(v)}`);
  }
  return parts.length ? `${label}：${parts.join("／")}` : `${label}：—`;
}

export function tableToText(t: PriceTable, opts: { rows?: PriceRow[]; cols?: number[]; notes?: boolean } = {}): string {
  const head = `【${t.title}】${t.caption ? `（${t.caption}）` : ""}`;
  const rows = (opts.rows ?? t.rows).map((r) => rowText(t, r, opts.cols));
  const notes = opts.notes === false ? [] : [...t.notes, ...(t.guides ?? []).map((g) => g.text)];
  return [head, ...rows, ...notes].join("\n");
}

/** 表題・列名・品名からお客様の言い方での検索語を作る */
const SYNONYMS: [RegExp, string[]][] = [
  [/畳/, ["畳", "たたみ"]],
  [/表替え/, ["表替え", "畳替え", "張替え"]],
  [/襖/, ["襖", "ふすま"]],
  [/障子/, ["障子", "しょうじ"]],
  [/網戸|アミ戸|アミド/, ["網戸", "アミ戸", "あみど"]],
  [/ヘリ無し|縁無/, ["ヘリ無し", "ヘリなし", "へりなし", "縁なし", "縁無し", "琉球"]],
  [/ヘリ有り/, ["ヘリ有り", "ヘリあり", "縁あり", "縁付き"]],
  [/^ヘリ$/, ["ヘリ", "へり", "縁", "畳縁"]],
  [/置き畳/, ["置き畳", "置畳", "ユニット畳"]],
  [/新調/, ["新調", "新しく", "交換"]],
  [/カーテンレール/, ["カーテンレール", "レール"]],
  [/雑工事/, ["ブラインド", "ロールスクリーン", "アコーディオン", "床張替え", "畳下", "ガラス", "フィルム", "クロス", "壁紙", "トイレ"]],
  [/退去/, ["退去", "引っ越し", "賃貸", "原状回復"]],
];

function keywordsFor(t: PriceTable, rules: CompiledRules): string[] {
  const set = new Set<string>();
  const add = (s: string) => {
    const x = s.trim();
    if (x.length >= 1) set.add(x);
  };
  // 表題・注記から（列名は「新調」「表替え」だけ。「置き畳床」の列で置き畳の表と混同しないように）
  const fields = [t.title, t.caption];
  for (const [re, words] of SYNONYMS) {
    if (fields.some((x) => re.test(x)) || ((re.source === "新調" || re.source === "表替え") && t.columns.some((c) => re.test(c)))) words.forEach(add);
  }
  for (const k of rules.keywords[t.title] ?? []) add(k);
  return [...set];
}

/** 文章のまとまり（「畳について」など）→「・」の項目ごとのナレッジ（続きの行「→…」「※…」は同じ項目） */
function sectionEntries(t: PriceTable, n: number, rules: CompiledRules): KnowledgeEntry[] {
  const groups: string[][] = [];
  for (const line of t.notes) {
    if (line.startsWith("・") || groups.length === 0) groups.push([line]);
    else groups[groups.length - 1].push(line);
  }
  const keywords = keywordsFor(t, rules);
  // 見出しは最初の区切り（空白・。・、）まで（「畳表の耐用年数目安 極み：30年 …」→「畳表の耐用年数目安」）
  const head = (line: string) => {
    const h = bulletHead(line);
    const cut = h.search(/[\s。、]/);
    return cut >= 4 ? h.slice(0, cut) : h;
  };
  return groups.map((g, i) => ({
    id: `m-s${n}-${i + 1}`,
    category: "顧客対応マニュアル",
    title: `${t.title}｜${head(g[0])}`,
    content: g.join("\n"),
    keywords,
    note: `シートの「${t.title}」`,
  }));
}

/**
 * 張替えの行で「虫が嫌がる網／銀黒」のように 2 つの品名が同じ料金の行になっていて、新調の行が片方（「新調銀黒」）だけのとき、
 * 新調の行にも同じ組を書く（「新調虫が嫌がる網／銀黒」）。網戸の表は張替えと新調で同じ順に並び（18メッシュ・24メッシュ・
 * ガラスネット・虫が嫌がる網／銀黒・ペットディフェンス・ステンレス）、新調の行名だけが片方になっていたため、AI が
 * 「虫が嫌がる網の新調の料金はお答えできかねます」と答えた（一畳屋様のご指摘 2026-10-29 EST-20261029-7X7B）。
 * もう片方の新調の行があるとき（「新調虫が嫌がる網」もある）は変えない
 */
function pairNewRows(t: PriceTable): void {
  const key = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");
  const pairs = t.rows.map((r) => r.label).filter((l) => !l.startsWith("新調") && /[／/]/.test(l));
  const newRows = new Set(t.rows.filter((r) => r.label.startsWith("新調")).map((r) => key(r.label.slice(2))));
  for (const row of t.rows) {
    if (!row.label.startsWith("新調")) continue;
    const name = key(row.label.slice(2));
    const pair = pairs.find((p) => p.split(/[／/]/).map(key).includes(name));
    if (!pair) continue;
    const others = pair.split(/[／/]/).map(key).filter((x) => x !== name);
    if (others.length && others.every((x) => x && !newRows.has(x))) row.label = `新調${pair}`;
  }
}

/**
 * シートの全セル（行×列、空行も位置を保ったもの）を解析する。
 * 文章部分は「最初に 3 つ以上のセルが並ぶ行」の手前まで。
 */
export function parseManualGrid(rows: string[][], rulesIn: ManualRules = DEFAULT_MANUAL_RULES): ParsedManual {
  const rules = compileRules({ ...DEFAULT_MANUAL_RULES, ...rulesIn });
  const excluded: string[] = [];
  let tableStart = rows.findIndex((r) => (r ?? []).filter((c) => c && c.trim()).length >= 3);
  if (tableStart < 0) tableStart = rows.length;
  const textEntries = parseText(rows, tableStart, rules, excluded);

  const tables: PriceTable[] = [];
  if (tableStart < rows.length) {
    for (const [c0, c1] of bandsOf(rows, tableStart)) tables.push(...parseBand(rows, tableStart, c0, c1, rules, excluded));
  }
  // 料金表の下の文章（「畳について」など、値の行がなく文章だけのまとまり）は文章として扱う
  const isTextSection = (t: PriceTable) => t.rows.length === 0 && t.notes.length > 0 && rules.textSection.some((re) => re.test(t.title));
  tables.filter(isTextSection).forEach((t, i) => textEntries.push(...sectionEntries(t, i + 1, rules)));
  const kept = tables.filter((t) => !isTextSection(t) && (t.rows.length > 0 || t.notes.length > 0));
  kept.forEach(pairNewRows);
  kept.forEach((t, i) => {
    t.id = `m-p${String(i + 1).padStart(2, "0")}`;
    t.keywords = keywordsFor(t, rules);
    const guides = rules.guides.filter((g) => g.table === t.title).map(({ when, text }) => (when ? { when, text } : { text }));
    if (guides.length) t.guides = guides;
  });
  const tableEntries: KnowledgeEntry[] = kept.map((t) => ({
    id: t.id,
    category: "料金表（顧客対応マニュアル）",
    title: t.caption ? `${t.title}（${t.caption}）` : t.title,
    content: tableToText(t),
    keywords: [...t.keywords, ...t.rows.flatMap((r) => r.label.split(/[／/・\s（）()]+/).filter((x) => x.length >= 2))].slice(0, 80),
  }));
  return { textEntries, tables: kept, tableEntries, excluded };
}

// ---------------- Q&A 形式のシート ----------------

function splitKeywords(s: string): string[] {
  return s
    .split(/[、,，/／;；|｜\n\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

const HEADER_MAP: { key: keyof KnowledgeEntry; patterns: RegExp }[] = [
  { key: "category", patterns: /(カテゴリ|分類|区分|category)/i },
  { key: "title", patterns: /(質問|項目|タイトル|見出し|件名|title|question)/i },
  { key: "content", patterns: /(回答|内容|本文|説明|answer|content)/i },
  { key: "keywords", patterns: /(キーワード|検索語|タグ|keyword|tag)/i },
  { key: "note", patterns: /(備考|メモ|注意|note)/i },
];

/** 「カテゴリ／質問／回答／キーワード」形式の表か（1 行目に列名が 2 つ以上） */
function qaHeader(rows: string[][]): Partial<Record<keyof KnowledgeEntry, number>> | null {
  const first = rows.find((r) => (r ?? []).some((c) => c && c.trim()));
  if (!first) return null;
  const colIndex: Partial<Record<keyof KnowledgeEntry, number>> = {};
  let matched = 0;
  first.forEach((h, i) => {
    for (const { key, patterns } of HEADER_MAP) {
      if (colIndex[key] === undefined && patterns.test((h ?? "").trim()) && (h ?? "").trim().length <= 20) {
        colIndex[key] = i;
        matched++;
        break;
      }
    }
  });
  return matched >= 2 && colIndex.content !== undefined ? colIndex : null;
}

/** Q&A 形式のシート → ナレッジ */
export function rowsToEntries(rows: string[][]): KnowledgeEntry[] {
  const colIndex = qaHeader(rows);
  if (!colIndex) return [];
  const body = rows.filter((r) => (r ?? []).some((c) => c && c.trim())).slice(1);
  const pick = (r: string[], key: keyof KnowledgeEntry) => {
    const i = colIndex[key];
    return i === undefined ? "" : (r[i] ?? "").toString().trim();
  };
  const entries: KnowledgeEntry[] = [];
  body.forEach((r, idx) => {
    const title = pick(r, "title");
    const content = pick(r, "content");
    if (!title && !content) return;
    entries.push({
      id: `s${String(idx + 1).padStart(3, "0")}`,
      category: pick(r, "category") || "顧客対応マニュアル",
      title: title || content.slice(0, 30),
      content: content || title,
      keywords: splitKeywords(pick(r, "keywords")),
      note: pick(r, "note") || undefined,
      origin: "manual",
    });
  });
  return entries;
}

// ---------------- シート全体 → マニュアル ----------------

export interface ManualData {
  entries: KnowledgeEntry[];
  tables: PriceTable[];
  /** 社内向けとして除外した行 */
  excluded: string[];
}

/** シートの全セル → マニュアル（Q&A 形式ならそのまま、自由形式なら文章と料金表に分けて解析） */
/** Googleスプレッドシートの表示形式（通貨「¥27,500」・「27,500円」）の金額だけのセルを数字にそろえる */
function plainAmount(cell: string): string {
  const t = (cell ?? "").toString().trim();
  if (/^[¥￥]\s*-?[\d,]+$/.test(t)) return t.replace(/[¥￥\s]/g, "");
  if (/^-?[\d,]+\s*円$/.test(t)) return t.replace(/[円\s]/g, "");
  return cell ?? "";
}

export function gridToManual(grid: string[][], rules: ManualRules = DEFAULT_MANUAL_RULES): ManualData {
  const rows = grid.map((r) => (r ?? []).map(plainAmount));
  if (qaHeader(rows)) return { entries: rowsToEntries(rows), tables: [], excluded: [] };
  const parsed = parseManualGrid(rows, rules);
  const entries = [...parsed.textEntries, ...parsed.tableEntries].map((e) => ({ ...e, origin: "manual" as const }));
  return { entries, tables: parsed.tables, excluded: parsed.excluded };
}
