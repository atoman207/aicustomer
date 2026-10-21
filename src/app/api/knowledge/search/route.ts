import { planAnswer } from "@/lib/answer";
import { error, json, rateLimited, readJson } from "@/lib/http";
import { truncate } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 音声相談（Realtime）の search_knowledge ツール用。
 * 学習済みのナレッジで答えられる質問は answer（そのまま話せる回答）を返し、それ以外は関係するナレッジだけを返す。
 */
export async function POST(req: Request) {
  const limited = rateLimited(req, "search", 60);
  if (limited) return limited;
  const body = await readJson<{ query?: string; k?: number; style?: "text" | "voice" }>(req);
  const query = (body?.query ?? "").toString().trim().slice(0, 500);
  if (!query) return error("query が必要です");
  const k = Math.min(6, Math.max(1, Number(body?.k ?? 3) || 3));
  const plan = await planAnswer(query, [], { channel: "web_voice", style: body?.style === "text" ? "text" : "voice", allowLLM: true });
  const answer = plan.mode === "openai" ? undefined : plan.reply;
  return json({
    ok: true,
    mode: plan.mode,
    kind: plan.kind,
    source: plan.snapshot.source,
    answer,
    // 同じ内容はスプレッドシートが正（hits はスプレッドシートが先に並ぶ）
    hits: plan.hits.slice(0, k).map((h) => ({
      id: h.entry.id,
      from: h.entry.origin === "website" ? "ホームページ（補足）" : "スプレッドシート（正）",
      category: h.entry.category,
      title: h.entry.title,
      content: truncate(h.entry.content, 700),
      score: Math.round(h.score * 100) / 100,
    })),
    sources: plan.sources,
  });
}
