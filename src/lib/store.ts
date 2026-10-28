// データストア。保存先は環境により自動選択：
//   1. Upstash Redis（UPSTASH_REDIS_REST_URL / KV_REST_API_URL が設定されている場合）… 永続・複数インスタンス共有
//   2. ローカルファイル data/runtime/*.json（通常のサーバー）… 永続
//   3. /tmp + メモリ（Vercel などサーバーレスで Redis 未設定）… 一時的（再起動で消える）
// 受付は Googleスプレッドシート（受付一覧のタブ）にも記録するので、ここはキャッシュ兼ローカル記録として機能します。
// 会話は Redis では 1 会話 1 キーで保存します（下の「会話履歴」）。
import { promises as fs } from "fs";
import path from "path";
import { LEGACY_COMPANY_NAMES, LEGACY_PHONES } from "./brand";
import { env } from "./env";
import { kvCommand, kvConfigured, kvDeleteMatching, kvGet, kvPipeline, kvSet, kvSource } from "./kv";
import type { AgentSession, AppSettings, ConversationLog, EstimateRequest, KnowledgeEntry, StorageInfo } from "./types";

type CollectionName =
  | "estimates"
  | "conversations"
  | "sessions"
  | "settings"
  | "site_knowledge"
  | "learned"
  | "unanswered"
  | "usage"
  | "error_log"
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
  purged?: Promise<void>;
}

/**
 * 保存データの世代。上げると、その世代で消すと決めたデータ（PURGE_*）を、最初に使うときに一度だけ消す（Redis・ファイルとも）。
 *   2：2026-10-23 一畳屋様のご依頼（それまでの保存データとキャッシュをすべて削除）
 *   3：2026-10-23 それまでの会話の履歴（以前の仕組みの回答を含む）・会話の状態・学習済みの回答・答えられなかった質問を削除。
 *      受付（見積依頼）・設定・利用状況・エラー履歴は残す
 * Googleスプレッドシートの「受付一覧」タブ（受付の記録）は消さない
 */
const DATA_EPOCH = 3;
const PURGE_COLLECTIONS: CollectionName[] = ["conversations", "sessions", "learned", "unanswered"];
/** 1 件ずつのキーで保存しているもの（会話・学習済みの回答）。パターンに合うキーと、まとめのキーを消す */
const PURGE_PATTERNS = ["aic:conv:*", "aic:answer:*"];
const PURGE_KEYS = ["aic:conv-index", "aic:answer-hits"];

const g = globalThis as unknown as { __aicustomerStore?: StoreState };
const state: StoreState = g.__aicustomerStore ?? { cache: new Map(), queues: new Map(), writable: null, dir: undefined };
g.__aicustomerStore = state;

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
const RUNTIME_DIR = path.join(process.cwd(), "data", "runtime");
const TMP_DIR = path.join(process.env.TMPDIR || process.env.TEMP || "/tmp", "aicustomer-runtime");
const KV_CACHE_TTL_MS = 3000; // Redis 利用時のメモリキャッシュ有効期間（他インスタンスの更新を拾うため短め）
const MEMORY_ONLY: CollectionName[] = ["embeddings"]; // 大きいので Redis には置かない

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
      return [];
    case "learned":
    case "unanswered":
    case "error_log":
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

