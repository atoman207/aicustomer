import { recordDroppedCall } from "@/lib/agent";
import { logError } from "@/lib/errorlog";
import { getCookie, parseForm } from "@/lib/http";
import { forgetCall } from "@/lib/phone-call";
import { CALL_COOKIE, decodeCallCookie } from "@/lib/session-codec";
import { getSession, saveSession, upsertConversation } from "@/lib/store";
import { twilioRequestOk } from "@/lib/twiml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Twilio 通話ステータスコールバック（通話終了などを会話履歴に記録）。
 * 見積のお話の途中・聞き取りがうまくいかない途中で切れた通話は、折り返しの受付にする（agent.ts の recordDroppedCall。
 * 一畳屋様のご意見 2026-11-02「会話が成立しない時点で電話から離脱の可能性が高い」）。
 * Twilio は通話の Cookie をこのお知らせには付けないため、会話はストア（Redis。なければ、その通話を受けたインスタンスのメモリ）から読む
 */
export async function POST(req: Request) {
  const params = await parseForm(req);
  if (!twilioRequestOk(req, params)) return new Response("invalid signature", { status: 403 });
  const callSid = params.CallSid;
  if (!callSid) return new Response(null, { status: 204 });
  try {
    const id = `tw_${callSid}`;
    if (params.CallStatus === "completed") forgetCall(callSid);
    const session = (await getSession(id)) ?? decodeCallCookie(getCookie(req, CALL_COOKIE), id);
    if (session) {
      if (!session.meta?.callerNumber && params.From) session.meta = { ...(session.meta ?? {}), callerNumber: params.From };
      session.meta = { ...(session.meta ?? {}), callStatus: params.CallStatus ?? "", callDuration: params.CallDuration ?? "" };
      session.updatedAt = new Date().toISOString();
      await saveSession(session);
      await upsertConversation({
        id: session.id,
        channel: "phone",
        startedAt: session.createdAt,
        updatedAt: session.updatedAt,
        messages: session.messages,
        estimateId: session.estimateId,
        meta: session.meta,
      });
      if (params.CallStatus === "completed") await recordDroppedCall(session);
    }
  } catch (e) {
    await logError("phone", "AI電話（通話の終了のお知らせ・途中で切れた通話の折り返しの受付）", e).catch(() => undefined);
  }
  return new Response(null, { status: 204 });
}
