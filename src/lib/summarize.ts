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
    // 要約に必要なのはお客様の発言が中心。AI の長い回答は短くして渡す
    const transcript = messages
      .slice(-16)
      .map((m) => `${m.role === "user" ? "お客様" : "AI"}: ${truncate(m.content, m.role === "user" ? 400 : 120)}`)
      .join("\n");
    const out = await chatCompletion({
      messages: [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: `【会話ログ】\n${transcript}` },
      ],
      temperature: 0.2,
      maxTokens: 300,
      purpose: "summarize",
    });
    return { summary: out.trim() || fallback, mode: "openai" };
  } catch (e) {
    await logError("openai", "ご相談内容の要約", e);
    return { summary: fallback, mode: "demo" };
  }
}
