import { learnAnswer, planAnswer } from "@/lib/answer";
import { error, json, rateLimited, readJson } from "@/lib/http";
import { chatCompletion } from "@/lib/openai";
import { buildChatSystemPrompt } from "@/lib/prompts";
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
  let tokens: { prompt: number; completion: number } | null = null;
  if (plan.mode === "openai") {
    const settings = await getSettings();
    const t0 = Date.now();
    reply = await chatCompletion({
      messages: [
        { role: "system", content: buildChatSystemPrompt(settings.companyName, plan.context, style === "voice" ? "web_voice" : "web_text") },
        { role: "user", content: question },
      ],
      temperature: 0.3,
      maxTokens: 600,
      purpose: "answer_test",
    });
    tokens = { prompt: Math.round(plan.context.length), completion: Date.now() - t0 };
    await learnAnswer(plan, reply);
  }
  return json({
    ok: true,
    mode: plan.mode,
    kind: plan.kind,
    reply,
    sources: plan.sources,
    contextChars: plan.context.length,
    elapsedMs: tokens?.completion,
  });
}
