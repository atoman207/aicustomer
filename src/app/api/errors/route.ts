import { logError, type ErrorSource } from "@/lib/errorlog";
import { json, rateLimited, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** お客様の画面で起きたエラー（音声の接続が切れた・つながらない など）を管理画面の「エラー履歴」に記録する */
export async function POST(req: Request) {
  const limited = rateLimited(req, "client-error", 10);
  if (limited) return limited;
  const body = await readJson<{ source?: string; where?: string; message?: string }>(req);
  const source: ErrorSource = body?.source === "realtime" ? "realtime" : "browser";
  const where = String(body?.where ?? "お客様の画面").slice(0, 60);
  const message = String(body?.message ?? "").slice(0, 300);
  if (!message) return json({ ok: false });
  await logError(source, where, message);
  return json({ ok: true });
}
