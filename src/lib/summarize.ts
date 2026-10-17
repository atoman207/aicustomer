// 会話ログから「ご相談内容」を要約（OpenAI 未設定時はユーザー発話の抽出）
import { env } from "./env";
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
  try {
    const transcript = messages
      .slice(-30)
      .map((m) => `${m.role === "user" ? "お客様" : "AI"}: ${m.content}`)
      .join("\n");
    const out = await chatCompletion({
      messages: [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: `【会話ログ】\n${transcript}` },
      ],
      temperature: 0.2,
      maxTokens: 350,
    });
    return { summary: out.trim() || fallback, mode: "openai" };
  } catch {
    return { summary: fallback, mode: "demo" };
  }
}
