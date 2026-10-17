import { createSession, runTurn } from "@/lib/agent";
import { env } from "@/lib/env";
import { getBaseUrl, parseForm, xml } from "@/lib/http";
import { getSession, saveSession } from "@/lib/store";
import { gather, hangup, twimlResponse, validateTwilioSignature } from "@/lib/twiml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const speech = (params.SpeechResult ?? "").trim();
  const session =
    (await getSession(`tw_${callSid}`)) ??
    (await createSession("phone", `tw_${callSid}`, { callSid, callerNumber: params.From ?? "" }));

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
    return xml(twimlResponse(gather("恐れ入ります、もう一度お話しください。", actionUrl, voice)));
  }

  session.emptyTurns = 0;
  const { result } = await runTurn(session, speech);
  if (result.done) return xml(twimlResponse(hangup(result.reply, voice)));
  return xml(twimlResponse(gather(result.reply, actionUrl, voice)));
}
