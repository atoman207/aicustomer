import { env } from "@/lib/env";
import { logError } from "@/lib/errorlog";
import { getBaseUrl, parseForm, xml } from "@/lib/http";
import { SYSTEM_DOWN, answerCall } from "@/lib/phone-call";
import { hangup, twilioRequestOk, twimlResponse } from "@/lib/twiml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Twilio <Gather> の音声認識結果を受け取り、AI応答を TwiML で返す。
 * 答えに時間がかかるときは「少々お待ちください」を伝えて、?resume=1 で続きを返す（phone-call.ts）
 */
export async function POST(req: Request) {
  const params = await parseForm(req);
  if (!twilioRequestOk(req, params)) {
    await logError("phone", "AI電話（お客様の発言）", "Twilio の署名が合いません。TWILIO_AUTH_TOKEN を確かめてください").catch(() => undefined);
    return new Response("invalid signature", { status: 403 });
  }
  try {
    return await answerCall(req, params, getBaseUrl(req));
  } catch (e) {
    await logError("phone", "AI電話（お客様の発言）", e).catch(() => undefined);
    return xml(twimlResponse(hangup(SYSTEM_DOWN, env.twilioVoice)));
  }
}

export async function GET() {
  return new Response("Twilio gather webhook: POST のみ受け付けます", { status: 405 });
}
