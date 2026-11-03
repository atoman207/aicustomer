import { recordDroppedCall } from "@/lib/agent";
import { env } from "@/lib/env";
import { logError } from "@/lib/errorlog";
import { getBaseUrl, getCookie, parseForm } from "@/lib/http";
import { CALL_COOKIE, decodeCallCookie } from "@/lib/session-codec";
import { getSession, saveSession, upsertConversation } from "@/lib/store";
import { validateTwilioSignature } from "@/lib/twiml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Twilio 通話ステータスコールバック（通話終了などを会話履歴に記録）。
 * 見積のお話の途中・聞き取りがうまくいかない途中で切れた通話は、折り返しの受付にする（agent.ts の recordDroppedCall。
 * 一畳屋様のご意見 2026-11-02「会話が成立しない時点で電話から離脱の可能性が高い」）
 */
export async function POST(req: Request) {
  const params = await parseForm(req);
  if (env.twilioAuthToken && env.publicBaseUrl) {
    const ok = validateTwilioSignature(env.twilioAuthToken, `${getBaseUrl(req)}/api/twilio/status`, params, req.headers.get("x-twilio-signature"));
    if (!ok) return new Response("invalid signature", { status: 403 });
  }
  const callSid = params.CallSid;
  if (callSid) {
    const id = `tw_${callSid}`;
    // 会話はストア（Redis）にあればそれを、なければ通話の Cookie から（直近の会話と伺った内容）
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
      if (params.CallStatus === "completed") await recordDroppedCall(session).catch((e) => logError("phone", "AI電話（途中で切れた通話の折り返しの受付）", e));
    }
  }
  return new Response(null, { status: 204 });
}
