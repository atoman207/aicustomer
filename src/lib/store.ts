// データストア。保存先は環境により自動選択：
//   1. Supabase（SUPABASE_URL / SUPABASE_SECRET_KEY を設定し、テーブル作成済みの場合）… 永続・複数インスタンス共有
//      受付・会話履歴・電話の会話状態は 1 件ずつの行、設定・学習済みの回答・利用状況は app_kv に保存
//   2. Upstash Redis（UPSTASH_REDIS_REST_URL / KV_REST_API_URL が設定されている場合）… 永続・複数インスタンス共有
//   3. ローカルファイル data/runtime/*.json（通常のサーバー）… 永続
//   4. /tmp + メモリ（Vercel などサーバーレスで上記が未設定）… 一時的（再起動で消える）
// Supabase が使えないとき（未設定・テーブル未作成・接続エラー）は 2〜4 にフォールバックします。
import { promises as fs } from "fs";
import path from "path";
import seedEstimates from "../../data/seed/estimates.json";
import { LEGACY_COMPANY_NAMES, LEGACY_PHONES } from "./brand";
import { env } from "./env";
import { kvConfigured, kvGet, kvSet } from "./kv";
import { db, markSupabaseError, supabaseReady, supabaseStateCached } from "./supabase";
import type { AgentSession, AppSettings, ConversationLog, EstimateRequest, KnowledgeEntry, StorageInfo } from "./types";

type CollectionName =
  | "estimates"
  | "conversations"
  | "sessions"
  | "settings"
  | "knowledge_admin"
  | "site_knowledge"
  | "learned"
  | "unanswered"
  | "usage"
  | "embeddings";

interface CacheEntry {
  value: unknown;
  at: number;
}

interface StoreState {
  cache: Map<string, CacheEntry>;
  queues: Map<string, Promise<void>>;
  writable: boolean | null;
  dir: string | null | undefined;
  kvError?: string;
}

const g = globalThis as unknown as { __aicustomerStore?: StoreState };
const state: StoreState = g.__aicustomerStore ?? { cache: new Map(), queues: new Map(), writable: null, dir: undefined };
g.__aicustomerStore = state;

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
const RUNTIME_DIR = path.join(process.cwd(), "data", "runtime");
const TMP_DIR = path.join(process.env.TMPDIR || process.env.TEMP || "/tmp", "aicustomer-runtime");
const KV_CACHE_TTL_MS = 3000; // Redis 利用時のメモリキャッシュ有効期間（他インスタンスの更新を拾うため短め）
const MEMORY_ONLY: CollectionName[] = ["embeddings"]; // 大きいので Redis には置かない
/** Supabase の app_kv に 1 件として保存するもの（受付・会話・セッションは行ごと、ナレッジは knowledge テーブル） */
const SB_KV: CollectionName[] = ["settings", "site_knowledge", "learned", "unanswered", "usage"];

async function useSb(name: CollectionName): Promise<boolean> {
  return SB_KV.includes(name) && (await supabaseReady());
}

async function ensureDir(): Promise<string | null> {
  if (state.dir !== undefined) return state.dir;
  const candidates = IS_SERVERLESS ? [TMP_DIR] : [RUNTIME_DIR, TMP_DIR];
  for (const dir of candidates) {
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.access(dir);
      state.dir = dir;
      return dir;
    } catch {
      // 次の候補へ
    }
  }
  state.dir = null;
  return null;
}

function seedFor(name: CollectionName): unknown {
  switch (name) {
    case "estimates":
      return seedEstimates as EstimateRequest[];
    case "knowledge_admin":
    case "learned":
    case "unanswered":
      return [];
    case "site_knowledge":
      return null;
    case "usage":
      return {};
    case "settings":
      return defaultSettings();
    case "conversations":
    case "sessions":
      return [];
    case "embeddings":
      return {};
  }
}

function useKv(name: CollectionName): boolean {
  return kvConfigured() && !MEMORY_ONLY.includes(name);
}

