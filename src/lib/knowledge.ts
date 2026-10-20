// ナレッジ（AIの回答情報源）の読み込み・統合・キャッシュ
//   1. 顧客対応マニュアル … Googleスプレッドシートの指定1シート（未接続時は database/顧客対応マニュアル.xlsx）
//   2. 会社情報 … database/company.json（マニュアル・ホームページと照合し、内容が変わった項目は使わない）
//   3. ホームページ … database/website.json（管理画面から再学習した場合はその内容）
//   4. 管理画面で追加したナレッジ
// 回答の優先順は「管理画面 → マニュアル → 会社情報 → ホームページ」。食い違いがあればマニュアルが正です。
import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import companyJson from "../../database/company.json";
import rulesJson from "../../database/manual-rules.json";
import websiteJson from "../../database/website.json";
import { env } from "./env";
import { gasRequest, sheetsGetValues } from "./google";
import { DEFAULT_MANUAL_RULES, parseManualGrid, type ManualRules, type PriceTable } from "./manual";
import { getAdminKnowledge, getSiteKnowledge } from "./store";
import type { KnowledgeEntry, KnowledgeSnapshot, KnowledgeSource } from "./types";
import { readXlsx } from "./xlsx";

interface Cache {
  snapshot: KnowledgeSnapshot;
  expires: number;
}
const g = globalThis as unknown as { __knowledgeCache?: Cache | null; __xlsxCache?: { mtime: number; grid: string[][]; sheet: string } };

export const SOURCE_LABEL: Record<KnowledgeSource, string> = {
  sheets_api: "顧客対応マニュアル（Googleスプレッドシート・Sheets API）",
  gas: "顧客対応マニュアル（Googleスプレッドシート・GAS連携）",
  csv: "顧客対応マニュアル（Googleスプレッドシート・公開CSV）",
  xlsx: "顧客対応マニュアル（Excel：database/顧客対応マニュアル.xlsx）",
  local: "会社情報・ホームページのみ（マニュアル未読込）",
};

export const MANUAL_RULES: ManualRules = { ...DEFAULT_MANUAL_RULES, ...(rulesJson as Partial<ManualRules>) };

/** RFC4180 準拠の簡易CSVパーサ（改行・引用符対応）。keepEmpty で空行も位置を保つ */
export function parseCsv(text: string, keepEmpty = false): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return keepEmpty ? rows : rows.filter((r) => r.some((c) => c.trim() !== ""));
}

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

interface ManualResult {
  entries: KnowledgeEntry[];
  tables: PriceTable[];
  excluded: string[];
  source: KnowledgeSource;
  sheetName?: string;
}

/** シートの全セル → マニュアル（Q&A 形式ならそのまま、自由形式なら文章と料金表に分けて解析） */
export function manualFromGrid(rows: string[][], source: KnowledgeSource, sheetName?: string): ManualResult {
  if (qaHeader(rows)) return { entries: rowsToEntries(rows), tables: [], excluded: [], source, sheetName };
  const parsed = parseManualGrid(rows, MANUAL_RULES);
  const entries = [...parsed.textEntries, ...parsed.tableEntries].map((e) => ({ ...e, origin: "manual" as const }));
  return { entries, tables: parsed.tables, excluded: parsed.excluded, source, sheetName };
}

export function remoteKnowledgeConfigured(): boolean {
  return (
    (env.hasServiceAccount && env.knowledgeSheetId !== "") || env.gasWebhookUrl !== "" || env.knowledgeCsvUrl !== ""
  );
}

