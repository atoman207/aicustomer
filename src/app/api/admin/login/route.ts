import { ADMIN_COOKIE, adminToken, passwordMatches } from "@/lib/auth";
import { env } from "@/lib/env";
import { error, getBaseUrl, json, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!env.adminProtected) return json({ ok: true, protected: false });
  const body = await readJson<{ password?: string }>(req);
  const password = (body?.password ?? "").toString();
  if (!password || !passwordMatches(password)) return error("パスワードが違います", 401);
  const res = json({ ok: true, protected: true });
  res.cookies.set(ADMIN_COOKIE, adminToken(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
    secure: getBaseUrl(req).startsWith("https://"),
  });
  return res;
}

export async function DELETE() {
  const res = json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
