// ナレッジ（AIの回答情報源）の読み込み・統合・キャッシュ
//   Supabase を設定した場合は knowledge テーブルが正（同梱の database/*.json は内容が変わったときに自動で取り込む）。
//   未設定・接続できない場合は同梱の JSON（ビルドに同梱）で動作する
//   1. 顧客対応マニュアル … database/manual.json（Excel から npm run knowledge:build で変換）または管理画面でアップロードした Excel
//                          Googleスプレッドシートを接続した場合はその指定1シート
//   2. 会社情報 … database/company.json（マニュアル・ホームページと照合し、内容が変わった項目は使わない）
//   3. ホームページ … database/website.json（管理画面から再学習した場合はその内容）
//   4. 管理画面で追加したナレッジ・アップロードしたファイルから作ったナレッジ
// 回答の優先順は「管理画面 → アップロード → マニュアル → 会社情報 → ホームページ」。食い違いがあればマニュアルが正です。
import crypto from "crypto";
import companyJson from "../../database/company.json";
import manualJson from "../../database/manual.json";
import rulesJson from "../../database/manual-rules.json";
import websiteJson from "../../database/website.json";
import { env } from "./env";
import { gasRequest, sheetsGetValues } from "./google";
import { DEFAULT_MANUAL_RULES, gridToManual, type ManualRules, type PriceTable } from "./manual";
import { ensureBundledSynced, knowledgeVersion, listKnowledgeRows, rowToEntry, type KnowledgeRow } from "./knowledge-db";
import { getAdminKnowledge, getSiteKnowledge } from "./store";
import { markSupabaseError, supabaseReady } from "./supabase";
import type { KnowledgeEntry, KnowledgeSnapshot, KnowledgeSource } from "./types";

interface Cache {
  snapshot: KnowledgeSnapshot;
  expires: number;
  /** Supabase の版（管理画面で変更があると変わる） */
  version?: string;
  checkedAt: number;
}
const g = globalThis as unknown as { __knowledgeCache?: Cache | null };

