// 簡易レートリミット（インスタンス内メモリ）。公開APIから OpenAI を無制限に叩かれないための最低限の保護
interface Bucket {
  count: number;
  reset: number;
}

const g = globalThis as unknown as { __aicRateBuckets?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = g.__aicRateBuckets ?? new Map();
g.__aicRateBuckets = buckets;

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number; remaining: number } {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= now) {
    b = { count: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
  }
  return { ok: b.count <= limit, retryAfterSec: Math.max(1, Math.ceil((b.reset - now) / 1000)), remaining: Math.max(0, limit - b.count) };
}
