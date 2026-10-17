import { error, json, readJson, requireAdmin } from "@/lib/http";
import { updateEstimate } from "@/lib/store";
import type { EstimateStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUSES: EstimateStatus[] = ["new", "contacted", "scheduled", "closed"];

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await readJson<{ status?: EstimateStatus }>(req);
  if (!body || !body.status || !STATUSES.includes(body.status)) return error("status が不正です");
  const updated = await updateEstimate(id, { status: body.status });
  if (!updated) return error("受付が見つかりません", 404);
  return json({ ok: true, estimate: updated });
}