export const SOURCE_LABEL: Record<KnowledgeSource, string> = {
  sheets_api: "顧客対応マニュアル（Googleスプレッドシート・Sheets API）",
  gas: "顧客対応マニュアル（Googleスプレッドシート・GAS連携）",
  csv: "顧客対応マニュアル（Googleスプレッドシート・公開CSV）",
  json: "顧客対応マニュアル（database/manual.json・Excel から変換）",
  supabase: "顧客対応マニュアル（Supabase に保存・Excel から取り込み）",
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

interface ManualResult {
  entries: KnowledgeEntry[];
  tables: PriceTable[];
  /** 社内向けとして除外した行（manual.json には内容を残さず、件数だけを持つ） */
  excluded: string[];
  excludedCount: number;
  source: KnowledgeSource;
  sheetName?: string;
}

/** シートの全セル → マニュアル（Q&A 形式ならそのまま、自由形式なら文章と料金表に分けて解析） */
export function manualFromGrid(rows: string[][], source: KnowledgeSource, sheetName?: string): ManualResult {
  const m = gridToManual(rows, MANUAL_RULES);
  return { ...m, excludedCount: m.excluded.length, source, sheetName };
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

interface ManualFile {
  source: string;
  sheet: string;
  convertedAt: string;
  excludedCount: number;
  entries: KnowledgeEntry[];
  tables: PriceTable[];
}

/** 同梱のマニュアル（database/manual.json）。Excel を更新したら npm run knowledge:build で作り直す */
function bundledManual(): ManualResult {
  const m = manualJson as ManualFile;
  return {
    entries: m.entries.map((e) => ({ ...e, origin: "manual" as const })),
    tables: m.tables,
    excluded: [],
    excludedCount: m.excludedCount,
    source: "json",
    sheetName: m.sheet,
  };
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

function checkCompany(manualText: string, siteText: string, list: KnowledgeEntry[]) {
  const ok: KnowledgeEntry[] = [];
  const stale: { id: string; title: string; missing: string[] }[] = [];
  for (const e of list) {
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

/** Supabase に保存したマニュアル（文章・料金表） */
function manualFromRows(rows: KnowledgeRow[]): ManualResult {
  const bundled = rows.every((r) => !r.source_id);
  return {
    entries: rows.map(rowToEntry),
    tables: rows.filter((r) => r.price_table).map((r) => ({ ...(r.price_table as PriceTable), id: r.id })),
    excluded: [],
    excludedCount: bundled ? (manualJson as ManualFile).excludedCount : 0,
    source: "supabase",
    sheetName: (manualJson as ManualFile).sheet,
  };
}

/** Supabase 利用時、管理画面での変更（版）を確認する間隔 */
const VERSION_CHECK_MS = 5000;

export async function getKnowledge(force = false): Promise<KnowledgeSnapshot> {
  const now = Date.now();
  const cached = g.__knowledgeCache;
  if (!force && cached && cached.expires > now) {
    if (cached.version === undefined || now - cached.checkedAt < VERSION_CHECK_MS) return cached.snapshot;
    try {
      const v = await knowledgeVersion();
      cached.checkedAt = now;
      if (v === cached.version) return cached.snapshot;
    } catch {
      return cached.snapshot;
    }
  }

  const errors: string[] = [];
  // 1. Supabase（使える場合はここが正。同梱の JSON は内容が変わったときに自動で取り込む）
  let rows: KnowledgeRow[] | null = null;
  let version: string | undefined;
  if (await supabaseReady()) {
    try {
      await ensureBundledSynced();
      [rows, version] = await Promise.all([listKnowledgeRows(), knowledgeVersion()]);
    } catch (e) {
      markSupabaseError(e);
      errors.push(`Supabase: ${(e as Error).message}`);
      rows = null;
    }
  }
  const byOrigin = (o: KnowledgeRow["origin"]) => (rows ?? []).filter((r) => r.origin === o);

  // 2. 顧客対応マニュアル（スプレッドシート接続時はシート → Supabase → 同梱の JSON）
  const remote = remoteKnowledgeConfigured() ? await loadRemote(errors) : null;
  const dbManual = byOrigin("manual");
  const manual = remote ?? (dbManual.length ? manualFromRows(dbManual) : bundledManual());

  // 3. ホームページ・会社情報・管理画面で追加・アップロード
  let siteEntries: KnowledgeEntry[];
  let websiteFetchedAt: string | undefined;
  let relearned: boolean;
  let companyList: KnowledgeEntry[];
  let adminEntries: KnowledgeEntry[];
  let uploadRows: KnowledgeRow[] = [];
  if (rows) {
    const site = byOrigin("website");
    relearned = site.some((r) => r.edited);
    siteEntries = (site.length ? site.map(rowToEntry) : (websiteJson as { entries: KnowledgeEntry[] }).entries).map((e) => ({ ...e, origin: "website" as const }));
    websiteFetchedAt = relearned ? site.map((r) => r.updated_at ?? "").sort().pop() : (websiteJson as { fetchedAt?: string }).fetchedAt;
    const company = byOrigin("company");
    companyList = company.length ? company.map(rowToEntry) : (companyJson as CompanyFile).entries;
    adminEntries = byOrigin("admin").map(rowToEntry);
    uploadRows = byOrigin("upload");
  } else {
    const [admin, siteStored] = await Promise.all([getAdminKnowledge(), getSiteKnowledge()]);
    relearned = Boolean(siteStored && siteStored.entries.length > 0);
    siteEntries = (relearned ? siteStored!.entries : (websiteJson as { entries: KnowledgeEntry[] }).entries).map((e) => ({ ...e, origin: "website" as const }));
    websiteFetchedAt = relearned ? siteStored!.fetchedAt : (websiteJson as { fetchedAt?: string }).fetchedAt;
    companyList = (companyJson as CompanyFile).entries;
    adminEntries = admin;
  }

  const manualEntries = manual.entries;
  const manualText = normalizeForMatch(manualEntries.map((e) => `${e.title}\n${e.content}`).join("\n"));
  const siteText = normalizeForMatch(siteEntries.map((e) => `${e.title}\n${e.content}`).join("\n"));
  const company = checkCompany(manualText, siteText, companyList);
  const admin = adminEntries.map((e) => ({ ...e, origin: "admin" as const }));
  const upload = uploadRows.map((r) => ({ ...rowToEntry(r), origin: "upload" as const }));

  const entries = [...admin, ...upload, ...manualEntries, ...company.ok, ...siteEntries];
  // アップロードした Excel の料金表も料金の回答に使う
  const tables = [...manual.tables, ...uploadRows.filter((r) => r.price_table).map((r) => ({ ...(r.price_table as PriceTable), id: r.id }))];
  const source: KnowledgeSource = manual.source;
  const snapshot: KnowledgeSnapshot = {
    entries,
    tables,
    source,
    sourceLabel: SOURCE_LABEL[source],
    sheetName: manual.sheetName,
    fetchedAt: new Date(now).toISOString(),
    warning: errors.length
      ? remote
        ? errors.join(" / ")
        : rows
          ? `シートを読めなかったため Supabase のマニュアルを使用中: ${errors.join(" / ")}`
          : `同梱のマニュアル（database/manual.json）を使用中: ${errors.join(" / ")}`
      : undefined,
    version: hashEntries(entries, tables),
    stats: {
      manualText: manualEntries.filter((e) => !manual.tables.some((t) => t.id === e.id)).length,
      manualTables: manual.tables.length,
      company: company.ok.length,
      companyStale: company.stale.length,
      website: siteEntries.length,
      admin: admin.length,
      upload: upload.length,
      excluded: manual.excludedCount,
    },
    stale: company.stale,
    excludedLines: manual.excluded,
    websiteFetchedAt,
    websiteOrigin: relearned ? "relearned" : "bundled",
  };
  g.__knowledgeCache = { snapshot, expires: now + env.knowledgeCacheSeconds * 1000, version, checkedAt: now };
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
