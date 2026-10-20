// 管理画面で追加した文章・アップロードしたファイルを解析して、AI の回答に使うナレッジにする
//   ・Excel／CSV … Q&A 形式の表はそのまま、料金表は顧客対応マニュアルと同じ解析（「料金表・顧客対応マニュアル」はマニュアルを差し替え）
//   ・Word／PowerPoint／テキスト／Markdown／HTML … 文字を取り出して AI が話題ごとに整理
//   ・PDF／画像 … OpenAI が読み取って整理（OpenAI キーが必要）
//   AI は資料に書かれた事実だけを使い、社内向けの情報（原価・仕入れ・個人情報など）は含めない
import { env } from "./env";
import { categoryOf, ENTRY_CATEGORIES } from "./knowledge-categories";
import { MANUAL_RULES, parseCsv } from "./knowledge";
import { gridToManual, rowsToEntries, type ManualData, type PriceTable } from "./manual";
import { chatCompletionJson, type ChatContentPart } from "./openai";
import { htmlToLines } from "./site-learn";
import { readXlsx, readZipText, zipEntryNames } from "./xlsx";

export interface Extracted {
  kind: "text" | "grid" | "pdf" | "image";
  text?: string;
  grids?: { name: string; rows: string[][] }[];
  dataUrl?: string;
}

export interface AnalyzedEntry {
  category: string;
  title: string;
  content: string;
  keywords: string[];
  questions: string[];
  table?: PriceTable;
}

export interface AnalysisResult {
  entries: AnalyzedEntry[];
  /** 「料金表・顧客対応マニュアル」の Excel：マニュアルを差し替える */
  manual?: ManualData;
  mode: "openai" | "rules" | "table";
  note?: string;
  excerpt: string;
}

const MAX_CHUNK = 8000;
const MAX_CHUNKS = 6;

function ext(name: string): string {
  return (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
}

/** UTF-8 で読めなければ Shift_JIS（Excel で保存した CSV など） */
function decodeText(buf: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(buf).replace(/^﻿/, "");
  if ((utf8.match(/�/g) ?? []).length <= 3) return utf8;
  try {
    return new TextDecoder("shift_jis").decode(buf);
  } catch {
    return utf8;
  }
}

function xmlText(xml: string, paragraph: RegExp): string {
  return xml
    .replace(paragraph, "\n")
    .replace(/<w:tab\/>|<a:tab\/>/g, "\t")
    .replace(/<w:br\/>|<a:br\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** ファイルから中身を取り出す */
export function extract(name: string, mime: string, data: Uint8Array): Extracted {
  const e = ext(name);
  const buf = Buffer.from(data);
  if (e === "xlsx" || e === "xlsm") {
    const sheets = readXlsx(buf);
    if (sheets.length === 0) throw new Error("Excel にシートがありません");
    return { kind: "grid", grids: sheets.map((s) => ({ name: s.name, rows: s.rows })) };
  }
  if (e === "xls") throw new Error("古い Excel 形式（.xls）は読めません。Excel で「.xlsx」形式で保存し直してからアップロードしてください");
  if (e === "csv" || e === "tsv") {
    const text = decodeText(data);
    const rows = e === "tsv" ? text.split(/\r?\n/).map((l) => l.split("\t")) : parseCsv(text, true);
    return { kind: "grid", grids: [{ name, rows }] };
  }
  if (e === "docx") {
    const xml = readZipText(buf, "word/document.xml");
    if (!xml) throw new Error("Word ファイルの本文を読み取れませんでした");
    return { kind: "text", text: xmlText(xml, /<\/w:p>/g) };
  }
  if (e === "pptx") {
    const slides = zipEntryNames(buf)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/\d+/g)?.pop()) - Number(b.match(/\d+/g)?.pop()));
    const text = slides.map((n, i) => `【スライド${i + 1}】\n${xmlText(readZipText(buf, n) ?? "", /<\/a:p>/g)}`).join("\n\n");
    return { kind: "text", text };
  }
  if (e === "pdf" || mime === "application/pdf") return { kind: "pdf", dataUrl: `data:application/pdf;base64,${buf.toString("base64")}` };
  if (/^(png|jpe?g|webp|gif)$/.test(e) || mime.startsWith("image/")) {
    const type = mime.startsWith("image/") ? mime : `image/${e === "jpg" ? "jpeg" : e}`;
    return { kind: "image", dataUrl: `data:${type};base64,${buf.toString("base64")}` };
  }
  if (e === "html" || e === "htm") return { kind: "text", text: htmlToLines(decodeText(data)).join("\n") };
  if (/^(txt|md|json|text|log)$/.test(e) || mime.startsWith("text/") || mime === "application/json") return { kind: "text", text: decodeText(data) };
  throw new Error(`この形式（.${e || "不明"}）には対応していません。Excel・CSV・Word・PowerPoint・PDF・画像・テキストに対応しています`);
}

