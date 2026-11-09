import { env } from "@/lib/env";
import { logError } from "@/lib/errorlog";
import { parseForm, xml } from "@/lib/http";
import { SYSTEM_DOWN } from "@/lib/phone-call";
import { hangup, twilioRequestOk, twimlResponse } from "@/lib/twiml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Twilio の番号の「Primary handler fails」（予備の URL）に設定する。着信・発言の Webhook が応答しなかったとき
 * （サーバーの障害・時間切れ）に、Twilio の英語のエラーの代わりに日本語でおわびして終える
 */
export async function POST(req: Request) {
  const params = await parseForm(req);
  if (!twilioRequestOk(req, params)) return new Response("invalid signature", { status: 403 });
  const code = params.ErrorCode ? `Twilio のエラー ${params.ErrorCode}` : "Twilio の予備の URL が呼ばれました";
  await logError("phone", "AI電話（Webhook が応答せず、予備の URL でおわび）", `${code}${params.ErrorUrl ? `（${params.ErrorUrl}）` : ""}`).catch(() => undefined);
  return xml(twimlResponse(hangup(SYSTEM_DOWN, env.twilioVoice)));
}

export async function GET() {
  return new Response("Twilio fallback webhook: POST のみ受け付けます", { status: 405 });
}
