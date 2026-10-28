import { composeAnswer, planAnswer } from "@/lib/answer";
import { logError } from "@/lib/errorlog";
import { error, json, rateLimited, readJson } from "@/lib/http";
import { speakableYen } from "@/lib/jnum";
import { getSettings } from "@/lib/store";
import { truncate } from "@/lib/utils";
import { speakableWords } from "@/lib/voice-words";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 音声相談（Realtime）の search_knowledge ツール用。answer（そのまま話せる回答）を返す：
 *   文字の相談と同じ AI が、指定のスプレッドシートの全文を読んで答える（料金も。数量があればシステムの計算を参考に添える）。
 *   AI で答えられなかったときだけ、関係するナレッジ（hits）を返す
 */
export async function POST(req: Request) {
  const limited = rateLimited(req, "search", 60);
  if (limited) return limited;
  const body = await readJson<{ query?: string; k?: number; style?: "text" | "voice" }>(req);
  // query は声の AI が作るお客様の質問の一文（言葉を削ったり足したりしない：「1枚あたり」などの聞き方も、資料の全文を読む AI が読み取る）
  const query = (body?.query ?? "").toString().trim().slice(0, 500);
  if (!query) return error("query が必要です");
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
  // 声の AI に渡す金額は万の位で区切る（「13,200円」→「1万3200円」。3桁区切りのままだと「13万2千円」と読み違えることがある。jnum.ts）。
  // 読み間違えやすい言葉（見積り・畳床・承る・スプレッドシートの読み方の一覧）はひらがなにする（voice-words.ts）
  const voice = body?.style !== "text";
  const readings = plan.snapshot.readings ?? [];
  const speak = (s: string) => (voice ? speakableWords(speakableYen(s), readings) : s);
  return json({
    ok: true,
    mode: plan.mode,
    kind: plan.kind,
    source: plan.snapshot.source,
    answer: answer ? speak(answer) : answer,
    hits: plan.hits.slice(0, k).map((h) => ({
      id: h.entry.id,
      from: "スプレッドシート",
      category: h.entry.category,
      title: h.entry.title,
      content: speak(truncate(h.entry.content, 700)),
      score: Math.round(h.score * 100) / 100,
    })),
    sources: plan.sources,
  });
}
