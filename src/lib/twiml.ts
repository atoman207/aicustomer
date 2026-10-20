// Twilio 用 TwiML 生成と署名検証（SDK 非依存）
import crypto from "crypto";

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function twimlResponse(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

export function say(text: string, voice: string): string {
  return `<Say voice="${escapeXml(voice)}" language="ja-JP">${escapeXml(text)}</Say>`;
}

const SPEECH_HINTS =
  "一畳屋,畳,襖,ふすま,障子,網戸,アミ戸,見積,表替え,新調,張替え,琉球畳,へり無し,古都,さくら,やすらぎ,きずな,なごみ,めぐみ,極み,熊本市,合志市,菊池市,菊陽町,大津町,山鹿市,玉名市,阿蘇,午前,午後,はい,いいえ";

export function gather(
  text: string,
  actionUrl: string,
  voice: string,
  opts: { timeout?: number; speechTimeout?: string } = {},
): string {
  return (
    `<Gather input="speech" language="ja-JP" action="${escapeXml(actionUrl)}" method="POST"` +
    ` speechTimeout="${escapeXml(opts.speechTimeout ?? "auto")}" timeout="${opts.timeout ?? 6}"` +
    ` actionOnEmptyResult="true" speechModel="phone_call" enhanced="true" hints="${escapeXml(SPEECH_HINTS)}">` +
    `${say(text, voice)}</Gather>`
  );
}

export function hangup(text: string, voice: string): string {
  return `${say(text, voice)}<Hangup/>`;
}

export function dial(number: string, text: string, voice: string, callerId?: string, fallbackText?: string): string {
  const cid = callerId ? ` callerId="${escapeXml(callerId)}"` : "";
  const after = fallbackText ? `${say(fallbackText, voice)}<Hangup/>` : "";
  return `${say(text, voice)}<Dial${cid} timeout="25">${escapeXml(number)}</Dial>${after}`;
}

/** X-Twilio-Signature の検証（URL + ソート済みPOSTパラメータを HMAC-SHA1） */
export function validateTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | null,
): boolean {
  if (!signature) return false;
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  const expected = crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
