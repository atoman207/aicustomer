import { json, requireAdmin } from "@/lib/http";
import { describeKnowledge, getKnowledge, invalidateKnowledgeCache } from "@/lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** スプレッドシート（未接続時は同梱の manual.json）からナレッジを再読み込み（キャッシュ破棄）。管理画面専用 */
export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;
  invalidateKnowledgeCache();
  return json(describeKnowledge(await getKnowledge(true)));
}
