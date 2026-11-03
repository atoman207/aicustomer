import { TRANSFER_FAILED, TRANSFER_FAILED_RETRY, createSession, handOffTurn, runTurn } from "@/lib/agent";
import { env } from "@/lib/env";
import { getBaseUrl, getCookie, parseForm, xml } from "@/lib/http";
import { CALL_COOKIE, callCookieHeader, decodeCallCookie } from "@/lib/session-codec";
import { getSession, saveSession } from "@/lib/store";
import { dial, gather, hangup, twimlResponse, validateTwilioSignature } from "@/lib/twiml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Twilio <Gather> の音声認識結果を受け取り、AI応答を TwiML で返す */
export async function POST(req: Request) {
  const params = await parseForm(req);
  const base = getBaseUrl(req);
  const voice = env.twilioVoice;
  const actionUrl = `${base}/api/twilio/gather`;

  if (env.twilioAuthToken && env.publicBaseUrl) {
    const ok = validateTwilioSignature(env.twilioAuthToken, actionUrl, params, req.headers.get("x-twilio-signature"));
    if (!ok) return new Response("invalid signature", { status: 403 });
  }

  const callSid = params.CallSid || "unknown";
  const sessionId = `tw_${callSid}`;
  const speech = (params.SpeechResult ?? "").trim();
  const session =
    (await getSession(sessionId)) ??
    decodeCallCookie(getCookie(req, CALL_COOKIE), sessionId) ??
    (await createSession("phone", sessionId, { callSid, callerNumber: params.From ?? "" }));

  if (!speech) {
    session.emptyTurns += 1;
    await saveSession(session);
    if (session.emptyTurns >= 2) {
      // 2 回続けて聞き取れない：切って終わりにせず、ご用件を伺えていれば折り返しの受付にする（agent.ts の handOff）
      if (session.estimateId) return xml(twimlResponse(hangup("お電話ありがとうございました。", voice)));
      const { result, session: updated } = await handOffTurn(session, "unheard");
      return xml(twimlResponse(hangup(result.reply, voice)), { "Set-Cookie": callCookieHeader(updated) });
    }
    return xml(twimlResponse(gather("恐れ入ります、もう一度お話しください。", actionUrl, voice)), {
      "Set-Cookie": callCookieHeader(session),
    });
  }

  session.emptyTurns = 0;
  const { result, session: updated } = await runTurn(session, speech);
  const cookie = { "Set-Cookie": callCookieHeader(updated) };
  // 人と話したい（営業時間内・転送先あり）：担当者へつなぐ（受付一覧には先に記録済み。つながらなければ折り返し）
  if (result.transfer)
    return xml(twimlResponse(dial(result.transfer, result.reply, voice, env.twilioPhoneNumber || undefined, result.estimate ? TRANSFER_FAILED : TRANSFER_FAILED_RETRY)), cookie);
  if (result.done) return xml(twimlResponse(hangup(result.reply, voice)), cookie);
  return xml(twimlResponse(gather(result.reply, actionUrl, voice)), cookie);
}
