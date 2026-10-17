import { error, json, rateLimited, readJson } from "@/lib/http";
import { getKnowledge } from "@/lib/knowledge";
import { hybridSearch } from "@/lib/retrieval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const limited = rateLimited(req, "search", 60);
  if (limited) return limited;
  const body = await readJson<{ query?: string; k?: number }>(req);
  const query = (body?.query ?? "").toString().trim().slice(0, 500);
  if (!query) return error("query が必要です");
  const k = Math.min(10, Math.max(1, Number(body?.k ?? 4) || 4));
  const snapshot = await getKnowledge();
  const result = await hybridSearch(query, snapshot.entries, k);
  return json({
    ok: true,
    mode: result.mode,
    source: snapshot.source,
    hits: result.hits.map((h) => ({
      id: h.entry.id,
      category: h.entry.category,
      title: h.entry.title,
      content: h.entry.content,
      score: Math.round(h.score * 100) / 100,
    })),
  });
}
