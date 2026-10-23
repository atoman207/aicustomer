// Upstash Redis REST クライアント（Vercel Marketplace の Upstash Redis／旧 Vercel KV の環境変数に対応）
// 設定されている場合、受付・会話・設定・セッション・資料（スプレッドシートの内容）・学習済みの回答を保存し、複数インスタンス間で共有します。
//
// 環境変数の名前は、Vercel の Storage で接続したときの「接頭辞（Prefix）」で変わるため、次のどれでも使える：
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN（Upstash の既定）
//   KV_REST_API_URL / KV_REST_API_TOKEN（Vercel の既定）
//   <接頭辞>_KV_REST_API_URL・<接頭辞>_REST_API_URL・<接頭辞>_REDIS_REST_URL と、同じ接頭辞の TOKEN（読み取り専用の TOKEN は使わない）

interface KvConfig {
  url: string;
  token: string;
  /** どの環境変数を使ったか（管理画面の表示用。値は出さない） */
  source: string;
}

const PAIRS: [string, string][] = [
  ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
  ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
];

function cfg(): KvConfig {
  const val = (name: string) => (process.env[name] ?? "").trim();
  for (const [u, t] of PAIRS) if (val(u) && val(t)) return { url: val(u).replace(/\/$/, ""), token: val(t), source: u };
  // 接頭辞つき（例：STORAGE_KV_REST_API_URL と STORAGE_KV_REST_API_TOKEN）
  for (const name of Object.keys(process.env).sort()) {
    const m = name.match(/^(.+_)(KV_REST_API|REST_API|REDIS_REST)_URL$/);
    if (!m) continue;
    const token = val(`${m[1]}${m[2]}_TOKEN`);
    if (val(name).startsWith("https://") && token) return { url: val(name).replace(/\/$/, ""), token, source: name };
  }
  return { url: "", token: "", source: "" };
}

export function kvConfigured(): boolean {
  const c = cfg();
  return c.url !== "" && c.token !== "";
}

/** 使っている環境変数の名前（管理画面の表示用） */
export function kvSource(): string {
  return cfg().source;
}

export async function kvGet(key: string): Promise<string | null> {
  const { url, token } = cfg();
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Redis GET ${res.status}`);
  const json = (await res.json()) as { result?: string | null; error?: string };
  if (json.error) throw new Error(`Redis GET: ${json.error}`);
  return json.result ?? null;
}

/** Redis のコマンドを 1 つ実行する（例：["DEL", "a", "b"]・["SET", "k", "v", "NX"]）。結果をそのまま返す */
export async function kvCommand(command: string[]): Promise<unknown> {
  const { url, token } = cfg();
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Redis ${command[0]} ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const json = (await res.json()) as { result?: unknown; error?: string };
  if (json.error) throw new Error(`Redis ${command[0]}: ${json.error}`);
  return json.result ?? null;
}

/** 保存する（ttlSeconds を指定すると、その秒数で自動的に消える） */
export async function kvSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  const { url, token } = cfg();
  // コマンドを JSON の配列で送る（Upstash の REST の基本の形。値が大きくても・記号を含んでもそのまま送れる）
  const command = ttlSeconds && ttlSeconds > 0 ? ["SET", key, value, "EX", String(Math.round(ttlSeconds))] : ["SET", key, value];
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Redis SET ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (json.error) throw new Error(`Redis SET: ${json.error}`);
}

/** 複数のコマンドを 1 回の通信で実行する（Upstash の /pipeline）。結果はコマンドの順。どれかが失敗したらエラー */
export async function kvPipeline(commands: string[][]): Promise<unknown[]> {
  if (!commands.length) return [];
  const { url, token } = cfg();
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Redis pipeline ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const json = (await res.json()) as { result?: unknown; error?: string }[];
  const failed = json.find((r) => r.error);
  if (failed) throw new Error(`Redis pipeline: ${failed.error}`);
  return json.map((r) => r.result ?? null);
}

/**
 * パターン（「aic:conv:*」のように * だけを使う）に合うキーをすべて消す（SCAN で少しずつ。消した数を返す）。
 * SCAN の結果もこちらでパターンと照らしてから消す（ほかのデータを消さないように）
 */
export async function kvDeleteMatching(pattern: string): Promise<number> {
  const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  let cursor = "0";
  let deleted = 0;
  for (let i = 0; i < 1000; i++) {
    const [next, found] = (await kvCommand(["SCAN", cursor, "MATCH", pattern, "COUNT", "500"])) as [string, string[]];
    const keys = (found ?? []).filter((k) => re.test(k));
    if (keys.length) deleted += Number(await kvCommand(["DEL", ...keys])) || 0;
    cursor = String(next);
    if (cursor === "0") break;
  }
  return deleted;
}
