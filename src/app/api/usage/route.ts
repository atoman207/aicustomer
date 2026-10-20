import { json, requireAdmin } from "@/lib/http";
import { getUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** AI の利用状況（日別：回答の出どころの件数と OpenAI のトークン数） */
export async function GET(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const days = Math.min(31, Math.max(1, Number(new URL(req.url).searchParams.get("days") ?? 7) || 7));
  return json({ ok: true, days: await getUsage(days) });
}
