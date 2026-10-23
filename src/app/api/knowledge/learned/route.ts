import { error, json, requireAdmin } from "@/lib/http";
import { getKnowledge } from "@/lib/knowledge";
import { clearUnanswered, deleteLearned, listLearned, listUnanswered } from "@/lib/learned";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 学習済みの回答（今のスプレッドシートの版で作ったものだけ）と、AI が答えられなかった質問の一覧 */
async function lists() {
  const snapshot = await getKnowledge();
  const [learned, unanswered] = await Promise.all([listLearned(snapshot.version), listUnanswered()]);
  return { learned, unanswered };
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return json({ ok: true, ...(await lists()) });
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
  return json({ ok: true, ...(await lists()) });
}
