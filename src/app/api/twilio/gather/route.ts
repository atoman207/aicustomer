import { createSession, runTurn } from "@/lib/agent";
import { env } from "@/lib/env";
import { getBaseUrl, getCookie, parseForm, xml } from "@/lib/http";
import { CALL_COOKIE, callCookieHeader, decodeCallCookie } from "@/lib/session-codec";
import { getSession, saveSession } from "@/lib/store";
import { gather, hangup, twimlResponse, validateTwilioSignature } from "@/lib/twiml";

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
      return xml(
        twimlResponse(
          hangup("お電話が聞き取れませんでした。恐れ入りますが、改めておかけ直しください。お電話ありがとうございました。", voice),
        ),
      );
    }
    return xml(twimlResponse(gather("恐れ入ります、もう一度お話しください。", actionUrl, voice)), {
      "Set-Cookie": callCookieHeader(session),
    });
  }

  session.emptyTurns = 0;
  const { result, session: updated } = await runTurn(session, speech);
  const cookie = { "Set-Cookie": callCookieHeader(updated) };
  if (result.done) return xml(twimlResponse(hangup(result.reply, voice)), cookie);
  return xml(twimlResponse(gather(result.reply, actionUrl, voice)), cookie);
}
