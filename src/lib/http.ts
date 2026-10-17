// Route Handler 共通ヘルパー
import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "./auth";
import { env } from "./env";
import { rateLimit } from "./ratelimit";

export function json<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

export function error(message: string, status = 400, extra?: Record<string, unknown>): NextResponse {
  return json({ ok: false, error: message, ...(extra ?? {}) }, { status });
}

export function xml(body: string, headers: Record<string, string> = {}): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

/** 公開URL（Webhook 生成用）。PUBLIC_BASE_URL 優先、なければリクエストヘッダから推定 */
export function getBaseUrl(req: Request): string {
  if (env.publicBaseUrl) return env.publicBaseUrl;
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

/** application/x-www-form-urlencoded（Twilio Webhook）を解析 */
export async function parseForm(req: Request): Promise<Record<string, string>> {
  const text = await req.text();
  const out: Record<string, string> = {};
  new URLSearchParams(text).forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

export function getCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

/** 超過時は 429 レスポンスを返す（null なら続行） */
export function rateLimited(req: Request, scope: string, limit: number, windowMs = 60_000): NextResponse | null {
  const r = rateLimit(`${scope}:${clientIp(req)}`, limit, windowMs);
  if (r.ok) return null;
  return json(
    { ok: false, error: "アクセスが集中しています。しばらくしてから再度お試しください。" },
    { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } },
  );
}

export async function requireAdmin(): Promise<NextResponse | null> {
  if (await isAdminAuthenticated()) return null;
  return error("管理者としてログインしてください", 401);
}
