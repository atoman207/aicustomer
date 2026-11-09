import { env } from "@/lib/env";
import { logError } from "@/lib/errorlog";
import { resolvePhoneRouting } from "@/lib/hours";
import { getBaseUrl, parseForm, xml } from "@/lib/http";
import { SYSTEM_DOWN, startAiCall } from "@/lib/phone-call";
import { getSettings } from "@/lib/store";
import { dial, hangup, twilioRequestOk, twimlResponse } from "@/lib/twiml";
import { e164Japan } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Twilio 着信 Webhook（0120番号 → Twilio番号へ転送して着信）
 * 設定・営業時間に応じて「AI受付」または「スタッフへ転送」に振り分ける（担当者が出なければ AI が代わりに受ける。/api/twilio/dial）。
 * 会話状態はストアに保存しつつ、Twilio の通話 Cookie にも圧縮して持たせる
 * （Redis 未設定のサーバーレス環境でもインスタンス間で状態が途切れないため）。
 */
export async function POST(req: Request) {
  const params = await parseForm(req);
  if (!twilioRequestOk(req, params)) {
    await logError("phone", "AI電話（着信）", "Twilio の署名が合いません。TWILIO_AUTH_TOKEN と、Twilio に設定した Webhook の URL を確かめてください").catch(() => undefined);
    return new Response("invalid signature", { status: 403 });
  }
  const base = getBaseUrl(req);
  try {
    const settings = await getSettings();
    const routing = resolvePhoneRouting(settings.phone);
    const forward = e164Japan(settings.phone.forwardNumber);
    if (routing.handler === "human" && forward) {
      return xml(
        twimlResponse(
          dial(forward, `お電話ありがとうございます。${settings.companyName}です。担当者におつなぎしますので、そのままお待ちください。`, env.twilioVoice, {
            action: `${base}/api/twilio/dial?then=ai`,
            callerId: env.twilioPhoneNumber || undefined,
          }),
        ),
      );
    }
    return await startAiCall(params, base);
  } catch (e) {
    await logError("phone", "AI電話（着信）", e).catch(() => undefined);
    return xml(twimlResponse(hangup(SYSTEM_DOWN, env.twilioVoice)));
  }
}

export async function GET() {
  return new Response("Twilio voice webhook: POST のみ受け付けます", { status: 405 });
}
