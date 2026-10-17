import { json } from "@/lib/http";
import { getKnowledge, invalidateKnowledgeCache, remoteKnowledgeConfigured } from "@/lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** スプレッドシートからナレッジを再読み込み（キャッシュ破棄） */
export async function POST() {
  invalidateKnowledgeCache();
  const snapshot = await getKnowledge(true);
  return json({ ok: true, ...snapshot, remoteConfigured: remoteKnowledgeConfigured() });
}
