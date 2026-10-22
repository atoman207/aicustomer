import { composeAnswer, planAnswer } from "@/lib/answer";
import { error, json, rateLimited, readJson } from "@/lib/http";
import { getSettings } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 管理画面の「回答テスト」：実際の窓口と同じ回答エンジンで答え、どこから答えたか（学習済み／AI）と根拠を返す。
 * AI が必要な質問だけ OpenAI を呼び、その回答は学習される。
 */
export async function POST(req: Request) {
  const limited = rateLimited(req, "answer-test", 30);
  if (limited) return limited;
  const body = await readJson<{ question?: string; style?: "text" | "voice" }>(req);
  const question = (body?.question ?? "").toString().trim().slice(0, 500);
  if (!question) return error("question が必要です");
  const style = body?.style === "voice" ? "voice" : "text";
  const plan = await planAnswer(question, [], { channel: style === "voice" ? "web_voice" : "web_text", style });
  let reply = plan.reply;
  let elapsedMs: number | undefined;
  if (plan.mode === "openai") {
    const settings = await getSettings();
    const t0 = Date.now();
    reply = await composeAnswer(plan, settings.companyName, [{ role: "user", content: question }], "answer_test");
    elapsedMs = Date.now() - t0;
  }
  return json({
    ok: true,
    mode: plan.mode,
    kind: plan.kind,
    reply,
    sources: plan.sources,
    contextChars: plan.context.length,
    fullContext: plan.fullContext,
    elapsedMs,
  });
}
