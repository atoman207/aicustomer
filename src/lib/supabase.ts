// Supabase（PostgREST・Storage）の薄いラッパー（SDK 非依存・サーバー専用）
//   secret キーは API ルート・サーバーコンポーネントからだけ使い、ブラウザには渡さない
//   テーブルは supabase/schema.sql（管理画面の「セットアップ」にも表示）を SQL Editor で 1 回実行して作成する
import { env } from "./env";

export const KNOWLEDGE_BUCKET = "knowledge-files";

export class SupabaseError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "SupabaseError";
    this.status = status;
    this.code = code;
  }
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = env.supabaseSecretKey;
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

async function request(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  if (!env.hasSupabase) throw new SupabaseError("Supabase が設定されていません", 0);
  const { timeoutMs = 15_000, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${env.supabaseUrl}${path}`, { ...rest, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const name = (e as Error).name;
    throw new SupabaseError(name === "TimeoutError" || name === "AbortError" ? "Supabase がタイムアウトしました" : `Supabase に接続できません: ${(e as Error).message}`, 0);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let code: string | undefined;
    let message = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { code?: string; message?: string; error?: string };
      code = j.code;
      message = j.message ?? j.error ?? message;
    } catch {
      // JSON 以外の応答
    }
    throw new SupabaseError(`Supabase error ${res.status}: ${message}`, res.status, code);
  }
  return res;
}

type Query = Record<string, string | number | undefined>;

function qs(query: Query = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** テーブル操作（PostgREST）。query は PostgREST の書き方（例：{ id: "eq.abc", order: "updated_at.desc" }） */
export const db = {
  async select<T>(table: string, query: Query = {}): Promise<T[]> {
    const res = await request(`/rest/v1/${table}${qs({ select: "*", ...query })}`, { headers: authHeaders() });
    return (await res.json()) as T[];
  },
  async upsert<T>(table: string, rows: T | T[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}): Promise<void> {
    const list = Array.isArray(rows) ? rows : [rows];
    if (list.length === 0) return;
    // 1 回の送信が大きくなりすぎないよう分けて送る
    for (let i = 0; i < list.length; i += 200) {
      await request(`/rest/v1/${table}${qs({ on_conflict: opts.onConflict })}`, {
        method: "POST",
        headers: authHeaders({
          "Content-Type": "application/json",
          Prefer: `resolution=${opts.ignoreDuplicates ? "ignore" : "merge"}-duplicates,return=minimal`,
        }),
        body: JSON.stringify(list.slice(i, i + 200)),
        timeoutMs: 30_000,
      });
    }
  },
  async insert<T, R = T>(table: string, row: T): Promise<R> {
    const res = await request(`/rest/v1/${table}`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify(row),
    });
    const out = (await res.json()) as R[];
    return out[0];
  },
  async update<T>(table: string, query: Query, patch: Partial<T>): Promise<void> {
    await request(`/rest/v1/${table}${qs(query)}`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify(patch),
    });
  },
  async remove(table: string, query: Query): Promise<void> {
    await request(`/rest/v1/${table}${qs(query)}`, { method: "DELETE", headers: authHeaders({ Prefer: "return=minimal" }) });
  },
};

// ---------- 接続状況（テーブルが作成済みか） ----------

export interface SupabaseState {
  configured: boolean;
  ready: boolean;
  /** テーブル未作成など、使えない理由 */
  error?: string;
  setupRequired?: boolean;
  checkedAt?: string;
}

const g = globalThis as unknown as { __sbState?: { state: SupabaseState; at: number; pending?: Promise<SupabaseState> } };
const READY_TTL_MS = 60_000;
const NOT_READY_TTL_MS = 10_000;

/** Supabase が使えるか（設定済み・テーブル作成済み）。結果は短時間キャッシュする */
export async function supabaseState(force = false): Promise<SupabaseState> {
  if (!env.hasSupabase) return { configured: false, ready: false };
  const cached = g.__sbState;
  const ttl = cached?.state.ready ? READY_TTL_MS : NOT_READY_TTL_MS;
  if (!force && cached && Date.now() - cached.at < ttl) return cached.state;
  if (!force && cached?.pending) return cached.pending;
  const pending = (async (): Promise<SupabaseState> => {
    const checkedAt = new Date().toISOString();
    try {
      await request(`/rest/v1/app_kv?select=key&limit=1`, { headers: authHeaders(), timeoutMs: 8_000 });
      return { configured: true, ready: true, checkedAt };
    } catch (e) {
      const err = e as SupabaseError;
      const missing = err.status === 404 || err.code === "PGRST205" || err.code === "42P01";
      return {
        configured: true,
        ready: false,
        setupRequired: missing,
        error: missing ? "テーブルが未作成です（管理画面の「セットアップ」の SQL を Supabase の SQL Editor で実行してください）" : err.message,
        checkedAt,
      };
    }
  })();
  g.__sbState = { state: cached?.state ?? { configured: true, ready: false }, at: cached?.at ?? 0, pending };
  const state = await pending;
  g.__sbState = { state, at: Date.now() };
  return state;
}

/** 直近の確認結果（同期処理用。未確認なら null） */
export function supabaseStateCached(): SupabaseState | null {
  if (!env.hasSupabase) return { configured: false, ready: false };
  return g.__sbState?.state ?? null;
}

/** 使えるときだけ true（呼び出し側はファイル／メモリへフォールバックする） */
export async function supabaseReady(): Promise<boolean> {
  return (await supabaseState()).ready;
}

/** 書き込みに失敗したら次回の確認を早める（接続が切れた・テーブルが消えた など） */
export function markSupabaseError(e: unknown): void {
  const err = e as SupabaseError;
  if (err?.status === 404 || err?.status === 0) g.__sbState = undefined;
}

// ---------- Storage（アップロードしたファイルの原本） ----------

export async function ensureBucket(bucket = KNOWLEDGE_BUCKET): Promise<void> {
  try {
    await request(`/storage/v1/bucket/${bucket}`, { headers: authHeaders() });
  } catch (e) {
    if ((e as SupabaseError).status !== 404 && (e as SupabaseError).status !== 400) throw e;
    await request(`/storage/v1/bucket`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ id: bucket, name: bucket, public: false }),
    }).catch((err: SupabaseError) => {
      // 同時に作成された場合
      if (err.status !== 409 && !/already exists/i.test(err.message)) throw err;
    });
  }
}

export async function storageUpload(path: string, body: Uint8Array, contentType: string, bucket = KNOWLEDGE_BUCKET): Promise<void> {
  await request(`/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": contentType || "application/octet-stream", "x-upsert": "true" }),
    body: body as unknown as BodyInit,
    timeoutMs: 30_000,
  });
}

export async function storageRemove(paths: string[], bucket = KNOWLEDGE_BUCKET): Promise<void> {
  if (paths.length === 0) return;
  await request(`/storage/v1/object/${bucket}`, {
    method: "DELETE",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ prefixes: paths }),
  });
}

/** 管理画面からファイルを開くための一時 URL（1 時間） */
export async function storageSignedUrl(path: string, bucket = KNOWLEDGE_BUCKET): Promise<string> {
  const res = await request(`/storage/v1/object/sign/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ expiresIn: 3600 }),
  });
  const j = (await res.json()) as { signedURL?: string; signedUrl?: string };
  const p = j.signedURL ?? j.signedUrl ?? "";
  return p.startsWith("http") ? p : `${env.supabaseUrl}/storage/v1${p}`;
}

/** Supabase のプロジェクト ID（SQL Editor へのリンク用） */
export function supabaseProjectRef(): string {
  return env.supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? "";
}
