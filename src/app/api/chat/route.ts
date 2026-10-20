import { learnAnswer, planAnswer, type AnswerPlan } from "@/lib/answer";
import { error, rateLimited, readJson } from "@/lib/http";
import { streamChatCompletion } from "@/lib/openai";
import { buildChatSystemPrompt } from "@/lib/prompts";
import { getConversation, getSettings, upsertConversation } from "@/lib/store";
import type { Channel, ChatMessage } from "@/lib/types";
import { truncate, uid } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Body {
  sessionId?: string;
  channel?: Channel;
  messages: ChatMessage[];
}

/** OpenAI に渡す会話履歴は直近の数往復だけ（長い履歴はトークンが増えるため） */
function recentHistory(messages: ChatMessage[]): { role: "user" | "assistant"; content: string }[] {
  return messages.slice(-6).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: truncate(m.content, 500) }));
}

export async function POST(req: Request) {
  const limited = rateLimited(req, "chat", 20);
  if (limited) return limited;
  const body = await readJson<Body>(req);
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) return error("messages が必要です");
  const sessionId = (body.sessionId ?? "").toString().slice(0, 80) || uid();
  const channel: Channel = body.channel === "web_voice" ? "web_voice" : "web_text";
  const messages = body.messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000), at: m.at }));
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return error("ユーザーメッセージがありません");

  const [settings, plan] = await Promise.all([getSettings(), planAnswer(last.content, messages.slice(0, -1), { channel })]);

  const headers = (p: AnswerPlan, mode: string): Record<string, string> => ({
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Sources": encodeURIComponent(JSON.stringify(p.sources)),
    "X-Knowledge-Source": p.snapshot.source,
    "X-Answer-Kind": p.kind,
    "X-Mode": mode,
  });

  const persist = async (reply: string, mode: string) => {
    try {
      const now = new Date().toISOString();
      const existing = await getConversation(sessionId);
      await upsertConversation({
        id: sessionId,
        channel,
        startedAt: existing?.startedAt ?? now,
        updatedAt: now,
        messages: [...messages, { role: "assistant", content: reply, at: now }],
        estimateId: existing?.estimateId,
        // 管理画面の「AIに質問（テスト）」の会話は test として記録
        meta: { mode, knowledgeSource: plan.snapshot.source, answer: plan.kind, ...(sessionId.startsWith("admintest-") ? { test: "1" } : {}) },
      });
    } catch {
      // ログ保存失敗は応答に影響させない
    }
  };

  // OpenAI を使わずに答えられる質問（料金表・会社情報・学習済み・定型文・該当なし・デモ）
  if (plan.mode !== "openai") {
    await persist(plan.reply, plan.mode);
    return new Response(plan.reply, { headers: headers(plan, plan.mode) });
  }

  try {
    const system = buildChatSystemPrompt(settings.companyName, plan.context, channel);
    const stream = await streamChatCompletion(
      {
        messages: [{ role: "system", content: system }, ...recentHistory(messages)],
        temperature: 0.3,
        maxTokens: 600,
        purpose: "chat",
      },
      async (full) => {
        await persist(full, "openai");
        await learnAnswer(plan, full);
      },
    );
    return new Response(stream, { headers: headers(plan, "openai") });
  } catch (e) {
    const reason = truncate((e as Error).message, 160);
    const top = plan.hits[0];
    const reply = `${top ? `「${top.entry.title.replace(/^.*｜/, "")}」についてご案内します。\n${truncate(top.entry.content, 800)}` : ""}\n\n（AI応答でエラーが発生したため、ナレッジ検索の結果を表示しています：${reason}）`.trim();
    await persist(reply, "demo-error");
    return new Response(reply, { headers: headers(plan, "demo-error") });
  }
}
