import { error, json, requireAdmin } from "@/lib/http";
import { getKnowledge } from "@/lib/knowledge";
import { listKnowledgeRows, rowToEntry } from "@/lib/knowledge-db";
import { supabaseReady } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 登録済みのナレッジ（使わない設定のものも含む）と、内容が古い可能性のある会社情報 */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!(await supabaseReady())) return error("Supabase のセットアップが必要です", 503, { setupRequired: true });
  const [rows, snapshot] = await Promise.all([listKnowledgeRows({ includeDisabled: true }), getKnowledge()]);
  return json({
    ok: true,
    entries: rows.map((r) => ({ ...rowToEntry(r), edited: r.edited, hasTable: Boolean(r.price_table), updatedAt: r.updated_at })),
    stale: snapshot.stale,
    stats: snapshot.stats,
    source: snapshot.source,
  });
}
