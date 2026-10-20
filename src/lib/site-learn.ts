// 一畳屋ホームページ（ichijoya.co.jp）の本文を読み取り、AIのナレッジ（見出しごとのまとまり）にする
//   ・scripts/learn-website.mjs（Node から直接実行）と、管理画面の「ホームページから再学習」の両方で使う
//   ・そのため他のモジュールを実行時に読み込まない（型の import のみ）
import type { KnowledgeEntry } from "./types";

export const SITE_BASE = "https://ichijoya.co.jp";

/** 学習するページ（お知らせ・採用・LINE のページは、時期で変わる内容や AI 相談と重なる内容のため対象外） */
export const SITE_PAGES: { path: string; label: string }[] = [
  { path: "/", label: "トップ" },
  { path: "/about/", label: "会社・店舗案内" },
  { path: "/change/", label: "畳替え" },
  { path: "/door/", label: "襖・障子・アミ戸" },
];

/**
 * ホームページの表記のうち、顧客対応マニュアル（社内）と食い違うものは学習しない。
 * （例：襖は「2日仕上げ」→ マニュアルでは「基本2泊3日」、職人数・施工件数の表記もマニュアルの表現を正とする）
 */
const SITE_OVERRIDES: { pattern: RegExp; replace?: string }[] = [
  { pattern: /2日仕上げ/g, replace: "" },
  // 一畳屋の案内では「迷ったら さくら」「一番人気は やすらぎ」
  { pattern: /「迷ったらコレ」と言える商品です/g, replace: "一番人気の商品です" },
  { pattern: /^※\s*$/ },
  { pattern: /7名在中|県内最多/ },
  { pattern: /年間2,000件/ },
  { pattern: /受付\s*\d{1,2}:\d{2}/ },
  { pattern: /\s*MAP\b/g, replace: "" },
];

const DROP_LINE = [
  /^(詳細はこちら|見本を見る|See All Reviews|-->|MAP|お知らせ・コラム一覧|js_loader)$/,
  /^音声が流れます/,
  /^こちらは一例です/,
  /^(得意分野|好きな言葉|趣味)$/,
  /^(ヘリ無し畳|ヘリ有り畳|施工事例|襖|障子|アミ戸)$/,
];

/** 学習しない見出し（動画・お知らせ一覧・施工事例へのリンク集など） */
const DROP_SECTION = /^(新しいCMができました|お知らせ・コラム|施工事例|無料お見積・お問い合わせ)$/;

function tidy(s: string): string {
  return s
    .replace(/[｡-ﾟ]+/g, (m) => m.normalize("NFKC"))
    .replace(/[\s　]+/g, " ")
    .trim();
}

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/**
 * 本文（ヘッダー・お問い合わせ欄・フッターを除く）をテキスト行に。
 * 見出しは「#2 見出し」のように階層つきで出力し、画像の見出し文字は alt を使う。表の行は「項目：内容」にまとめる。
 */
export function htmlToLines(html: string): string[] {
  let h = html;
  const start = h.indexOf("l-body__main");
  if (start > 0) {
    const end = h.indexOf('class="p-contact', start);
    h = h.slice(h.indexOf(">", start) + 1, end > start ? h.lastIndexOf("<", end) : undefined);
  }
  // Google の口コミ欄は学習しない
  for (let i = h.indexOf('<div class="wp-gr'); i >= 0; i = h.indexOf('<div class="wp-gr')) {
    const j = h.indexOf('alt="js_loader"', i);
    const k = j > 0 ? h.indexOf(">", j) : -1;
    h = h.slice(0, i) + (k > 0 ? h.slice(k + 1) : "");
    if (k < 0) break;
  }
  const alt = (s: string) => s.replace(/<img[^>]*\balt="([^"]+)"[^>]*>/gi, " ⟦$1⟧ ").replace(/<img[^>]*>/gi, "");
  h = h
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    // 見出し（画像の見出し文字が複数行に分かれている）を 1 行に
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, l: string, inner: string) => `\n#${l} ${alt(inner).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")}\n`)
    // 表の行は「見出しセル：内容」の 1 行に
    .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_m, inner: string) => {
      const row = alt(inner)
        .replace(/<\/th>/gi, "：")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .replace(/\s*：\s*/g, "：")
        .trim();
      return `\n${row.replace(/^：/, "").replace(/：$/, "")}\n`;
    });
  const text = alt(h)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|dt|dd|section|article|ul|ol|table|figure|figcaption)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decode(text)
    .split("\n")
    .map((l) => tidy(l))
    .filter(Boolean);
}

interface Chunk {
  path: string[];
  lines: string[];
}

