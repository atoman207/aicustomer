// Route Handler 共通ヘルパー
import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "./auth";
import { env } from "./env";

export function json<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

export function error(message: string, status = 400, extra?: Record<string, unknown>): NextResponse {
  return json({ ok: false, error: message, ...(extra ?? {}) }, { status });
}

export function xml(body: string): NextResponse {
  return new NextResponse(body, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" } });
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

export async function requireAdmin(): Promise<NextResponse | null> {
  if (await isAdminAuthenticated()) return null;
  return error("管理者としてログインしてください", 401);
}
