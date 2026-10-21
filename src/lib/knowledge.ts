// ナレッジ（AIの回答情報源）の読み込み・統合・キャッシュ
//   回答の根拠は「Googleスプレッドシート（顧客対応マニュアルのタブ）」と「一畳屋のホームページ（ichijoya.co.jp）」だけ
//   1. Googleスプレッドシート … サービスアカウント（GOOGLE_SERVICE_ACCOUNT_EMAIL・GOOGLE_PRIVATE_KEY・KNOWLEDGE_SHEET_ID・KNOWLEDGE_SHEET_GID）
//                             または管理画面で入力した URL・GAS_WEBHOOK_URL・KNOWLEDGE_SHEET_CSV_URL
//                             読めないときは同じシートの保存版（database/manual.json＝npm run knowledge:build でシートから作成）
//   2. ホームページ … database/website.json（管理画面から再学習した場合はその内容）。料金がシートと違う項目は使わない
// 食い違いがあればスプレッドシートが正です。
import crypto from "crypto";
import manualJson from "../../database/manual.json";
import rulesJson from "../../database/manual-rules.json";
import websiteJson from "../../database/website.json";
import { env } from "./env";
import { logError } from "./errorlog";
import { gasRequest, sheetsReadTab } from "./google";
import { DEFAULT_MANUAL_RULES, gridToManual, type ManualRules, type PriceTable } from "./manual";
import { labelTokens, normPrice } from "./price";
import { parseSheetLink, type SheetLink } from "./sheet-link";
import { getSettings, getSiteKnowledge } from "./store";
import type { KnowledgeEntry, KnowledgeSnapshot, KnowledgeSource } from "./types";

interface Cache {
  snapshot: KnowledgeSnapshot;
  expires: number;
}
const g = globalThis as unknown as { __knowledgeCache?: Cache | null };

