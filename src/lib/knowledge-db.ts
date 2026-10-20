// Supabase に保存したナレッジ（knowledge・knowledge_sources テーブル）
//   ・同梱の JSON（manual.json・company.json・website.json）は、内容が変わったときに自動で取り込む
//     （管理画面で編集した項目・アップロードした顧客対応マニュアル・再学習したホームページは上書きしない）
//   ・管理画面で追加した情報（origin: admin）とアップロードしたファイルから作った情報（origin: upload）
import crypto from "crypto";
import companyJson from "../../database/company.json";
import manualJson from "../../database/manual.json";
import websiteJson from "../../database/website.json";
import type { ManualData, PriceTable } from "./manual";
import { db, storageRemove } from "./supabase";
import type { KnowledgeEntry, KnowledgeOrigin, KnowledgeSourceRecord } from "./types";

export interface KnowledgeRow {
  id: string;
  origin: KnowledgeOrigin;
  category: string;
  title: string;
  content: string;
  keywords: string[];
  questions: string[];
  anchors: string[];
  note: string | null;
  price_table: PriceTable | null;
  source_id: string | null;
  enabled: boolean;
  edited: boolean;
  position: number;
  created_at?: string;
  updated_at?: string;
}

const BUNDLED_ORIGINS: KnowledgeOrigin[] = ["manual", "company", "website"];
const PAGE = 1000; // Supabase の 1 回の取得上限（Max rows）

export function rowToEntry(r: KnowledgeRow): KnowledgeEntry {
  return {
    id: r.id,
    category: r.category,
    title: r.title,
    content: r.content,
    keywords: r.keywords ?? [],
    questions: r.questions?.length ? r.questions : undefined,
    anchors: r.anchors?.length ? r.anchors : undefined,
    note: r.note ?? undefined,
    origin: r.origin,
    sourceId: r.source_id,
    enabled: r.enabled,
  };
}

export function entryToRow(e: KnowledgeEntry, origin: KnowledgeOrigin, position: number, extra: Partial<KnowledgeRow> = {}): KnowledgeRow {
  return {
    id: e.id,
    origin,
    category: e.category ?? "",
    title: e.title,
    content: e.content,
    keywords: e.keywords ?? [],
    questions: e.questions ?? [],
    anchors: e.anchors ?? [],
    note: e.note ?? null,
    price_table: null,
    source_id: null,
    enabled: true,
    edited: false,
    position,
    updated_at: new Date().toISOString(),
    ...extra,
  };
}

/** 1000 件ずつ取得して全件を返す */
async function selectAll<T>(table: string, query: Record<string, string | number>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await db.select<T>(table, { ...query, limit: PAGE, offset });
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

const inList = (ids: string[]) => `in.(${ids.map((id) => `"${id.replace(/"/g, "")}"`).join(",")})`;

async function kvGet<T>(key: string): Promise<T | null> {
  const rows = await db.select<{ value: T | null }>("app_kv", { select: "value", key: `eq.${key}` });
  return rows[0]?.value ?? null;
}

