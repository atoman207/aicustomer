import { error, json, requireAdmin } from "@/lib/http";
import { describeKnowledge, getKnowledge, invalidateKnowledgeCache } from "@/lib/knowledge";
import { learnWebsite } from "@/lib/site-learn";
import { saveSiteKnowledge } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** ホームページ（ichijoya.co.jp）を読み直して学習（OpenAI は使わない）。?reset=1 で同梱の内容に戻す */
export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (new URL(req.url).searchParams.get("reset") === "1") {
    await saveSiteKnowledge(null);
    invalidateKnowledgeCache();
    return json({ ...describeKnowledge(await getKnowledge(true)), pages: [] });
  }
  const result = await learnWebsite();
  if (result.entries.length === 0) {
    return error(`ホームページを読み込めませんでした（${result.pages.map((p) => `${p.path}: ${p.error ?? "0件"}`).join(" / ")}）`, 502);
  }
  await saveSiteKnowledge({ fetchedAt: result.fetchedAt, entries: result.entries, pages: result.pages });
  invalidateKnowledgeCache();
  return json({ ...describeKnowledge(await getKnowledge(true)), pages: result.pages });
}
