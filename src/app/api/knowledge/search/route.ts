import { composeAnswer, planAnswer } from "@/lib/answer";
import { logError } from "@/lib/errorlog";
import { error, json, rateLimited, readJson } from "@/lib/http";
import { getSettings } from "@/lib/store";
import { truncate } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 音声相談（Realtime）の search_knowledge ツール用。answer（そのまま話せる回答）を返す：
 *   料金表・営業範囲・学習済みの回答は AI を使わずに、それ以外は文字の相談と同じ AI（資料の全文を読んで答える）で作る。
 *   AI で答えられなかったときだけ、関係するナレッジ（hits）を返す
 */
export async function POST(req: Request) {
  const limited = rateLimited(req, "search", 60);
  if (limited) return limited;
  const body = await readJson<{ query?: string; k?: number; style?: "text" | "voice" }>(req);
  const raw = (body?.query ?? "").toString().trim().slice(0, 500);
  if (!raw) return error("query が必要です");
  // query は声の AI が作る（お客様の言葉そのものではない）。AI は「…いくらですか。目安の単価と合計も」「料金 単価 目安 種類」のように
  // 言葉を足すことがあり、「単価」「1畳あたり」があると合計ではなく 1畳あたりの答えになる。
  // 畳数・枚数のある質問なら、それらの言葉を外して合計の目安で答える（答えには 1畳あたりの単価も入る）
  const query = /[\d０-９一二三四五六七八九十]+(?:畳|枚)/.test(raw)
    ? raw
        .replace(/[\s　]+(?:単価|目安|種類|一覧|料金表)(?=[\s　]|$)/g, "")
        .replace(/単価|(?:[1１一]畳|[1１一]枚)?(?:あたり|当たり)/g, "")
        .trim()
    : raw;
  const k = Math.min(6, Math.max(1, Number(body?.k ?? 3) || 3));
  const plan = await planAnswer(query, [], { channel: "web_voice", style: body?.style === "text" ? "text" : "voice", allowLLM: true });
  let answer = plan.mode === "openai" ? undefined : plan.reply;
  if (plan.mode === "openai") {
    try {
      const settings = await getSettings();
      answer = await composeAnswer(plan, settings.companyName, [{ role: "user", content: query }], "voice_answer");
    } catch (e) {
      // AI の回答が作れなければ、関係するナレッジを返して Realtime のモデルに答えさせる
      await logError("openai", "声の相談（資料からの回答）", e);
    }
  }
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