// ---------------- AI による整理 ----------------

const SYSTEM = `あなたは熊本の畳店「一畳屋」の資料整理担当です。渡された資料から、お客様からの問い合わせに AI 相談員が答えるための情報を抜き出し、話題ごとの項目（ナレッジ）に分けて JSON で出力してください。
# ルール
- 資料に書かれている事実だけを使う。推測・一般論・誇張を足さない。数字・金額・期間・条件・商品名は資料のまま書く。
- 1 項目 = 1 つの話題（例：営業時間、畳表の種類と特徴、ある商品の料金）。資料の内容は漏らさず、どこかの項目に入れる。
- content はお客様にそのまま伝えられる丁寧な「です・ます」の文章（1〜8文）。料金は品名と金額を省略せずに書く。
- 社内向けの情報（原価・仕入れ値・利益・売値の計算式・社員の個人情報・社内メモ・検討中の事項）は含めない。
- title は項目の見出し（25字以内）。keywords はお客様が使いそうな語（5〜12個）。questions はお客様の聞き方の例（3〜6個）。
- category は次から選ぶ：${ENTRY_CATEGORIES.join(" / ")}（分類の指定があればそれを使う）。
- お客様対応に使える情報がなければ entries は空の配列にする。`;

const SCHEMA = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string" },
          title: { type: "string" },
          content: { type: "string" },
          keywords: { type: "array", items: { type: "string" } },
          questions: { type: "array", items: { type: "string" } },
        },
        required: ["category", "title", "content", "keywords", "questions"],
        additionalProperties: false,
      },
    },
  },
  required: ["entries"],
  additionalProperties: false,
} as const;

function chunks(text: string): { parts: string[]; truncated: boolean } {
  const parts: string[] = [];
  let buf = "";
  for (const para of text.split(/\n{2,}/)) {
    if (buf && buf.length + para.length + 2 > MAX_CHUNK) {
      parts.push(buf);
      buf = "";
    }
    // 1 段落が長すぎる場合は行で分ける
    if (para.length > MAX_CHUNK) {
      for (const line of para.split("\n")) {
        if (buf && buf.length + line.length + 1 > MAX_CHUNK) {
          parts.push(buf);
          buf = "";
        }
        buf += (buf ? "\n" : "") + line.slice(0, MAX_CHUNK);
      }
      continue;
    }
    buf += (buf ? "\n\n" : "") + para;
  }
  if (buf.trim()) parts.push(buf);
  return { parts: parts.slice(0, MAX_CHUNKS), truncated: parts.length > MAX_CHUNKS };
}

async function askAI(content: string | ChatContentPart[]): Promise<AnalyzedEntry[]> {
  const out = await chatCompletionJson<{ entries: AnalyzedEntry[] }>({
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content },
    ],
    temperature: 0.1,
    maxTokens: 8000,
    jsonSchema: { name: "knowledge_entries", schema: SCHEMA as unknown as Record<string, unknown> },
    purpose: "ingest",
    timeoutMs: 55_000,
  });
  return out.entries ?? [];
}