export const SOURCE_LABEL: Record<KnowledgeSource, string> = {
  sheets_api: "Googleスプレッドシート（Sheets API で読み取り中）",
  gas: "Googleスプレッドシート（Apps Script で読み取り中）",
  csv: "Googleスプレッドシート（共有リンク／公開CSV で読み取り中）",
  json: "Googleスプレッドシートの保存版（database/manual.json）",
  local: "ホームページのみ（スプレッドシート未読込）",
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

/** スプレッドシートの接続先（管理画面で入力した URL が優先。なければ環境変数） */
function sheetLinks(settingsUrl: string): { link: SheetLink | null; envConfigured: boolean } {
  return {
    link: parseSheetLink(settingsUrl),
    envConfigured: (env.hasServiceAccount && env.knowledgeSheetId !== "") || env.gasWebhookUrl !== "" || env.knowledgeCsvUrl !== "",
  };
}

export function remoteKnowledgeConfigured(settingsUrl = ""): boolean {
  const { link, envConfigured } = sheetLinks(settingsUrl);
  return envConfigured || (link !== null && link.kind !== "invalid");
}

/** CSV の取得（共有されていないシートは Google のログイン画面＝HTML が返る） */
async function fetchCsvGrid(url: string): Promise<string[][]> {
  const res = await fetch(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}${res.status === 401 || res.status === 403 || res.status === 404 ? "（共有設定を確認してください）" : ""}`);
  const text = await res.text();
  if (/text\/html/.test(res.headers.get("content-type") ?? "") || /^\s*<(!doctype|html)/i.test(text)) {
    throw new Error("シートを読み取れませんでした。共有設定を「リンクを知っている全員（閲覧者）」にするか、「ウェブに公開」してください（おすすめは Apps Script）");
  }
  return parseCsv(text, true);
}

async function loadRemote(errors: string[], settingsUrl: string): Promise<ManualResult | null> {
  const { link } = sheetLinks(settingsUrl);
  // 管理画面で入力した URL
  if (link?.kind === "invalid") errors.push(`スプレッドシートの URL：${link.reason}`);
  if (link?.kind === "gas") {
    try {
      const json = await gasRequest<{ ok?: boolean; grid?: string[][]; rows?: string[][]; error?: string; sheet?: string }>({ action: "knowledge", sheet: env.knowledgeSheetName }, "GET", link.url);
      if (json.error) throw new Error(json.error);
      const m = manualFromGrid(json.grid ?? json.rows ?? [], "gas", json.sheet ?? env.knowledgeSheetName);
      if (m.entries.length > 0) return m;
      errors.push("Apps Script: 対象シートにデータがありません");
    } catch (e) {
      errors.push(`Apps Script: ${(e as Error).message}`);
    }
  }
  if (link?.kind === "csv" && link.sheetId && env.hasServiceAccount) {
    try {
      const tab = await sheetsReadTab(link.sheetId, { gid: link.gid, name: env.knowledgeSheetName });
      const m = manualFromGrid(tab.rows, "sheets_api", tab.title);
      if (m.entries.length > 0) return m;
      errors.push(`スプレッドシート：シート「${tab.title}」に内容がありません`);
    } catch (e) {
      errors.push((e as Error).message);
    }
  } else if (link?.kind === "csv") {
    try {
      const m = manualFromGrid(await fetchCsvGrid(link.url), "csv", env.knowledgeSheetName);
      if (m.entries.length > 0) return m;
      errors.push("スプレッドシート: データがありません");
    } catch (e) {
      errors.push(`スプレッドシート: ${(e as Error).message}`);
    }
  }
  // 環境変数での接続
  if (env.hasServiceAccount && env.knowledgeSheetId) {
    try {
      const tab = await sheetsReadTab(env.knowledgeSheetId, { gid: env.knowledgeSheetGid, name: env.knowledgeSheetName });
      const m = manualFromGrid(tab.rows, "sheets_api", tab.title);
      if (m.entries.length > 0) return m;
      errors.push(`スプレッドシート：シート「${tab.title}」に内容がありません`);
    } catch (e) {
      errors.push((e as Error).message);
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
      // 共有リンク（#gid=…）や「ウェブに公開」の URL もそのまま使える
      const envLink = parseSheetLink(env.knowledgeCsvUrl);
      if (envLink?.kind === "invalid") throw new Error(envLink.reason);
      const m = manualFromGrid(await fetchCsvGrid(envLink?.url ?? env.knowledgeCsvUrl), "csv", env.knowledgeSheetName);
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

/** 同じシートの保存版（database/manual.json）。シートを大きく変えたら npm run knowledge:build で作り直す */
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

function amountsOf(s: string | undefined, out = new Set<number>()): Set<number> {
  for (const m of (s ?? "").normalize("NFKC").matchAll(/\d{1,3}(?:,\d{3})+|\d{3,7}/g)) out.add(Number(m[0].replace(/,/g, "")));
  return out;
}

interface PriceIndex {
  /** 料金表に出てくるすべての金額 */
  all: Set<number>;
  /** 注記・表題の金額（諸経費・加算など、どの品名にも共通） */
  fees: Set<number>;
  /** 品名ごとの金額（品名の語 → 金額） */
  rows: { tokens: string[]; amounts: Set<number> }[];
}

/** 料金表（最新の顧客対応マニュアル）の金額の索引 */
function priceIndex(tables: PriceTable[]): PriceIndex {
  const all = new Set<number>();
  const fees = new Set<number>();
  const rows: PriceIndex["rows"] = [];
  for (const t of tables) {
    for (const s of [t.title, t.caption, ...t.notes]) amountsOf(s, fees);
    for (const r of t.rows) {
      const amounts = new Set<number>();
      [r.label, ...r.values, ...r.extra].forEach((s) => amountsOf(s, amounts));
      // 店名と同じ品名（「一畳屋」）は、会社案内の文章にも出てくるので品名の照合に使わない
      const tokens = labelTokens(r.label).filter((tok) => tok !== "一畳屋");
      rows.push({ tokens, amounts });
    }
  }
  fees.forEach((v) => all.add(v));
  rows.forEach((r) => r.amounts.forEach((v) => all.add(v)));
  return { all, fees, rows };
}

/** 文章中の金額（「27,500」「3300円」。寸法・枚数・「2,000万円」などは除く） */
function amountsIn(text: string): number[] {
  const out: number[] = [];
  const s = text.normalize("NFKC");
  for (const m of s.matchAll(/(\d{1,3}(?:,\d{3})+|\d{3,7})(?=\s*円)|(\d{1,3}(?:,\d{3})+)(?!\s*(?:cm|mm|m\b|年|枚|畳|帖|件|名|人|%|x|×|万|億|千|\d))/g)) {
    const at = m.index ?? 0;
    const after = s.slice(at + m[0].length, at + m[0].length + 8);
    const before = s.slice(Math.max(0, at - 6), at);
    // 値引き・特典・条件の金額（「500円引き」「1万円以上のご注文で」）は料金ではない
    if (/^\s*円?\s*(?:引|off|OFF|オフ|割|値引|お得|プレゼント|分の|以上|以下|未満|まで|キャッシュバック|ポイント|相当)/.test(after) || /(?:最大|合計|総額|ご注文|お買い上げ|ご購入|ご成約)\s*$/.test(before)) continue;
    const v = Number((m[1] ?? m[2]).replace(/,/g, ""));
    if (v >= 500) out.push(v);
  }
  return out;
}

/**
 * 料金は最新の料金表（スプレッドシート）だけを正とする：ホームページのうち、
 * 料金表と違う金額（古い料金など）を書いた項目は使わない（管理画面に「要確認」として表示）。
 * 見出しに品名がある項目（「畳替え｜おすすめ｜古都」）は、その品名の行の金額と照合する
 */
function checkPrices(list: KnowledgeEntry[], index: PriceIndex) {
  const ok: KnowledgeEntry[] = [];
  const stale: { id: string; title: string; missing: string[] }[] = [];
  for (const e of list) {
    const title = normPrice(e.title);
    const named = index.rows.filter((r) => r.tokens.some((tok) => title.includes(tok)));
    const allowed = named.length ? new Set([...index.fees, ...named.flatMap((r) => [...r.amounts])]) : index.all;
    const unknown = [...new Set(amountsIn(`${e.title}\n${e.content}`).filter((v) => !allowed.has(v)))];
    if (index.all.size && unknown.length) stale.push({ id: e.id, title: e.title, missing: unknown.map((v) => `料金表と違う金額 ${v.toLocaleString("ja-JP")}円`) });
    else ok.push(e);
  }
  return { ok, stale };
}

/**
 * 話題の見分け（スプレッドシートとホームページの同じ話題を結びつけ、回答ではスプレッドシートを正にするため）
 *   ホームページは見出しの分類（「畳替え｜」「襖・障子・アミ戸｜」）より後ろの語で見る（分類だけでは話題が広すぎるため）
 */
const TOPIC_RULES: [string, RegExp][] = [
  ["tatami", /畳替え|表替え|畳表|畳床|畳について|畳（|ヘリ|へり無し|置き畳|琉球|極み|古都|雅|さくら|やすらぎ|きずな|なごみ|めぐみ|当日仕上げ/],
  ["fusuma", /襖|ふすま/],
  ["shoji", /障子/],
  ["amido", /網戸|アミ戸|アミド/],
  ["store", /店舗|ショールーム|合志店|中央店|西店|玉名店|名古屋店|来店/],
  ["company", /会社概要|株式会社|営業時間|定休日|営業範囲|対応エリア/],
  ["schedule", /工期|当日仕上げ|何日/],
];

export function topicsOf(e: KnowledgeEntry): string[] {
  const parts = e.title.split("｜");
  const text = e.origin === "website" && parts.length > 1 ? parts.slice(1).join("｜") : e.title;
  const found = TOPIC_RULES.filter(([, re]) => re.test(text)).map(([t]) => t);
  // ホームページの見出しに話題の語がなければ分類で判断（「畳替え｜一畳屋が選ばれる理由｜品質」→ 畳）
  if (!found.length && e.origin === "website" && parts.length > 1) return TOPIC_RULES.filter(([, re]) => re.test(parts[0]) && !/・/.test(parts[0])).map(([t]) => t);
  return found;
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
  const cached = g.__knowledgeCache;
  if (!force && cached && cached.expires > now) return cached.snapshot;

  const errors: string[] = [];
  // 1. Googleスプレッドシート（読めなければ同じシートの保存版 database/manual.json）
  const sheetUrl = (await getSettings().catch(() => null))?.knowledgeSheetUrl ?? "";
  const sheetConfigured = remoteKnowledgeConfigured(sheetUrl);
  const remote = sheetConfigured ? await loadRemote(errors, sheetUrl) : null;
  const manual = remote ?? bundledManual();

  // 2. ホームページ（管理画面で再学習した内容、なければ同梱の database/website.json）
  const siteStored = await getSiteKnowledge();
  const relearned = Boolean(siteStored && siteStored.entries.length > 0);
  const siteAll = (relearned ? siteStored!.entries : (websiteJson as { entries: KnowledgeEntry[] }).entries).map((e) => ({ ...e, origin: "website" as const }));
  const websiteFetchedAt = relearned ? siteStored!.fetchedAt : (websiteJson as { fetchedAt?: string }).fetchedAt;

  // 料金はスプレッドシートの料金表が正：違う金額を書いたホームページの項目は使わない
  const site = checkPrices(siteAll, priceIndex(manual.tables));
  // 話題をつけておく（同じ話題がスプレッドシートにもあるときは、回答でスプレッドシートを先に・正として使う）
  const entries = [...manual.entries, ...site.ok].map((e) => ({ ...e, topics: topicsOf(e) }));
  const tables = manual.tables;
  const source: KnowledgeSource = manual.source;
  const settingsLink = parseSheetLink(sheetUrl);
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
        : `スプレッドシートを読めなかったため、保存版（database/manual.json）で回答しています：${errors.join(" / ")}`
      : undefined,
    version: hashEntries(entries, tables),
    stats: {
      manualText: manual.entries.filter((e) => !manual.tables.some((t) => t.id === e.id)).length,
      manualTables: manual.tables.length,
      website: site.ok.length,
      excluded: manual.excludedCount,
    },
    stale: site.stale,
    excludedLines: manual.excluded,
    websiteFetchedAt,
    websiteOrigin: relearned ? "relearned" : "bundled",
    sheet: {
      configured: sheetConfigured,
      connected: Boolean(remote),
      via: settingsLink && settingsLink.kind !== "invalid" ? settingsLink.kind : sheetConfigured ? "env" : null,
      url: sheetUrl,
    },
  };
  g.__knowledgeCache = { snapshot, expires: now + env.knowledgeCacheSeconds * 1000 };
  if (errors.length) void logError("sheet", "スプレッドシートの読み込み", errors.join(" / "));
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
    remoteConfigured: s.sheet?.configured ?? false,
    sheet: s.sheet,
  };
}
