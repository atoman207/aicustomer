import { error, json, readJson, requireAdmin } from "@/lib/http";
import { invalidateKnowledgeCache } from "@/lib/knowledge";
import { deleteRow, rowToEntry, updateRow } from "@/lib/knowledge-db";
import { supabaseReady } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const list = (v: unknown, max: number) =>
  Array.isArray(v)
    ? v
        .map((x) => String(x).trim())
        .filter(Boolean)
        .slice(0, max)
    : undefined;

/** ナレッジ 1 件の編集（内容・分類・キーワード・聞き方の例・使う／使わない） */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!(await supabaseReady())) return error("Supabase のセットアップが必要です", 503, { setupRequired: true });
  const { id } = await ctx.params;
  const body = await readJson<{ category?: string; title?: string; content?: string; keywords?: unknown; questions?: unknown; enabled?: boolean }>(req);
  if (!body) return error("内容がありません");
  const patch: Parameters<typeof updateRow>[1] = {};
  if (typeof body.category === "string") patch.category = body.category.trim().slice(0, 40);
  if (typeof body.title === "string") {
    if (!body.title.trim()) return error("項目名を入力してください");
    patch.title = body.title.trim().slice(0, 200);
  }
  if (typeof body.content === "string") {
    if (!body.content.trim()) return error("内容を入力してください");
    patch.content = body.content.trim().slice(0, 4000);
  }
  const keywords = list(body.keywords, 30);
  if (keywords) patch.keywords = keywords;
  const questions = list(body.questions, 15);
  if (questions) patch.questions = questions;
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  const row = await updateRow(id, patch);
  if (!row) return error("見つかりません", 404);
  invalidateKnowledgeCache();
  return json({ ok: true, entry: { ...rowToEntry(row), edited: row.edited, hasTable: Boolean(row.price_table), updatedAt: row.updated_at } });
}

/** ナレッジ 1 件の削除（同梱の項目は「使わない」にする） */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!(await supabaseReady())) return error("Supabase のセットアップが必要です", 503, { setupRequired: true });
  const { id } = await ctx.params;
  await deleteRow(id);
  invalidateKnowledgeCache();
  return json({ ok: true });
}
