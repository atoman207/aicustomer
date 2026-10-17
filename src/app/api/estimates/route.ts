import { createEstimate, receptionSink, receptionSinkLabel, validateEstimateInput } from "@/lib/estimates";
import { error, json, readJson, requireAdmin } from "@/lib/http";
import { getConversation, listEstimates, upsertConversation } from "@/lib/store";
import type { Channel } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNELS: Channel[] = ["web_text", "web_voice", "phone", "line"];

interface Body {
  channel?: Channel;
  name?: string;
  address?: string;
  phone?: string;
  summary?: string;
  preferredDates?: string[];
  sessionId?: string;
  confirmed?: boolean;
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const estimates = await listEstimates();
  const sink = receptionSink();
  return json({ ok: true, estimates, sink, sinkLabel: receptionSinkLabel(sink) });
}

export async function POST(req: Request) {
  const body = await readJson<Body>(req);
  if (!body) return error("リクエスト本文が不正です");
  if (body.confirmed !== true) return error("送信前にお客様による内容確認（confirmed=true）が必要です");
  const input = {
    channel: CHANNELS.includes(body.channel as Channel) ? (body.channel as Channel) : "web_text",
    name: String(body.name ?? ""),
    address: String(body.address ?? ""),
    phone: String(body.phone ?? ""),
    summary: String(body.summary ?? ""),
    preferredDates: Array.isArray(body.preferredDates) ? body.preferredDates.map((d) => String(d ?? "")) : [],
    sessionId: body.sessionId ? String(body.sessionId).slice(0, 80) : undefined,
    confirmedByCustomer: true,
  };
  const errors = validateEstimateInput(input);
  if (errors.length > 0) return error(errors.join("、"), 400, { errors });
  const estimate = await createEstimate(input);
  if (input.sessionId) {
    const conv = await getConversation(input.sessionId);
    if (conv) await upsertConversation({ ...conv, estimateId: estimate.id, updatedAt: new Date().toISOString() });
  }
  const sink = receptionSink();
  return json({ ok: true, estimate, sink, sinkLabel: receptionSinkLabel(sink) });
}