function headingText(text: string): string {
  const alts = [...text.matchAll(/⟦([^⟧]+)⟧/g)].map((m) => tidy(m[1]));
  if (alts.length === 0) return tidy(text);
  // 「襖張替え価格」「全100柄（無地有り）」のように画像が並ぶ見出しはつなげる（同じ語で始まる長い説明画像は除く）
  return tidy(alts.filter((a, i) => i === 0 || !a.startsWith(alts[0])).join(" "));
}

function applyOverrides(line: string): string | null {
  let l = line;
  for (const o of SITE_OVERRIDES) {
    if (o.replace !== undefined) l = l.replace(o.pattern, o.replace);
    else if (o.pattern.test(l)) return null;
  }
  l = tidy(l);
  return l ? l : null;
}

/** 1 ページ分の HTML → ナレッジ */
export function extractSiteEntries(html: string, page: { path: string; label: string }, base = SITE_BASE): KnowledgeEntry[] {
  const lines = htmlToLines(html);
  const chunks: Chunk[] = [];
  const stack: { level: number; title: string; drop: boolean }[] = [];
  let cur: Chunk | null = null;
  let dropNext = false;
  const dropping = () => stack.some((s) => s.drop);
  for (const raw of lines) {
    const hm = raw.match(/^#([1-6]) (.*)$/);
    if (hm) {
      const level = Number(hm[1]);
      const title = applyOverrides(headingText(hm[2])) ?? "";
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title, drop: DROP_SECTION.test(title) });
      cur = null;
      continue;
    }
    if (dropping()) continue;
    if (dropNext) {
      dropNext = false;
      continue;
    }
    const l = tidy(raw.replace(/⟦([^⟧]+)⟧/g, "$1"));
    if (DROP_LINE.some((re) => re.test(l)) || /^\d{4}\.\d{1,2}\.\d{1,2}$/.test(l)) {
      if (/^(得意分野|好きな言葉|趣味)$/.test(l)) dropNext = true;
      continue;
    }
    // 口コミの名残（「名前07:52 05 Nov 21」のような行）は除く
    if (/\d{2}:\d{2} \d{2} [A-Z][a-z]{2} \d{2}/.test(l)) continue;
    const fixed = applyOverrides(l);
    if (!fixed) continue;
    if (!cur) {
      const path = stack.filter((s) => s.title && s.level >= 2).map((s) => s.title);
      cur = { path: path.length ? path : stack.map((s) => s.title).filter(Boolean), lines: [] };
      chunks.push(cur);
    }
    if (cur.lines[cur.lines.length - 1] !== fixed) cur.lines.push(fixed);
  }

  // 次の見出しと同じ文字だけの行（見本画像の説明など）は除き、重複・短すぎるまとまりを整理
  const out: KnowledgeEntry[] = [];
  const seen = new Set<string>();
  let n = 0;
  chunks.forEach((c, i) => {
    const nextTitle = chunks[i + 1]?.path[chunks[i + 1].path.length - 1];
    if (nextTitle && c.lines[c.lines.length - 1] === nextTitle) c.lines.pop();
    const content = c.lines.join("\n").trim();
    if (content.length < 12) return;
    const key = content.slice(0, 80);
    if (seen.has(key)) return;
    seen.add(key);
    n++;
    const title = c.path.slice(-2).join("｜") || page.label;
    out.push({
      id: `w${page.path === "/" ? "-top" : page.path.replace(/\//g, "-").replace(/-$/, "")}-${String(n).padStart(2, "0")}`,
      category: "ホームページ",
      title: `${page.label}｜${title}`,
      content: content.slice(0, 1500),
      keywords: [],
      note: `${base}${page.path}`,
    });
  });
  return out;
}

export interface SiteLearnResult {
  fetchedAt: string;
  base: string;
  pages: { path: string; label: string; entries: number; error?: string }[];
  entries: KnowledgeEntry[];
}

/** ホームページの各ページを取得して学習（失敗したページは結果に記録して続行） */
export async function learnWebsite(base = SITE_BASE, fetchImpl: typeof fetch = fetch): Promise<SiteLearnResult> {
  const pages: SiteLearnResult["pages"] = [];
  const entries: KnowledgeEntry[] = [];
  for (const p of SITE_PAGES) {
    try {
      const res = await fetchImpl(`${base}${p.path}`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; IchijoyaAIConsult/1.0; +https://ichijoya.co.jp/)" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const found = extractSiteEntries(await res.text(), p, base);
      entries.push(...found);
      pages.push({ ...p, entries: found.length });
    } catch (e) {
      pages.push({ ...p, entries: 0, error: (e as Error).message });
    }
  }
  return { fetchedAt: new Date().toISOString(), base, pages, entries };
}
