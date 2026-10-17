// JSONファイルベースの簡易ストア（デモ用）。
// 本番ではスプレッドシート／DBが正とし、ここはキャッシュ兼ローカル記録として機能します。
import { promises as fs } from "fs";
import path from "path";
import seedEstimates from "../../data/seed/estimates.json";
import seedKnowledge from "../../data/seed/knowledge.json";
import { env } from "./env";
import type { AgentSession, AppSettings, ConversationLog, EstimateRequest, KnowledgeEntry } from "./types";

type CollectionName = "estimates" | "conversations" | "sessions" | "settings" | "knowledge_local" | "embeddings";

interface StoreState {
  cache: Map<string, unknown>;
  queues: Map<string, Promise<void>>;
  writable: boolean | null;
}

const g = globalThis as unknown as { __aicustomerStore?: StoreState };
const state: StoreState = g.__aicustomerStore ?? { cache: new Map(), queues: new Map(), writable: null };
g.__aicustomerStore = state;

const RUNTIME_DIR = path.join(process.cwd(), "data", "runtime");
const TMP_DIR = path.join(process.env.TMPDIR || process.env.TEMP || "/tmp", "aicustomer-runtime");

async function ensureDir(): Promise<string | null> {
  for (const dir of [RUNTIME_DIR, TMP_DIR]) {
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.access(dir);
      return dir;
    } catch {
      // 次の候補へ
    }
  }
  return null;
}

function seedFor(name: CollectionName): unknown {
  switch (name) {
    case "estimates":
      return seedEstimates as EstimateRequest[];
    case "knowledge_local":
      return seedKnowledge as KnowledgeEntry[];
    case "settings":
      return defaultSettings();
    case "conversations":
    case "sessions":
      return [];
    case "embeddings":
      return {};
  }
}

async function read<T>(name: CollectionName): Promise<T> {
  if (state.cache.has(name)) return state.cache.get(name) as T;
  const dir = await ensureDir();
  if (dir) {
    try {
      const raw = await fs.readFile(path.join(dir, `${name}.json`), "utf8");
      const parsed = JSON.parse(raw) as T;
      state.cache.set(name, parsed);
      return parsed;
    } catch {
      // 未作成 → シードを使用
    }
  }
  const seed = structuredClone(seedFor(name)) as T;
  state.cache.set(name, seed);
  return seed;
}

async function write<T>(name: CollectionName, value: T): Promise<void> {
  state.cache.set(name, value);
  const prev = state.queues.get(name) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      const dir = await ensureDir();
      if (!dir) return;
      const file = path.join(dir, `${name}.json`);
      const tmp = `${file}.${process.pid}.tmp`;
      try {
        await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
        await fs.rename(tmp, file);
        state.writable = true;
      } catch {
        state.writable = false; // 読み取り専用環境（メモリのみで継続）
      }
    });
  state.queues.set(name, next);
  await next;
}

// ---------- 設定 ----------

export function defaultSettings(): AppSettings {
  return {
    companyName: env.companyName,
    companyPhone: env.companyPhone,
    lineAddFriendUrl: env.lineAddFriendUrl,
    greeting:
      "お電話ありがとうございます。{company}のAI受付です。畳・襖・障子・網戸・リフォームに関するご質問や、お見積りのご依頼を承ります。ご用件をどうぞ。",
    phone: {
      mode: "ai_off_hours",
      businessDays: [1, 2, 3, 4, 5, 6],
      openTime: "09:00",
      closeTime: "18:00",
      holidays: [],
      forwardNumber: env.staffForwardNumber,
    },
    updatedAt: new Date(0).toISOString(),
  };
}

export async function getSettings(): Promise<AppSettings> {
  const saved = await read<Partial<AppSettings>>("settings");
  const def = defaultSettings();
  return {
    ...def,
    ...saved,
    phone: { ...def.phone, ...(saved.phone ?? {}) },
  };
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next: AppSettings = {
    ...current,
    ...patch,
    phone: { ...current.phone, ...(patch.phone ?? {}) },
    updatedAt: new Date().toISOString(),
  };
  await write("settings", next);
  return next;
}

// ---------- 受付（見積依頼） ----------

export async function listEstimates(): Promise<EstimateRequest[]> {
  const list = await read<EstimateRequest[]>("estimates");
  return [...list].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
}

export async function addEstimate(e: EstimateRequest): Promise<void> {
  const list = await read<EstimateRequest[]>("estimates");
  await write("estimates", [...list.filter((x) => x.id !== e.id), e]);
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

export async function listConversations(limit = 100): Promise<ConversationLog[]> {
  const list = await read<ConversationLog[]>("conversations");
  return [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, limit);
}

export async function getConversation(id: string): Promise<ConversationLog | null> {
  const list = await read<ConversationLog[]>("conversations");
  return list.find((c) => c.id === id) ?? null;
}

export async function upsertConversation(log: ConversationLog): Promise<void> {
  const list = await read<ConversationLog[]>("conversations");
  const others = list.filter((c) => c.id !== log.id);
  // 直近500件のみ保持
  const next = [...others, log].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 500);
  await write("conversations", next);
}

// ---------- エージェントセッション（電話・LINE・音声フォールバック） ----------

const SESSION_TTL_MS = 3 * 60 * 60 * 1000;

export async function getSession(id: string): Promise<AgentSession | null> {
  const list = await read<AgentSession[]>("sessions");
  return list.find((s) => s.id === id) ?? null;
}

export async function saveSession(s: AgentSession): Promise<void> {
  const list = await read<AgentSession[]>("sessions");
  const cutoff = Date.now() - SESSION_TTL_MS;
  const kept = list.filter((x) => x.id !== s.id && Date.parse(x.updatedAt) > cutoff);
  await write("sessions", [...kept, s]);
}

export async function deleteSession(id: string): Promise<void> {
  const list = await read<AgentSession[]>("sessions");
  await write(
    "sessions",
    list.filter((x) => x.id !== id),
  );
}

// ---------- ローカルナレッジ（シート未接続時／編集用） ----------

export async function getLocalKnowledge(): Promise<KnowledgeEntry[]> {
  return read<KnowledgeEntry[]>("knowledge_local");
}

export async function saveLocalKnowledge(entries: KnowledgeEntry[]): Promise<void> {
  await write("knowledge_local", entries);
}

// ---------- 埋め込みキャッシュ ----------

export async function getEmbeddingCache(): Promise<Record<string, number[]>> {
  return read<Record<string, number[]>>("embeddings");
}

export async function saveEmbeddingCache(cache: Record<string, number[]>): Promise<void> {
  await write("embeddings", cache);
}

export function storeWritable(): boolean | null {
  return state.writable;
}
