import { error, json, rateLimited, readJson } from "@/lib/http";
import { summarizeConversation } from "@/lib/summarize";
import type { ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const limited = rateLimited(req, "summarize", 15);
  if (limited) return limited;
  const body = await readJson<{ messages: ChatMessage[] }>(req);
  if (!body || !Array.isArray(body.messages)) return error("messages が必要です");
  const messages = body.messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-40)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  const result = await summarizeConversation(messages);
  return json({ ok: true, ...result });
}
