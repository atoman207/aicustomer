import { env } from "@/lib/env";
import { logError } from "@/lib/errorlog";
import { resolvePhoneRouting } from "@/lib/hours";
import { getBaseUrl, parseForm, xml } from "@/lib/http";
import { SYSTEM_DOWN, closedReply, startAiCall } from "@/lib/phone-call";
import { getSettings } from "@/lib/store";
import { dial, hangup, twilioRequestOk, twimlResponse } from "@/lib/twiml";
import { e164Japan } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Twilio 着信 Webhook。0120 の番号はそのまま（NTT の契約のまま）、お店の電話（0120 の着信先）から NTT のボイスワープで
 * AI の番号（Twilio）へ転送して着信する（0120 の着信先に 050 の番号は指定できないため。README の §5）。
 * 設定・営業時間に応じて振り分ける（hours.ts の resolvePhoneRouting）：
 *   ai：AI が受ける ／ dial：転送先（スタッフ）へつなぐ（出なければ AI か「おかけ直しください」。/api/twilio/dial）／
 *   ai_after_staff：お店の電話が先に鳴り、出られなかったお電話 → AI が「担当者が出られないため」と添えて受ける ／
 *   closed：AI 停止中でつなぐ先がない → おかけ直しのご案内
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
    // 転送がぐるぐる回っている：AI の番号から転送先へかけた電話が、転送先（お店の電話のボイスワープ）からまた AI の番号へ戻ってきた。
    // 話し中で断ると、元の通話の「つないだ結果」が出なかった扱いになり、AI が代わりに受ける（/api/twilio/dial）
    const own = e164Japan(env.twilioPhoneNumber);
    if (own && e164Japan(params.From) === own) {
      await logError(
        "phone",
        "AI電話（着信）",
        "AI の番号から転送先へかけた電話が、AI の番号へ転送されて戻ってきました。転送先の番号に、お店の電話（ボイスワープで AI の番号へ転送している電話）を入れていないか確かめてください（お店の電話が先に鳴る使い方では、転送先は空にします）",
      ).catch(() => undefined);
      return xml(twimlResponse('<Reject reason="busy"/>'));
    }
    const settings = await getSettings();
    const forward = e164Japan(settings.phone.forwardNumber);
    // 転送先の電話から転送されてきた着信（ForwardedFrom。転送の仕方によっては発信者番号が転送元の番号になる）：つなぎ返さない
    const fromForwardLine = Boolean(forward) && (e164Japan(params.ForwardedFrom) === forward || e164Japan(params.From) === forward);
    const routing = resolvePhoneRouting(settings.phone, new Date(), { fromForwardLine });
    if (routing.action === "dial") {
      const then = settings.phone.mode === "human_always" ? "closed" : "ai";
      return xml(
        twimlResponse(
          dial(forward, `お電話ありがとうございます。${settings.companyName}です。担当者におつなぎしますので、そのままお待ちください。`, env.twilioVoice, {
            action: `${base}/api/twilio/dial?then=${then}`,
            callerId: env.twilioPhoneNumber || undefined,
          }),
        ),
      );
    }
    if (routing.action === "closed") return xml(twimlResponse(hangup(await closedReply(settings, routing.inBusinessHours, true), env.twilioVoice)));
    return await startAiCall(params, base, { staffAway: routing.action === "ai_after_staff" ? "forwarded" : undefined });
  } catch (e) {
    await logError("phone", "AI電話（着信）", e).catch(() => undefined);
    return xml(twimlResponse(hangup(SYSTEM_DOWN, env.twilioVoice)));
  }
}

export async function GET() {
  return new Response("Twilio voice webhook: POST のみ受け付けます", { status: 405 });
}
