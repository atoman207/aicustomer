import { json, requireAdmin } from "@/lib/http";
import { getKnowledge } from "@/lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * AI が回答に使うナレッジ（Googleスプレッドシート・ホームページ）と、料金が違うため使っていないホームページの項目。
 * 内容はスプレッドシート・ホームページで直す（管理画面では読み取り専用）
 */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const snapshot = await getKnowledge();
  return json({
    ok: true,
    entries: snapshot.entries.map((e) => ({ ...e, readonly: true, hasTable: snapshot.tables.some((t) => t.id === e.id) })),
    stale: snapshot.stale,
    stats: snapshot.stats,
    source: snapshot.source,
    sheetConnected: snapshot.sheet?.connected ?? false,
  });
}
