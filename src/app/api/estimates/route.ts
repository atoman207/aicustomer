import { createEstimate, receptionSink, receptionSinkLabel, validateEstimateInput } from "@/lib/estimates";
import { error, json, rateLimited, readJson, requireAdmin } from "@/lib/http";
import { getConversation, listEstimates, storageInfo, upsertConversation } from "@/lib/store";
import type { Channel } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  /** 確認画面：AI が会話から入力した項目・お客様が修正した項目 */
  autofill?: { filled?: unknown; edited?: unknown };
}

const AUTOFILL_KEYS = ["name", "address", "phone", "dates", "summary"];
const keys = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(String).filter((k) => AUTOFILL_KEYS.includes(k)))] : []);

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const estimates = await listEstimates();
  const sink = receptionSink();
  return json({ ok: true, estimates, sink, sinkLabel: receptionSinkLabel(sink), storage: storageInfo() });
}

export async function POST(req: Request) {
  const limited = rateLimited(req, "estimates", 10);
  if (limited) return limited;
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
    autofill: body.autofill ? { filled: keys(body.autofill.filled), edited: keys(body.autofill.edited) } : undefined,
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
