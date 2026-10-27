// 会話ログから「ご相談内容」を要約（OpenAI 未設定時はユーザー発話の抽出）
import { env } from "./env";
import { logError } from "./errorlog";
import { chatCompletion } from "./openai";
import { SUMMARY_SYSTEM_PROMPT } from "./prompts";
import type { ChatMessage } from "./types";
import { truncate } from "./utils";

export async function summarizeConversation(messages: ChatMessage[]): Promise<{ summary: string; mode: "openai" | "demo" }> {
  const userTexts = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content.trim())
    .filter(Boolean);
  const fallback = userTexts.length > 0 ? truncate(userTexts.join(" ／ "), 220) : "";
  if (!env.hasOpenAI || messages.length === 0) return { summary: fallback, mode: "demo" };
  // お客様の発言が短ければ、そのまま要約として使う（OpenAI を使うまでもないため）
  if (userTexts.join("").length <= 60 && userTexts.length <= 2) return { summary: fallback, mode: "demo" };
  try {
    // ご相談の中心（工事の種類など）は会話の最初のほうにあるので、長い会話は最初の 10 件と最後の 40 件を渡す
    // （以前は最後の 16 件だけで、最初の相談が要約から抜けることがあった：2026-10-27 一畳屋様のご指摘）
    const line = (m: ChatMessage) => `${m.role === "user" ? "お客様" : "AI"}: ${truncate(m.content.replace(/\s+/g, " "), m.role === "user" ? 600 : 400)}`;
    const transcript =
      messages.length <= 50 ? messages.map(line).join("\n") : [...messages.slice(0, 10).map(line), `（…途中の ${messages.length - 50} 件は省略…）`, ...messages.slice(-40).map(line)].join("\n");
    const out = await chatCompletion({
      model: env.intakeModel,
      reasoningEffort: env.intakeReasoning,
      messages: [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: `【会話ログ】\n${transcript}` },
      ],
      temperature: 0.2,
      maxTokens: 400,
      timeoutMs: 30_000,
      purpose: "summarize",
    });
    return { summary: out.trim() || fallback, mode: "openai" };
  } catch (e) {
    await logError("openai", "ご相談内容の要約", e);
    return { summary: fallback, mode: "demo" };
  }
}