function remember<T>(name: CollectionName, value: T): T {
  state.cache.set(name, { value, at: Date.now() });
  return value;
}

async function read<T>(name: CollectionName): Promise<T> {
  if (await useSb(name)) {
    const cached = state.cache.get(name);
    if (cached && Date.now() - cached.at < KV_CACHE_TTL_MS) return cached.value as T;
    try {
      const rows = await db.select<{ value: T | null }>("app_kv", { select: "value", key: `eq.${name}` });
      if (rows[0] && rows[0].value !== null) return remember(name, rows[0].value);
      if (cached) return cached.value as T;
      return remember(name, structuredClone(seedFor(name)) as T);
    } catch (e) {
      markSupabaseError(e);
      if (cached) return cached.value as T;
      // ファイル／メモリへフォールバック
    }
  }
  const cached = state.cache.get(name);
  const kv = useKv(name);
  if (cached && (!kv || Date.now() - cached.at < KV_CACHE_TTL_MS)) return cached.value as T;

  if (kv) {
    try {
      const raw = await kvGet(`aic:${name}`);
      state.kvError = undefined;
      if (raw) return remember(name, JSON.parse(raw) as T);
      if (cached) return cached.value as T; // 書き込み直後など
      return remember(name, structuredClone(seedFor(name)) as T);
    } catch (e) {
      state.kvError = (e as Error).message;
      if (cached) return cached.value as T;
      // Redis 障害時はファイル／シードへフォールバック
    }
  }
  if (cached) return cached.value as T;

  const dir = await ensureDir();
  if (dir) {
    try {
      const raw = await fs.readFile(path.join(dir, `${name}.json`), "utf8");
      return remember(name, JSON.parse(raw) as T);
    } catch {
      // 未作成 → シードを使用
    }
  }
  return remember(name, structuredClone(seedFor(name)) as T);
}

