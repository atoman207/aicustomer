import { TRANSFER_FAILED_RETRY } from "@/lib/agent";
import { env } from "@/lib/env";
import { logError } from "@/lib/errorlog";
import { getBaseUrl, parseForm, xml } from "@/lib/http";
import { afterDial } from "@/lib/phone-call";
import { hangup, twilioRequestOk, twimlResponse } from "@/lib/twiml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 担当者へつないだ結果（<Dial action>）。出なかったら AI が代わりに受ける・折り返しのご案内（phone-call.ts の afterDial） */
export async function POST(req: Request) {
  const params = await parseForm(req);
  if (!twilioRequestOk(req, params)) return new Response("invalid signature", { status: 403 });
  try {
    return await afterDial(req, params, getBaseUrl(req));
  } catch (e) {
    await logError("phone", "AI電話（担当者へつないだあと）", e).catch(() => undefined);
    return xml(twimlResponse(hangup(TRANSFER_FAILED_RETRY, env.twilioVoice)));
  }
}

export async function GET() {
  return new Response("Twilio dial webhook: POST のみ受け付けます", { status: 405 });
}
