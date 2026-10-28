import { setEstimateStatus } from "@/lib/estimates";
import { error, json, readJson, requireAdmin } from "@/lib/http";
import { ESTIMATE_STATUS_LABEL, type EstimateStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUSES = Object.keys(ESTIMATE_STATUS_LABEL) as EstimateStatus[];

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await readJson<{ status?: EstimateStatus }>(req);
  if (!body || !body.status || !STATUSES.includes(body.status)) return error("status が不正です");
  // スプレッドシートに記録しているときは、シートの「対応状況」の欄も書き換える
  let updated;
  try {
    updated = await setEstimateStatus(id, body.status);
  } catch (e) {
    return error(`対応状況をスプレッドシートに記録できませんでした：${(e as Error).message}`, 502);
  }
  if (!updated) return error("受付が見つかりません", 404);
  return json({ ok: true, estimate: updated });
}
