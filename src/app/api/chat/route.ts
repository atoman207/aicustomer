import { env } from "@/lib/env";
import { fallbackAnswer } from "@/lib/fallback";
import { error, rateLimited, readJson } from "@/lib/http";
import { getKnowledge, knowledgeToPromptText } from "@/lib/knowledge";
import { streamChatCompletion } from "@/lib/openai";
import { buildChatSystemPrompt } from "@/lib/prompts";
import { hybridSearch } from "@/lib/retrieval";
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

  const [settings, snapshot] = await Promise.all([getSettings(), getKnowledge()]);
  const search = await hybridSearch(last.content, snapshot.entries, 4);
  const sources = search.hits.map((h) => ({
    id: h.entry.id,
    title: h.entry.title,
    category: h.entry.category,
    score: Math.round(h.score * 100) / 100,
  }));

  const baseHeaders: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Sources": encodeURIComponent(JSON.stringify(sources)),
    "X-Knowledge-Source": snapshot.source,
    "X-Search-Mode": search.mode,
  };

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
        meta: { mode, knowledgeSource: snapshot.source },
      });
    } catch {
      // ログ保存失敗は応答に影響させない
    }
  };

  if (!env.hasOpenAI) {
    const reply = fallbackAnswer(search.hits);
    await persist(reply, "demo");
    return new Response(reply, { headers: { ...baseHeaders, "X-Mode": "demo" } });
  }

  try {
    let system = buildChatSystemPrompt(settings.companyName, knowledgeToPromptText(snapshot.entries, 14000), channel);
    if (search.hits.length > 0) {
      system += `\n\n# 直近の質問に関連するナレッジ（優先して参照）\n${search.hits
        .map((h) => `- ${h.entry.title}: ${h.entry.content}`)
        .join("\n")}`;
    }
    const stream = await streamChatCompletion(
      {
        messages: [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))],
        temperature: 0.3,
        maxTokens: 700,
      },
      (full) => persist(full, "openai"),
    );
    return new Response(stream, { headers: { ...baseHeaders, "X-Mode": "openai" } });
  } catch (e) {
    const reason = truncate((e as Error).message, 160);
    const reply = `${fallbackAnswer(search.hits)}\n\n（AI応答でエラーが発生したため、ナレッジ検索の結果を表示しています：${reason}）`;
    await persist(reply, "demo-error");
    return new Response(reply, { headers: { ...baseHeaders, "X-Mode": "demo-error" } });
  }
}
