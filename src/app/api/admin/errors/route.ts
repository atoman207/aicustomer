import { clearErrors, listErrors } from "@/lib/errorlog";
import { json, requireAdmin } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** エラー履歴（新しい順） */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return json({ ok: true, errors: await listErrors() });
}

/** エラー履歴を消す（確認が済んだあと） */
export async function DELETE() {
  const denied = await requireAdmin();
  if (denied) return denied;
  await clearErrors();
  return json({ ok: true });
}
