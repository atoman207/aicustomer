import { createEstimate, listReceptions, receptionSink, receptionSinkLabel, validateEstimateInput } from "@/lib/estimates";
import { error, json, rateLimited, readJson, requireAdmin } from "@/lib/http";
import { SALES_DECLINE, SalesPitchError } from "@/lib/sales";
import { getConversation, storageInfo, upsertConversation } from "@/lib/store";
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
  // スプレッドシートに記録しているときは、シートの受付一覧（正）＋このサーバーにだけある受付
  const { estimates, fromSheet, sheetError } = await listReceptions();
  const sink = receptionSink();
  return json({ ok: true, estimates, fromSheet, sheetError, sink, sinkLabel: receptionSinkLabel(sink), storage: storageInfo() });
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
  let created: Awaited<ReturnType<typeof createEstimate>>;
  try {
    created = await createEstimate(input);
  } catch (e) {
    // 営業・売り込みの内容は受け付けない（sales.ts。理由は管理画面のエラー履歴に）
    if (e instanceof SalesPitchError) return error(SALES_DECLINE, 422, { sales: true });
    throw e;
  }
  // 少し前に同じお客様の受付があった（2 回送信など）：新しい受付にせず、前の受付をそのまま返す
  const { duplicate, ...estimate } = created;
  if (input.sessionId) {
    const conv = await getConversation(input.sessionId);
    if (conv) await upsertConversation({ ...conv, estimateId: estimate.id, updatedAt: new Date().toISOString() });
  }
  const sink = receptionSink();
  return json({ ok: true, estimate, duplicate: duplicate === true, sink, sinkLabel: receptionSinkLabel(sink) });
}