/** 以前の世代の保存データを消す（インスタンスごとに最初の 1 回だけ。失敗しても読み書きは続ける） */
function purgeOldData(): Promise<void> {
  state.purged ??= (async () => {
    if (kvConfigured()) {
      try {
        // 最初に世代を書けたインスタンスだけが消す（消したあとに書かれたデータを、ほかのインスタンスが消さないように）
        const won = await kvCommand(["SET", `aic:epoch:${DATA_EPOCH}`, new Date().toISOString(), "NX"]);
        if (won === "OK") {
          await kvCommand(["DEL", ...PURGE_COLLECTIONS.map((n) => `aic:${n}`), ...PURGE_KEYS]);
          for (const p of PURGE_PATTERNS) await kvDeleteMatching(p);
        }
      } catch (e) {
        state.kvError = (e as Error).message;
      }
    }
    const dir = await ensureDir();
    if (!dir) return;
    const mark = path.join(dir, `.epoch-${DATA_EPOCH}`);
    try {
      await fs.access(mark);
    } catch {
      try {
        const names = new Set(PURGE_COLLECTIONS.map((n) => `${n}.json`));
        for (const f of await fs.readdir(dir)) if (names.has(f) || /\.tmp$/.test(f)) await fs.rm(path.join(dir, f), { force: true });
        await fs.writeFile(mark, new Date().toISOString());
      } catch {
        // 読み取り専用など：そのまま使う
      }
    }
  })();
  return state.purged;
}

/** 1 件ずつのキーで Redis に保存するもの（学習済みの回答など）を使う前に呼ぶ（世代が上がっていれば、先に古いデータを消す） */
export function prepareStore(): Promise<void> {
  return purgeOldData();
}

function remember<T>(name: CollectionName, value: T): T {
  state.cache.set(name, { value, at: Date.now() });
  return value;
}

async function read<T>(name: CollectionName): Promise<T> {
  await purgeOldData();
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
  await purgeOldData();
  remember(name, value);
  const prev = state.queues.get(name) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
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
  if (kvConfigured()) {
    return {
      backend: "redis",
      persistent: true,
      label: `Upstash Redis（永続・複数インスタンス共有。${kvSource()} で接続）`,
      detail: state.kvError ? `直近のエラー：${state.kvError}（ファイル／メモリへフォールバック中）` : undefined,
    };
  }
  if (IS_SERVERLESS) {
    return {
      backend: "memory",
      persistent: false,
      label: "一時保存（サーバーレス：再デプロイやスリープで消えます）",
      detail:
        "Vercel の Storage から Upstash Redis を追加すると、受付・会話・設定が永続化され、電話・LINE の会話状態も安定します（声の相談の資料の読み込みも速くなります）。追加したあとは Redeploy してください。",
    };
  }
  return { backend: "file", persistent: true, label: "ローカルファイル（data/runtime）", detail: state.writable === false ? "書き込みに失敗したためメモリで動作中" : undefined };
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
    knowledgeSheetUrl: "",
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

export async function listEstimates(): Promise<EstimateRequest[]> {
  const list = await read<EstimateRequest[]>("estimates");
  // 対応状況は「未連絡」「連絡済」の 2 つ（2026-10-28 から）。以前に保存した「日程確定」「完了」は連絡済
  return list
    .map((e) => (e.status === "new" || e.status === "contacted" ? e : { ...e, status: "contacted" as const }))
    .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
}

export async function addEstimate(e: EstimateRequest): Promise<void> {
  const list = await read<EstimateRequest[]>("estimates");
  const next = [...list.filter((x) => x.id !== e.id), e].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1)).slice(0, 1000);
  await write("estimates", next);
}

export async function updateEstimate(id: string, patch: Partial<EstimateRequest>): Promise<EstimateRequest | null> {
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
// Redis では 1 会話 1 キー（aic:conv:<id>）と、更新日時順の一覧（aic:conv-index）で保存する
// （全会話を 1 つの値にすると、会話が増えるほど毎回の読み書きが重くなり、Redis の 1 回の上限を超えると保存できなくなるため）。
// ファイル・メモリでは 1 つの一覧で保存する

const MAX_CONVERSATIONS = 300;
/** Redis に残す会話の数（古いものから消す） */
const MAX_KV_CONVERSATIONS = 3000;
const MAX_MESSAGES_PER_CONVERSATION = 60;
const CONV_INDEX = "aic:conv-index";
const convKey = (id: string) => `aic:conv:${id}`;

function parseConversation(raw: unknown): ConversationLog | null {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as ConversationLog;
  } catch {
    return null;
  }
}