function header(name: string, category: string, note?: string): string {
  const c = categoryOf(category);
  return `【資料名】${name}\n【分類の指定】${c.entry || "おまかせ（内容に合わせて選ぶ）"}${note ? `\n【管理者からの補足】${note}` : ""}`;
}

// ---------------- AI を使わない整理（OpenAI 未設定時） ----------------

const HEADING = /^(#{1,6}\s+|[■□●○◆◇▼▽★☆【]|\d+[.．、)]\s*|[（(]\d+[)）]\s*)/;

function ruleEntries(text: string, category: string): AnalyzedEntry[] {
  const fallbackCategory = categoryOf(category).entry || "その他";
  const blocks: string[][] = [];
  let cur: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      if (cur.length) blocks.push(cur);
      cur = [];
      continue;
    }
    if (HEADING.test(line) && cur.length) {
      blocks.push(cur);
      cur = [];
    }
    cur.push(line);
  }
  if (cur.length) blocks.push(cur);
  const out: AnalyzedEntry[] = [];
  for (const b of blocks) {
    const title = b[0].replace(HEADING, "").replace(/[】：:]+$/, "").replace(/】/, " ").trim().slice(0, 40);
    const body = (b.length > 1 ? b.slice(1) : b).join("\n");
    if (!body.trim()) continue;
    for (let i = 0; i < body.length; i += 1200) {
      out.push({
        category: fallbackCategory,
        title: i ? `${title}（続き）` : title,
        content: body.slice(i, i + 1200),
        keywords: [...new Set(title.match(/[ァ-ヶー]{2,}|[一-鿿々]{2,}|[a-zA-Z0-9]{2,}/g) ?? [])].slice(0, 10),
        questions: [],
      });
    }
  }
  return out;
}

function gridText(rows: string[][]): string {
  return rows
    .map((r) => (r ?? []).map((c) => (c ?? "").toString().trim()).filter(Boolean).join(" ／ "))
    .filter(Boolean)
    .join("\n");
}

