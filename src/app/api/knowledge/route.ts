import { error, json, readJson, requireAdmin } from "@/lib/http";
import { describeKnowledge, getKnowledge, invalidateKnowledgeCache } from "@/lib/knowledge";
import { saveAdminKnowledge } from "@/lib/store";
import type { KnowledgeEntry } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** ナレッジの一覧と情報源ごとの件数（管理画面専用） */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return json(describeKnowledge(await getKnowledge()));
}

/** 管理画面で追加するナレッジ（マニュアル・会社情報・ホームページに無い内容の補足）を保存 */
export async function PUT(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const body = await readJson<{ entries: Partial<KnowledgeEntry>[] }>(req);
  if (!body || !Array.isArray(body.entries)) return error("entries が必要です");
  const entries: KnowledgeEntry[] = body.entries
    .map((e, i) => ({
      id: String(e.id ?? `a${String(i + 1).padStart(3, "0")}`).slice(0, 40),
      category: String(e.category ?? "追加ナレッジ").trim().slice(0, 40) || "追加ナレッジ",
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
  if (body.entries.length > 0 && entries.length === 0) return error("有効なナレッジがありません（項目名と内容は必須です）");
  await saveAdminKnowledge(entries);
  invalidateKnowledgeCache();
  return json(describeKnowledge(await getKnowledge(true)));
}