async function write<T>(name: CollectionName, value: T): Promise<void> {
  remember(name, value);
  const prev = state.queues.get(name) ?? Promise.resolve();
  const sb = await useSb(name);
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      if (sb) {
        try {
          await db.upsert("app_kv", { key: name, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
          return;
        } catch (e) {
          markSupabaseError(e); // ファイルへフォールバック
        }
      }
      if (useKv(name)) {
        try {
          await kvSet(`aic:${name}`, JSON.stringify(value));
          state.kvError = undefined;
          return;
        } catch (e) {
          state.kvError = (e as Error).message; // ファイルへフォールバック
        }
      }
      const dir = await ensureDir();
      if (!dir) {
        state.writable = false;
        return;
      }
      const file = path.join(dir, `${name}.json`);
      const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 6)}.tmp`;
      try {
        await fs.writeFile(tmp, JSON.stringify(value), "utf8");
        await fs.rename(tmp, file);
        state.writable = true;
      } catch {
        state.writable = false; // 読み取り専用環境（メモリのみで継続）
      }
    });
  state.queues.set(name, next);
  await next;
}

export function storageInfo(): StorageInfo {
  const sb = supabaseStateCached();
  if (sb?.ready) {
    return { backend: "supabase", persistent: true, label: "Supabase（データベース・永続・複数インスタンス共有）" };
  }
  if (kvConfigured()) {
    return {
      backend: "redis",
      persistent: true,
      label: "Upstash Redis（永続・複数インスタンス共有）",
      detail: state.kvError ? `直近のエラー：${state.kvError}（ファイル／メモリへフォールバック中）` : undefined,
    };
  }
  const sbNote = sb?.configured && !sb.ready ? `Supabase は未使用：${sb.error ?? "接続を確認中"}` : undefined;
  if (IS_SERVERLESS) {
    return {
      backend: "memory",
      persistent: false,
      label: "一時保存（サーバーレス：再デプロイやスリープで消えます）",
      detail: sbNote ?? "SUPABASE_URL と SUPABASE_SECRET_KEY を設定すると、受付・会話・設定が Supabase に保存されます。",
    };
  }
  return {
    backend: "file",
    persistent: true,
    label: "ローカルファイル（data/runtime）",
    detail: sbNote ?? (state.writable === false ? "書き込みに失敗したためメモリで動作中" : undefined),
  };
}

// ---------- 設定 ----------

/** 設定の版。これより古い保存値は、以前の既定値のままなら新しい既定値に移行する */
const SETTINGS_REV = 2;
/** 以前の既定の挨拶（スタッフが書き換えていなければ新しい既定に置き換える） */
const LEGACY_GREETINGS = [
  "お電話ありがとうございます。{company}のAI受付です。畳・襖・障子・網戸・リフォームに関するご質問や、お見積りのご依頼を承ります。ご用件をどうぞ。",
  "お電話ありがとうございます。畳の{company}、AI受付です。畳・襖・障子・網戸のご相談や、無料お見積りのご依頼を承ります。ご用件をどうぞ。",
];

export function defaultSettings(): AppSettings {
  return {
    companyName: env.companyName,
    companyPhone: env.companyPhone,
    lineAddFriendUrl: env.lineAddFriendUrl,
    greeting:
      "お電話ありがとうございます。畳の{company}、AI受付です。畳・襖・障子・網戸から住まいのリフォームまで、ご相談や無料お見積りのご依頼を承ります。ご用件をどうぞ。",
    // 営業時間 8:00〜17:00・土日定休。休業日（年末年始・GW・お盆など）と時間外は AI が受付
    phone: {
      mode: "ai_off_hours",
      businessDays: [1, 2, 3, 4, 5],
      openTime: "08:00",
      closeTime: "17:00",
      holidays: [],
      forwardNumber: env.staffForwardNumber,
    },
    updatedAt: new Date(0).toISOString(),
    rev: SETTINGS_REV,
  };
}

/** 以前の既定の営業時間（月〜土 8:00/9:00〜18:00）のまま保存されているか */
function isLegacyHours(p: AppSettings["phone"]): boolean {
  return p.businessDays.join(",") === "1,2,3,4,5,6" && (p.openTime === "08:00" || p.openTime === "09:00") && p.closeTime === "18:00";
}

export async function getSettings(): Promise<AppSettings> {
  const saved = await read<Partial<AppSettings>>("settings");
  const def = defaultSettings();
  const merged: AppSettings = {
    ...def,
    ...saved,
    phone: { ...def.phone, ...(saved.phone ?? {}) },
  };
  // 旧デモ（熊本たたみ工房）の値が保存されていたら一畳屋の値に置き換える
  if (LEGACY_COMPANY_NAMES.includes(merged.companyName)) merged.companyName = def.companyName;
  if (LEGACY_PHONES.includes(merged.companyPhone)) merged.companyPhone = def.companyPhone;
  if (!merged.lineAddFriendUrl) merged.lineAddFriendUrl = def.lineAddFriendUrl;
  if ((saved.rev ?? 0) < SETTINGS_REV) {
    if (LEGACY_GREETINGS.includes(merged.greeting) || /リフォームに関するご質問/.test(merged.greeting)) merged.greeting = def.greeting;
    if (isLegacyHours(merged.phone)) {
      merged.phone = { ...merged.phone, businessDays: def.phone.businessDays, openTime: def.phone.openTime, closeTime: def.phone.closeTime };
    }
    merged.rev = SETTINGS_REV;
  }
  return merged;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next: AppSettings = {
    ...current,
    ...patch,
    phone: { ...current.phone, ...(patch.phone ?? {}) },
    updatedAt: new Date().toISOString(),
    rev: SETTINGS_REV,
  };
  await write("settings", next);
  return next;
}

// ---------- 受付（見積依頼） ----------

interface EstimateRow {
  id: string;
  received_at: string;
  channel: string;
  status: string;
  data: EstimateRequest;
  updated_at: string;
}

const estimateRow = (e: EstimateRequest): EstimateRow => ({
  id: e.id,
  received_at: e.receivedAt,
  channel: e.channel,
  status: e.status,
  data: e,
  updated_at: new Date().toISOString(),
});

export async function listEstimates(): Promise<EstimateRequest[]> {
  if (await supabaseReady()) {
    try {
      const rows = await db.select<{ data: EstimateRequest }>("estimates", { select: "data", order: "received_at.desc", limit: 2000 });
      return rows.map((r) => r.data);
    } catch (e) {
      markSupabaseError(e);
    }
  }
  const list = await read<EstimateRequest[]>("estimates");
  return [...list].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
}

export async function addEstimate(e: EstimateRequest): Promise<void> {
  if (await supabaseReady()) {
    try {
      await db.upsert("estimates", estimateRow(e), { onConflict: "id" });
      return;
    } catch (err) {
      markSupabaseError(err);
    }
  }
  const list = await read<EstimateRequest[]>("estimates");
  const next = [...list.filter((x) => x.id !== e.id), e].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1)).slice(0, 1000);
  await write("estimates", next);
}

export async function updateEstimate(id: string, patch: Partial<EstimateRequest>): Promise<EstimateRequest | null> {
  if (await supabaseReady()) {
    try {
      const rows = await db.select<{ data: EstimateRequest }>("estimates", { select: "data", id: `eq.${id}` });
      if (!rows[0]) return null;
      const next = { ...rows[0].data, ...patch };
      await db.upsert("estimates", estimateRow(next), { onConflict: "id" });
      return next;
    } catch (e) {
      markSupabaseError(e);
    }
  }
  const list = await read<EstimateRequest[]>("estimates");
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return null;
  const next = { ...list[idx], ...patch };
  const copy = [...list];
  copy[idx] = next;
  await write("estimates", copy);
  return next;
}

// ---------- 会話履歴 ----------

const MAX_CONVERSATIONS = 300;
const MAX_MESSAGES_PER_CONVERSATION = 60;
/** Supabase では会話を件数の上限なく保存（1 会話の発言は直近 400 件まで） */
const MAX_MESSAGES_DB = 400;

interface ConversationRow {
  id: string;
  channel: string;
  started_at: string;
  updated_at: string;
  estimate_id: string | null;
  messages: ConversationLog["messages"];
  meta: Record<string, string>;
}

const fromConversationRow = (r: ConversationRow): ConversationLog => ({
  id: r.id,
  channel: r.channel as ConversationLog["channel"],
  startedAt: r.started_at,
  updatedAt: r.updated_at,
  messages: r.messages ?? [],
  estimateId: r.estimate_id ?? undefined,
  meta: r.meta ?? {},
});

export async function listConversations(limit = 100): Promise<ConversationLog[]> {
  if (await supabaseReady()) {
    try {
      return (await db.select<ConversationRow>("conversations", { order: "updated_at.desc", limit })).map(fromConversationRow);
    } catch (e) {
      markSupabaseError(e);
    }
  }
  const list = await read<ConversationLog[]>("conversations");
  return [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, limit);
}

export async function getConversation(id: string): Promise<ConversationLog | null> {
  if (await supabaseReady()) {
    try {
      const rows = await db.select<ConversationRow>("conversations", { id: `eq.${id}` });
      return rows[0] ? fromConversationRow(rows[0]) : null;
    } catch (e) {
      markSupabaseError(e);
    }
  }
  const list = await read<ConversationLog[]>("conversations");
  return list.find((c) => c.id === id) ?? null;
}

export async function upsertConversation(log: ConversationLog): Promise<void> {
  if (await supabaseReady()) {
    try {
      const row: ConversationRow = {
        id: log.id,
        channel: log.channel,
        started_at: log.startedAt,
        updated_at: log.updatedAt,
        estimate_id: log.estimateId ?? null,
        messages: log.messages.slice(-MAX_MESSAGES_DB),
        meta: log.meta ?? {},
      };
      await db.upsert("conversations", row, { onConflict: "id" });
      return;
    } catch (e) {
      markSupabaseError(e);
    }
  }
  const list = await read<ConversationLog[]>("conversations");
  const others = list.filter((c) => c.id !== log.id);
  const trimmed: ConversationLog = { ...log, messages: log.messages.slice(-MAX_MESSAGES_PER_CONVERSATION) };
  const next = [...others, trimmed].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, MAX_CONVERSATIONS);
  await write("conversations", next);
}

// ---------- エージェントセッション（電話・LINE・音声フォールバック） ----------

const SESSION_TTL_MS = 3 * 60 * 60 * 1000;
const MAX_SESSIONS = 200;

export async function getSession(id: string): Promise<AgentSession | null> {
  if (await supabaseReady()) {
    try {
      const rows = await db.select<{ value: AgentSession | null }>("app_kv", { select: "value", key: `eq.session:${id}` });
      const s = rows[0]?.value ?? null;
      return s && Date.parse(s.updatedAt) > Date.now() - SESSION_TTL_MS ? s : null;
    } catch (e) {
      markSupabaseError(e);
    }
  }
  const list = await read<AgentSession[]>("sessions");
  return list.find((s) => s.id === id) ?? null;
}

export async function saveSession(s: AgentSession): Promise<void> {
  if (await supabaseReady()) {
    try {
      await db.upsert("app_kv", { key: `session:${s.id}`, value: s, updated_at: new Date().toISOString() }, { onConflict: "key" });
      // ときどき古いセッションを片付ける
      if (Math.random() < 0.05) {
        void db.remove("app_kv", { key: "like.session:*", updated_at: `lt.${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}` }).catch(() => undefined);
      }
      return;
    } catch (e) {
      markSupabaseError(e);
    }
  }
  const list = await read<AgentSession[]>("sessions");
  const cutoff = Date.now() - SESSION_TTL_MS;
  const kept = list.filter((x) => x.id !== s.id && Date.parse(x.updatedAt) > cutoff);
  const next = [...kept, s].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, MAX_SESSIONS);
  await write("sessions", next);
}

export async function deleteSession(id: string): Promise<void> {
  if (await supabaseReady()) {
    try {
      await db.remove("app_kv", { key: `eq.session:${id}` });
      return;
    } catch (e) {
      markSupabaseError(e);
    }
  }
  const list = await read<AgentSession[]>("sessions");
  await write(
    "sessions",
    list.filter((x) => x.id !== id),
  );
}

// ---------- 管理画面で追加したナレッジ・再学習したホームページ ----------

export async function getAdminKnowledge(): Promise<KnowledgeEntry[]> {
  return read<KnowledgeEntry[]>("knowledge_admin");
}

export async function saveAdminKnowledge(entries: KnowledgeEntry[]): Promise<void> {
  await write("knowledge_admin", entries);
}

export interface StoredSiteKnowledge {
  fetchedAt: string;
  entries: KnowledgeEntry[];
  pages: { path: string; label: string; entries: number; error?: string }[];
}

export async function getSiteKnowledge(): Promise<StoredSiteKnowledge | null> {
  return read<StoredSiteKnowledge | null>("site_knowledge");
}

export async function saveSiteKnowledge(v: StoredSiteKnowledge | null): Promise<void> {
  await write("site_knowledge", v);
}

// ---------- 学習済みの回答・答えられなかった質問・利用状況 ----------

export async function readCollection<T>(name: "learned" | "unanswered" | "usage"): Promise<T> {
  return read<T>(name);
}

export async function writeCollection<T>(name: "learned" | "unanswered" | "usage", value: T): Promise<void> {
  await write(name, value);
}

// ---------- 埋め込みキャッシュ（メモリ／ファイルのみ） ----------

export async function getEmbeddingCache(): Promise<Record<string, number[]>> {
  return read<Record<string, number[]>>("embeddings");
}

export async function saveEmbeddingCache(cache: Record<string, number[]>): Promise<void> {
  await write("embeddings", cache);
}

export function storeWritable(): boolean | null {
  return state.writable;
}
