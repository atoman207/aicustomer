// Upstash Redis REST クライアント（Vercel Marketplace の Upstash Redis／旧 Vercel KV の環境変数に対応）
// 設定されている場合、受付・会話・設定・セッションを永続化し、複数インスタンス間で共有します。

function cfg(): { url: string; token: string } {
  const url = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "").trim().replace(/\/$/, "");
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "").trim();
  return { url, token };
}

export function kvConfigured(): boolean {
  const c = cfg();
  return c.url !== "" && c.token !== "";
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

export async function kvSet(key: string, value: string): Promise<void> {
  const { url, token } = cfg();
  const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
    body: value,
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Redis SET ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (json.error) throw new Error(`Redis SET: ${json.error}`);
}
