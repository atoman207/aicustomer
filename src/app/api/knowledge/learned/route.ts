import { error, json, requireAdmin } from "@/lib/http";
import { clearUnanswered, deleteLearned, listLearned, listUnanswered } from "@/lib/learned";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 学習済みの回答と、AI が答えられなかった質問の一覧 */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const [learned, unanswered] = await Promise.all([listLearned(), listUnanswered()]);
  return json({ ok: true, learned, unanswered });
}

/** ?type=learned&key=...（key=* で全件）／?type=unanswered&key=...（key なしで全件） */
export async function DELETE(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const key = url.searchParams.get("key") ?? "";
  if (type === "learned") {
    if (!key) return error("key が必要です");
    await deleteLearned(key);
  } else if (type === "unanswered") {
    await clearUnanswered(key || undefined);
  } else {
    return error("type は learned か unanswered です");
  }
  const [learned, unanswered] = await Promise.all([listLearned(), listUnanswered()]);
  return json({ ok: true, learned, unanswered });
}