function tidyEntries(list: AnalyzedEntry[], category: string): AnalyzedEntry[] {
  const fixed = categoryOf(category).entry;
  const seen = new Set<string>();
  const out: AnalyzedEntry[] = [];
  for (const e of list) {
    const title = (e.title ?? "").trim().slice(0, 80);
    const content = (e.content ?? "").trim().slice(0, 2000);
    if (!title || !content) continue;
    const key = `${title}\n${content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...e,
      category: (fixed || e.category || "その他").trim().slice(0, 40),
      title,
      content,
      keywords: [...new Set((e.keywords ?? []).map((k) => k.trim()).filter(Boolean))].slice(0, 15),
      questions: [...new Set((e.questions ?? []).map((k) => k.trim()).filter(Boolean))].slice(0, 8),
    });
  }
  return out;
}

/** 文章を整理（OpenAI があれば AI、なければ見出し・段落で分ける） */
async function analyzeText(text: string, name: string, category: string, note?: string): Promise<{ entries: AnalyzedEntry[]; mode: "openai" | "rules"; note?: string }> {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
  if (!clean) return { entries: [], mode: "rules", note: "文字が見つかりませんでした" };
  if (!env.hasOpenAI) return { entries: ruleEntries(clean, category), mode: "rules", note: "OpenAI 未設定のため、見出し・段落ごとに登録しました" };
  const { parts, truncated } = chunks(clean);
  const results = await Promise.all(parts.map((p, i) => askAI(`${header(name, category, note)}${parts.length > 1 ? `\n【全${parts.length}部の${i + 1}部目】` : ""}\n【資料】\n${p}`)));
  return {
    entries: results.flat(),
    mode: "openai",
    note: truncated ? `資料が長いため、先頭の約${(MAX_CHUNK * MAX_CHUNKS).toLocaleString("ja-JP")}字を解析しました` : undefined,
  };
}

/** 文章・ファイルを解析してナレッジ（またはマニュアルの差し替え）にする */
export async function analyze(input: { extracted: Extracted; name: string; category: string; note?: string }): Promise<AnalysisResult> {
  const { extracted: x, name, category, note } = input;

  // 表（Excel・CSV）
  if (x.kind === "grid" && x.grids) {
    const sheets = x.grids.filter((g) => g.rows.some((r) => (r ?? []).some((c) => c && String(c).trim())));
    if (category === "price_manual") {
      const sheet = sheets.find((s) => s.name === env.knowledgeSheetName) ?? sheets[0];
      if (!sheet) throw new Error("シートに内容がありません");
      const manual = gridToManual(sheet.rows, MANUAL_RULES);
      if (manual.entries.length === 0) throw new Error("顧客対応マニュアルとして読み取れる内容がありませんでした");
      return {
        entries: [],
        manual,
        mode: "table",
        note: `シート「${sheet.name}」：文章 ${manual.entries.length - manual.tables.length} 件・料金表 ${manual.tables.length} 表で顧客対応マニュアルを差し替えました${manual.excluded.length ? `（社内向けの ${manual.excluded.length} 行は除外）` : ""}`,
        excerpt: gridText(sheet.rows).slice(0, 300),
      };
    }
    const entries: AnalyzedEntry[] = [];
    const freeText: string[] = [];
    let usedTable = false;
    for (const s of sheets) {
      const qa = rowsToEntries(s.rows);
      if (qa.length) {
        entries.push(...qa.map((e) => ({ category: e.category, title: e.title, content: e.content, keywords: e.keywords, questions: [] })));
        usedTable = true;
        continue;
      }
      const m = gridToManual(s.rows, MANUAL_RULES);
      if (m.tables.length) {
        usedTable = true;
        const tables = new Map(m.tables.map((t) => [t.id, t]));
        for (const e of m.entries) entries.push({ category: tables.has(e.id) ? "料金" : e.category, title: e.title, content: e.content, keywords: e.keywords, questions: [], table: tables.get(e.id) });
        continue;
      }
      freeText.push(`【シート：${s.name}】\n${gridText(s.rows)}`);
    }
    let mode: AnalysisResult["mode"] = "table";
    let resultNote: string | undefined;
    if (freeText.length) {
      const t = await analyzeText(freeText.join("\n\n"), name, category, note);
      entries.push(...t.entries);
      mode = usedTable ? "table" : t.mode;
      resultNote = t.note;
    }
    return { entries: tidyEntries(entries, category), mode, note: resultNote, excerpt: gridText(sheets[0]?.rows ?? []).slice(0, 300) };
  }

  // PDF・画像（OpenAI が読み取る）
  if (x.kind === "pdf" || x.kind === "image") {
    if (!env.hasOpenAI) throw new Error("PDF・画像の読み取りには OpenAI の API キー（OPENAI_API_KEY）が必要です");
    const part: ChatContentPart =
      x.kind === "pdf" ? { type: "file", file: { filename: name, file_data: x.dataUrl! } } : { type: "image_url", image_url: { url: x.dataUrl! } };
    const list = await askAI([part, { type: "text", text: `${header(name, category, note)}\n【資料】上の${x.kind === "pdf" ? "PDF" : "画像"}を読み取って整理してください。` }]);
    const entries = tidyEntries(list, category);
    return { entries, mode: "openai", excerpt: entries.map((e) => `${e.title}：${e.content}`).join(" ").slice(0, 300) };
  }

  // 文章
  const text = x.text ?? "";
  const t = await analyzeText(text, name, category, note);
  return { entries: tidyEntries(t.entries, category), mode: t.mode, note: t.note, excerpt: text.trim().slice(0, 300) };
}