async function loadRemote(errors: string[]): Promise<ManualResult | null> {
  if (env.hasServiceAccount && env.knowledgeSheetId) {
    try {
      const rows = await sheetsGetValues(env.knowledgeSheetId, `${env.knowledgeSheetName}!A1:BZ2000`);
      const m = manualFromGrid(rows, "sheets_api", env.knowledgeSheetName);
      if (m.entries.length > 0) return m;
      errors.push("Sheets API: 対象シートにデータがありません");
    } catch (e) {
      errors.push(`Sheets API: ${(e as Error).message}`);
    }
  }
  if (env.gasWebhookUrl) {
    try {
      const json = await gasRequest<{ ok?: boolean; grid?: string[][]; rows?: string[][]; error?: string; sheet?: string }>(
        { action: "knowledge", sheet: env.knowledgeSheetName },
        "GET",
      );
      if (json.error) throw new Error(json.error);
      // 新しい GAS は空行も含めた grid を返す（自由形式のマニュアルの見出し判定に空行が必要）
      const m = manualFromGrid(json.grid ?? json.rows ?? [], "gas", json.sheet ?? env.knowledgeSheetName);
      if (m.entries.length > 0) return m;
      errors.push("GAS: 対象シートにデータがありません");
    } catch (e) {
      errors.push(`GAS: ${(e as Error).message}`);
    }
  }
  if (env.knowledgeCsvUrl) {
    try {
      const res = await fetch(env.knowledgeCsvUrl, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const m = manualFromGrid(parseCsv(await res.text(), true), "csv", env.knowledgeSheetName);
      if (m.entries.length > 0) return m;
      errors.push("CSV: データがありません");
    } catch (e) {
      errors.push(`CSV: ${(e as Error).message}`);
    }
  }
  return null;
}

/** 同梱の Excel（database/顧客対応マニュアル.xlsx）。更新日時が変わったときだけ読み直す */
async function loadXlsx(errors: string[]): Promise<ManualResult | null> {
  const file = path.join(process.cwd(), env.manualXlsxPath);
  try {
    const stat = await fs.stat(file);
    if (!g.__xlsxCache || g.__xlsxCache.mtime !== stat.mtimeMs) {
      const sheets = readXlsx(await fs.readFile(file));
      const sheet = sheets.find((s) => s.name === env.knowledgeSheetName) ?? sheets[0];
      if (!sheet) throw new Error("シートがありません");
      g.__xlsxCache = { mtime: stat.mtimeMs, grid: sheet.rows, sheet: sheet.name };
    }
    return manualFromGrid(g.__xlsxCache.grid, "xlsx", g.__xlsxCache.sheet);
  } catch (e) {
    errors.push(`Excel（${env.manualXlsxPath}）: ${(e as Error).message}`);
    return null;
  }
}

/** 照合用の正規化（全角半角・空白・桁区切り・波線・中黒の違いを無視） */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\s,，、・]/g, "")
    .replace(/[〜～]/g, "~")
    .toLowerCase();
}

interface CompanyFile {
  entries: (KnowledgeEntry & { anchors?: string[] })[];
}

function checkCompany(manualText: string, siteText: string) {
  const ok: KnowledgeEntry[] = [];
  const stale: { id: string; title: string; missing: string[] }[] = [];
  for (const e of (companyJson as CompanyFile).entries) {
    const missing = (e.anchors ?? []).filter((a) => {
      const site = a.startsWith("site:");
      const needle = normalizeForMatch(site ? a.slice(5) : a);
      return needle && !(site ? siteText : manualText).includes(needle);
    });
    if (missing.length) stale.push({ id: e.id, title: e.title, missing });
    else ok.push({ ...e, origin: "company" });
  }
  return { ok, stale };
}

function hashEntries(entries: KnowledgeEntry[], tables: PriceTable[]): string {
  const h = crypto.createHash("sha1");
  for (const e of entries) h.update(`${e.id}|${e.title}|${e.content}\n`);
  for (const t of tables) h.update(`${t.id}|${t.rows.length}|${t.notes.length}\n`);
  return h.digest("hex").slice(0, 16);
}

/** エントリ単位のハッシュ（学習済み回答が使った根拠が今も同じかの判定に使う） */
export function entryHash(e: KnowledgeEntry): string {
  return crypto.createHash("sha1").update(`${e.id}|${e.content}`).digest("hex").slice(0, 12);
}

