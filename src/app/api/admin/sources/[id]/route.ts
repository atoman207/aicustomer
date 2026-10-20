import { error, json, requireAdmin } from "@/lib/http";
import { invalidateKnowledgeCache } from "@/lib/knowledge";
import { deleteSource, getSource, rowToEntry } from "@/lib/knowledge-db";
import { storageSignedUrl, supabaseReady } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 追加した情報 1 件と、そこから作ったナレッジ（元のファイルを開く一時 URL つき） */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!(await supabaseReady())) return error("Supabase のセットアップが必要です", 503, { setupRequired: true });
  const { id } = await ctx.params;
  const { source, rows } = await getSource(id);
  if (!source) return error("見つかりません", 404);
  const fileUrl = source.storage_path ? await storageSignedUrl(source.storage_path).catch(() => null) : null;
  return json({ ok: true, source, fileUrl, entries: rows.map((r) => ({ ...rowToEntry(r), hasTable: Boolean(r.price_table) })) });
}

/** 追加した情報を削除（そこから作ったナレッジ・保存したファイルも削除） */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!(await supabaseReady())) return error("Supabase のセットアップが必要です", 503, { setupRequired: true });
  const { id } = await ctx.params;
  await deleteSource(id);
  invalidateKnowledgeCache();
  return json({ ok: true });
}
