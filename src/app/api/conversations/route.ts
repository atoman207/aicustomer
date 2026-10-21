import { error, json, readJson, requireAdmin } from "@/lib/http";
import { getConversation, listConversations, upsertConversation } from "@/lib/store";
import type { Channel, ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHANNELS: Channel[] = ["web_text", "web_voice", "phone", "line"];

export async function GET(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const url = new URL(req.url);
  const limit = Math.min(300, Math.max(1, Number(url.searchParams.get("limit") ?? 100) || 100));
  return json({ ok: true, conversations: await listConversations(limit) });
}

/** ブラウザ側（音声相談など）からの会話ログ保存 */
export async function POST(req: Request) {
  const body = await readJson<{ id?: string; channel?: Channel; messages?: ChatMessage[]; estimateId?: string; meta?: Record<string, string> }>(req);
  const id = (body?.id ?? "").toString().slice(0, 80);
  if (!id || !Array.isArray(body?.messages)) return error("id と messages が必要です");
  const channel = CHANNELS.includes(body?.channel as Channel) ? (body?.channel as Channel) : "web_voice";
  const messages = body!.messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-80)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 3000), at: m.at }));
  const now = new Date().toISOString();
  const existing = await getConversation(id);
  const meta: Record<string, string> = { ...(existing?.meta ?? {}) };
  if (body?.meta && typeof body.meta === "object") {
    for (const [k, v] of Object.entries(body.meta).slice(0, 10)) meta[String(k).slice(0, 40)] = String(v).slice(0, 200);
  }
  // 文字の相談から声の相談へ（またはその逆）続けた会話は、使った窓口をすべて記録
  meta.channels = [...new Set([...(meta.channels ?? existing?.channel ?? "").split(","), channel].filter(Boolean))].join(",");
  await upsertConversation({
    id,
    channel,
    startedAt: existing?.startedAt ?? now,
    updatedAt: now,
    messages,
    estimateId: body?.estimateId ? String(body.estimateId).slice(0, 40) : existing?.estimateId,
    meta,
  });
  return json({ ok: true });
}
