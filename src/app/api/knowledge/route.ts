import { error, json, readJson, requireAdmin } from "@/lib/http";
import { getKnowledge, invalidateKnowledgeCache, remoteKnowledgeConfigured } from "@/lib/knowledge";
import { saveLocalKnowledge } from "@/lib/store";
import type { KnowledgeEntry } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getKnowledge();
  return json({ ok: true, ...snapshot, remoteConfigured: remoteKnowledgeConfigured() });
}

/** ローカルナレッジ（シート未接続時の編集用）を保存 */
export async function PUT(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const body = await readJson<{ entries: Partial<KnowledgeEntry>[] }>(req);
  if (!body || !Array.isArray(body.entries)) return error("entries が必要です");
  const entries: KnowledgeEntry[] = body.entries
    .map((e, i) => ({
      id: String(e.id ?? `k${String(i + 1).padStart(3, "0")}`).slice(0, 40),
      category: String(e.category ?? "その他").trim().slice(0, 40) || "その他",
      title: String(e.title ?? "").trim().slice(0, 200),
      content: String(e.content ?? "").trim().slice(0, 4000),
      keywords: Array.isArray(e.keywords)
        ? e.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 40)
        : String(e.keywords ?? "")
            .split(/[、,，\s]+/)
            .map((k) => k.trim())
            .filter(Boolean),
      note: e.note ? String(e.note).slice(0, 500) : undefined,
    }))
    .filter((e) => e.title && e.content);
  if (entries.length === 0) return error("有効なナレッジがありません（項目名と内容は必須です）");
  await saveLocalKnowledge(entries);
  invalidateKnowledgeCache();
  const snapshot = await getKnowledge(true);
  return json({ ok: true, ...snapshot, remoteConfigured: remoteKnowledgeConfigured() });
}