async function kvSet(key: string, value: unknown): Promise<void> {
  await db.upsert("app_kv", { key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

async function kvDelete(key: string): Promise<void> {
  await db.remove("app_kv", { key: `eq.${key}` });
}

// ---------- 版（ほかのサーバーインスタンスに変更を知らせる） ----------

export async function knowledgeVersion(): Promise<string> {
  return String((await kvGet<string>("knowledge_version")) ?? "");
}

export async function bumpKnowledgeVersion(): Promise<void> {
  await kvSet("knowledge_version", String(Date.now()));
}

// ---------- 同梱の JSON の取り込み ----------

const BUNDLE_VERSION = crypto.createHash("sha1").update(JSON.stringify([manualJson, companyJson, websiteJson])).digest("hex").slice(0, 16);

interface BundledEntry extends KnowledgeEntry {
  anchors?: string[];
  questions?: string[];
}

function bundledRows(): KnowledgeRow[] {
  const manual = manualJson as unknown as { entries: BundledEntry[]; tables: PriceTable[] };
  const tables = new Map(manual.tables.map((t) => [t.id, t]));
  return [
    ...manual.entries.map((e, i) => entryToRow(e, "manual", 1000 + i, { price_table: tables.get(e.id) ?? null })),
    ...(companyJson as unknown as { entries: BundledEntry[] }).entries.map((e, i) => entryToRow(e, "company", 2000 + i)),
    ...(websiteJson as unknown as { entries: BundledEntry[] }).entries.map((e, i) => entryToRow(e, "website", 3000 + i)),
  ];
}

/** 同梱の JSON が前回の取り込みから変わっていれば取り込む（force で必ず取り込む） */
export async function syncBundled(force = false): Promise<{ synced: boolean; upserted: number; removed: number }> {
  if (!force && (await kvGet<string>("bundled_version")) === BUNDLE_VERSION) return { synced: false, upserted: 0, removed: 0 };
  const [manualOverride, websiteOverride] = await Promise.all([kvGet<string>("override:manual"), kvGet<string>("override:website")]);
  const skip = (o: KnowledgeOrigin) => (o === "manual" && Boolean(manualOverride)) || (o === "website" && Boolean(websiteOverride));
  const existing = await selectAll<Pick<KnowledgeRow, "id" | "origin" | "edited" | "source_id">>("knowledge", {
    select: "id,origin,edited,source_id",
    origin: `in.(${BUNDLED_ORIGINS.join(",")})`,
  });
  const edited = new Set(existing.filter((r) => r.edited).map((r) => r.id));
  const rows = bundledRows().filter((r) => !skip(r.origin));
  const upserts = rows.filter((r) => !edited.has(r.id));
  await db.upsert("knowledge", upserts, { onConflict: "id" });
  const keep = new Set(rows.map((r) => r.id));
  const stale = existing.filter((r) => !keep.has(r.id) && !r.edited && !r.source_id && !skip(r.origin)).map((r) => r.id);
  for (let i = 0; i < stale.length; i += 100) await db.remove("knowledge", { id: inList(stale.slice(i, i + 100)) });
  await kvSet("bundled_version", BUNDLE_VERSION);
  await bumpKnowledgeVersion();
  return { synced: true, upserted: upserts.length, removed: stale.length };
}

const g = globalThis as unknown as { __bundledSynced?: string; __bundledSyncing?: Promise<unknown> };

/** このサーバーインスタンスで 1 回だけ、同梱の JSON の取り込みを確認する */
export async function ensureBundledSynced(): Promise<void> {
  if (g.__bundledSynced === BUNDLE_VERSION) return;
  g.__bundledSyncing ??= syncBundled().finally(() => {
    g.__bundledSyncing = undefined;
  });
  await g.__bundledSyncing;
  g.__bundledSynced = BUNDLE_VERSION;
}

// ---------- 読み込み ----------

export async function listKnowledgeRows(opts: { includeDisabled?: boolean } = {}): Promise<KnowledgeRow[]> {
  const query: Record<string, string> = { order: "position.asc,id.asc" };
  if (!opts.includeDisabled) query.enabled = "is.true";
  return selectAll<KnowledgeRow>("knowledge", query);
}

// ---------- 管理画面からの追加・編集 ----------

export async function createSource(s: Omit<KnowledgeSourceRecord, "id" | "created_at" | "entries_count" | "status"> & Partial<KnowledgeSourceRecord>): Promise<KnowledgeSourceRecord> {
  return db.insert<typeof s, KnowledgeSourceRecord>("knowledge_sources", { status: "processing", entries_count: 0, ...s });
}

export async function updateSource(id: string, patch: Partial<KnowledgeSourceRecord>): Promise<void> {
  await db.update("knowledge_sources", { id: `eq.${id}` }, patch);
}

export async function listSources(limit = 100): Promise<KnowledgeSourceRecord[]> {
  return db.select<KnowledgeSourceRecord>("knowledge_sources", { order: "created_at.desc", limit });
}

export async function getSource(id: string): Promise<{ source: KnowledgeSourceRecord | null; rows: KnowledgeRow[] }> {
  const [sources, rows] = await Promise.all([
    db.select<KnowledgeSourceRecord>("knowledge_sources", { id: `eq.${id}` }),
    selectAll<KnowledgeRow>("knowledge", { source_id: `eq.${id}`, order: "position.asc,id.asc" }),
  ]);
  return { source: sources[0] ?? null, rows };
}

/** 追加の元を削除（そこから作ったナレッジも削除。顧客対応マニュアルの差し替えだった場合は同梱の内容に戻す） */
export async function deleteSource(id: string): Promise<void> {
  const { source } = await getSource(id);
  if (!source) return;
  if (source.storage_path) await storageRemove([source.storage_path]).catch(() => undefined);
  await db.remove("knowledge_sources", { id: `eq.${id}` });
  if ((await kvGet<string>("override:manual")) === id) {
    await kvDelete("override:manual");
    await syncBundled(true);
  }
  await bumpKnowledgeVersion();
}

export async function insertRows(rows: KnowledgeRow[]): Promise<void> {
  await db.upsert("knowledge", rows, { onConflict: "id" });
  await bumpKnowledgeVersion();
}

/** 1 件の編集（同梱の項目を編集した場合は、以後の自動取り込みで上書きしない） */
export async function updateRow(id: string, patch: Partial<Pick<KnowledgeRow, "category" | "title" | "content" | "keywords" | "questions" | "enabled">>): Promise<KnowledgeRow | null> {
  await db.update<KnowledgeRow>("knowledge", { id: `eq.${id}` }, { ...patch, edited: true, updated_at: new Date().toISOString() });
  await bumpKnowledgeVersion();
  const rows = await db.select<KnowledgeRow>("knowledge", { id: `eq.${id}` });
  return rows[0] ?? null;
}

/** 1 件の削除（同梱の項目は自動取り込みで戻らないよう「使わない」にする） */
export async function deleteRow(id: string): Promise<void> {
  const rows = await db.select<KnowledgeRow>("knowledge", { id: `eq.${id}` });
  const row = rows[0];
  if (!row) return;
  if (BUNDLED_ORIGINS.includes(row.origin) && !row.source_id) {
    await db.update<KnowledgeRow>("knowledge", { id: `eq.${id}` }, { enabled: false, edited: true, updated_at: new Date().toISOString() });
  } else {
    await db.remove("knowledge", { id: `eq.${id}` });
  }
  await bumpKnowledgeVersion();
}

/** アップロードした顧客対応マニュアル（Excel）で、マニュアル（文章・料金表）を差し替える */
export async function replaceManual(sourceId: string, manual: ManualData): Promise<number> {
  const tables = new Map(manual.tables.map((t) => [t.id, t]));
  const short = sourceId.replace(/-/g, "").slice(0, 8);
  const rows = manual.entries.map((e, i) => {
    const table = tables.get(e.id) ?? null;
    const id = `${e.id}-${short}`;
    return entryToRow({ ...e, id }, "manual", 1000 + i, { source_id: sourceId, edited: true, price_table: table ? { ...table, id } : null });
  });
  await db.remove("knowledge", { origin: "eq.manual" });
  await db.upsert("knowledge", rows, { onConflict: "id" });
  await kvSet("override:manual", sourceId);
  await bumpKnowledgeVersion();
  return rows.length;
}

/** ホームページの再学習の結果で、ホームページの項目を差し替える（reset で同梱の内容に戻す） */
export async function replaceWebsite(entries: KnowledgeEntry[] | null): Promise<void> {
  if (!entries) {
    await kvDelete("override:website");
    await db.remove("knowledge", { origin: "eq.website" });
    await syncBundled(true);
    return;
  }
  await db.remove("knowledge", { origin: "eq.website" });
  await db.upsert(
    "knowledge",
    entries.map((e, i) => entryToRow(e, "website", 3000 + i, { edited: true })),
    { onConflict: "id" },
  );
  await kvSet("override:website", new Date().toISOString());
  await bumpKnowledgeVersion();
}

/** 以前の管理画面の「ナレッジを追加」（一覧ごと保存）。元のない追加分だけを置き換える */
export async function replaceAdminEntries(entries: KnowledgeEntry[]): Promise<void> {
  await db.remove("knowledge", { origin: "eq.admin", source_id: "is.null" });
  await db.upsert(
    "knowledge",
    entries.map((e, i) => entryToRow(e, "admin", 100 + i, { edited: true })),
    { onConflict: "id" },
  );
  await bumpKnowledgeVersion();
}
