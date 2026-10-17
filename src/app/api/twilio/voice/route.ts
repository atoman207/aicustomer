import { createSession, greetingFor } from "@/lib/agent";
import { env } from "@/lib/env";
import { resolvePhoneRouting } from "@/lib/hours";
import { getBaseUrl, parseForm, xml } from "@/lib/http";
import { callCookieHeader } from "@/lib/session-codec";
import { getSettings, saveSession } from "@/lib/store";
import { dial, gather, twimlResponse, validateTwilioSignature } from "@/lib/twiml";
import { uid } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Twilio 着信 Webhook（0120番号 → Twilio番号へ転送して着信）
 * 設定・営業時間に応じて「AI受付」または「スタッフへ転送」に振り分ける。
 * 会話状態はストアに保存しつつ、Twilio の通話 Cookie にも圧縮して持たせる
 * （Redis 未設定のサーバーレス環境でもインスタンス間で状態が途切れないため）。
 */
export async function POST(req: Request) {
  const params = await parseForm(req);
  const base = getBaseUrl(req);

  if (env.twilioAuthToken && env.publicBaseUrl) {
    const ok = validateTwilioSignature(env.twilioAuthToken, `${base}/api/twilio/voice`, params, req.headers.get("x-twilio-signature"));
    if (!ok) return new Response("invalid signature", { status: 403 });
  }

  const settings = await getSettings();
  const routing = resolvePhoneRouting(settings.phone);
  const voice = env.twilioVoice;

  if (routing.handler === "human" && settings.phone.forwardNumber) {
    return xml(
      twimlResponse(
        dial(
          settings.phone.forwardNumber,
          `お電話ありがとうございます。${settings.companyName}です。担当者におつなぎしますので、そのままお待ちください。`,
          voice,
          env.twilioPhoneNumber || undefined,
          "申し訳ございません、ただいま電話に出ることができません。恐れ入りますが、改めておかけ直しください。",
        ),
      ),
    );
  }

  const callSid = params.CallSid || uid();
  const session = await createSession("phone", `tw_${callSid}`, {
    callSid,
    callerNumber: params.From ?? "",
    calledNumber: params.To ?? "",
    routing: routing.reason,
  });
  const greeting = await greetingFor("phone");
  session.messages.push({ role: "assistant", content: greeting, at: new Date().toISOString() });
  await saveSession(session);
  return xml(twimlResponse(gather(greeting, `${base}/api/twilio/gather`, voice)), { "Set-Cookie": callCookieHeader(session) });
}

export async function GET() {
  return new Response("Twilio voice webhook: POST のみ受け付けます", { status: 405 });
}
