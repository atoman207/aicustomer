import { json } from "@/lib/http";
import { describeKnowledge, getKnowledge, invalidateKnowledgeCache } from "@/lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** スプレッドシート（または Excel）からナレッジを再読み込み（キャッシュ破棄） */
export async function POST() {
  invalidateKnowledgeCache();
  return json(describeKnowledge(await getKnowledge(true)));
}