export async function listConversations(limit = 100): Promise<ConversationLog[]> {
  if (kvConfigured()) {
    try {
      await purgeOldData();
      const ids = (await kvCommand(["ZREVRANGE", CONV_INDEX, "0", String(Math.max(1, limit) - 1)])) as string[] | null;
      if (!ids?.length) return [];
      const raws = (await kvCommand(["MGET", ...ids.map(convKey)])) as unknown[];
      return raws.map(parseConversation).filter((c): c is ConversationLog => Boolean(c));
    } catch (e) {
      state.kvError = (e as Error).message; // ファイル／メモリへフォールバック
    }
  }
  const list = await read<ConversationLog[]>("conversations");
  return [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, limit);
}

export async function getConversation(id: string): Promise<ConversationLog | null> {
  if (kvConfigured()) {
    try {
      await purgeOldData();
      return parseConversation(await kvGet(convKey(id)));
    } catch (e) {
      state.kvError = (e as Error).message;
    }
  }
  const list = await read<ConversationLog[]>("conversations");
  return list.find((c) => c.id === id) ?? null;
}

export async function upsertConversation(log: ConversationLog): Promise<void> {
  const trimmed: ConversationLog = { ...log, messages: log.messages.slice(-MAX_MESSAGES_PER_CONVERSATION) };
  if (kvConfigured()) {
    try {
      await purgeOldData();
      const [, added] = await kvPipeline([
        ["SET", convKey(log.id), JSON.stringify(trimmed)],
        ["ZADD", CONV_INDEX, String(Date.parse(trimmed.updatedAt) || Date.now()), log.id],
      ]);
      // 新しい会話が増えたときだけ、上限を超えた古い会話を消す
      if (Number(added) > 0) {
        const count = Number(await kvCommand(["ZCARD", CONV_INDEX])) || 0;
        if (count > MAX_KV_CONVERSATIONS) {
          const old = ((await kvCommand(["ZRANGE", CONV_INDEX, "0", String(count - MAX_KV_CONVERSATIONS - 1)])) as string[] | null) ?? [];
          if (old.length) await kvPipeline([["DEL", ...old.map(convKey)], ["ZREM", CONV_INDEX, ...old]]);
        }
      }
      state.kvError = undefined;
      return;
    } catch (e) {
      state.kvError = (e as Error).message; // ファイル／メモリへフォールバック
    }
  }
  const list = await read<ConversationLog[]>("conversations");
  const others = list.filter((c) => c.id !== log.id);
  const next = [...others, trimmed].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, MAX_CONVERSATIONS);
  await write("conversations", next);
}

// ---------- エージェントセッション（電話・LINE・音声フォールバック） ----------

const SESSION_TTL_MS = 3 * 60 * 60 * 1000;
const MAX_SESSIONS = 200;

export async function getSession(id: string): Promise<AgentSession | null> {
  const list = await read<AgentSession[]>("sessions");
  return list.find((s) => s.id === id) ?? null;
}

export async function saveSession(s: AgentSession): Promise<void> {
  const list = await read<AgentSession[]>("sessions");
  const cutoff = Date.now() - SESSION_TTL_MS;
  const kept = list.filter((x) => x.id !== s.id && Date.parse(x.updatedAt) > cutoff);
  const next = [...kept, s].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, MAX_SESSIONS);
  await write("sessions", next);
}

export async function deleteSession(id: string): Promise<void> {
  const list = await read<AgentSession[]>("sessions");
  await write(
    "sessions",
    list.filter((x) => x.id !== id),
  );
}

// ---------- 管理画面で追加したナレッジ・再学習したホームページ ----------

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

export async function readCollection<T>(name: "learned" | "unanswered" | "usage" | "error_log"): Promise<T> {
  return read<T>(name);
}

export async function writeCollection<T>(name: "learned" | "unanswered" | "usage" | "error_log", value: T): Promise<void> {
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