export async function getKnowledge(force = false): Promise<KnowledgeSnapshot> {
  const now = Date.now();
  if (!force && g.__knowledgeCache && g.__knowledgeCache.expires > now) return g.__knowledgeCache.snapshot;

  const errors: string[] = [];
  const remote = remoteKnowledgeConfigured() ? await loadRemote(errors) : null;
  const manual = remote ?? (await loadXlsx(errors));

  const [adminEntries, siteStored] = await Promise.all([getAdminKnowledge(), getSiteKnowledge()]);
  const relearned = Boolean(siteStored && siteStored.entries.length > 0);
  const siteEntries: KnowledgeEntry[] = (relearned ? siteStored!.entries : (websiteJson as { entries: KnowledgeEntry[] }).entries).map(
    (e) => ({ ...e, origin: "website" as const }),
  );
  const websiteFetchedAt = relearned ? siteStored!.fetchedAt : (websiteJson as { fetchedAt?: string }).fetchedAt;

  const manualEntries = manual?.entries ?? [];
  const manualText = normalizeForMatch(manualEntries.map((e) => `${e.title}\n${e.content}`).join("\n"));
  const siteText = normalizeForMatch(siteEntries.map((e) => `${e.title}\n${e.content}`).join("\n"));
  const company = checkCompany(manualText, siteText);
  const admin = adminEntries.map((e) => ({ ...e, origin: "admin" as const }));

  const entries = [...admin, ...manualEntries, ...company.ok, ...siteEntries];
  const tables = manual?.tables ?? [];
  const source: KnowledgeSource = manual?.source ?? "local";
  const snapshot: KnowledgeSnapshot = {
    entries,
    tables,
    source,
    sourceLabel: SOURCE_LABEL[source],
    sheetName: manual?.sheetName,
    fetchedAt: new Date(now).toISOString(),
    warning: errors.length
      ? remote
        ? errors.join(" / ")
        : manual
          ? remoteKnowledgeConfigured()
            ? `シートを読めなかったため同梱の Excel を使用中: ${errors.join(" / ")}`
            : undefined
          : `マニュアルを読み込めませんでした: ${errors.join(" / ")}`
      : undefined,
    version: hashEntries(entries, tables),
    stats: {
      manualText: manualEntries.filter((e) => !e.id.startsWith("m-p")).length,
      manualTables: tables.length,
      company: company.ok.length,
      companyStale: company.stale.length,
      website: siteEntries.length,
      admin: admin.length,
      excluded: manual?.excluded.length ?? 0,
    },
    stale: company.stale,
    excludedLines: manual?.excluded ?? [],
    websiteFetchedAt,
    websiteOrigin: relearned ? "relearned" : "bundled",
  };
  g.__knowledgeCache = { snapshot, expires: now + env.knowledgeCacheSeconds * 1000 };
  return snapshot;
}

export function invalidateKnowledgeCache(): void {
  g.__knowledgeCache = null;
}

/** 管理画面向け：ナレッジの一覧と情報源ごとの件数（料金表は表ごとの概要のみ） */
export function describeKnowledge(s: KnowledgeSnapshot) {
  return {
    ok: true,
    entries: s.entries,
    tables: s.tables.map((t) => ({ id: t.id, title: t.title, caption: t.caption, columns: t.columns, rows: t.rows.length, notes: t.notes.length })),
    source: s.source,
    sourceLabel: s.sourceLabel,
    sheetName: s.sheetName,
    fetchedAt: s.fetchedAt,
    warning: s.warning,
    version: s.version,
    stats: s.stats,
    stale: s.stale,
    excludedLines: s.excludedLines,
    websiteFetchedAt: s.websiteFetchedAt,
    websiteOrigin: s.websiteOrigin,
    remoteConfigured: remoteKnowledgeConfigured(),
  };
}
