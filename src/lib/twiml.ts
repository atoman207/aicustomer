// Twilio 用 TwiML 生成と署名検証（SDK 非依存）
import crypto from "crypto";
import { env } from "./env";
import { requestOrigin } from "./origin";
import { speakableYen } from "./jnum";
import { type AskKind, hintsFor } from "./phone-ask";

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
  // 金額は万の位で区切ってから読み上げる（桁の読み違えをしないように。jnum.ts）
  return `<Say voice="${escapeXml(voice)}" language="ja-JP">${escapeXml(speakableYen(text))}</Say>`;
}

/**
 * 話し終わってから音声認識を締めるまでの秒数。
 * Twilio は speechModel を指定したとき speechTimeout="auto" を使えない（警告 13335 が出て、
 * 音声認識が数字・短い指示向けのモデルに切り替わる）ため、秒数で指定する。
 * 50〜70代の方が文の途中で息をつく間（1 秒ほど）では締めない長さ
 */
export const SPEECH_TIMEOUT_SECONDS = 2;
/** ご住所・お電話番号の問い：数字や番地の区切りで間が空いても締めない長さ */
export const LONG_SPEECH_TIMEOUT_SECONDS = 3;

export interface GatherOptions {
  timeout?: number;
  speechTimeout?: number;
  /** AI が伺ったこと（phone-ask.ts の askKind）。お電話番号の問いは電話のボタンでも受ける */
  kind?: AskKind;
  /** 音声認識のヒント（phone-ask.ts の hintsFor）。省略時はご相談の問いのヒント */
  hints?: string[];
}

/**
 * 電話の音声認識のモデル（TWILIO_SPEECH_MODEL）。既定の phone_call は電話の音声（8kHz）向けで、Twilio の資料に日本語（ja-JP）の対応が明記されている。
 * deepgram_nova-3・googlev2_telephony_short は、試験通話で日本語を受けることを確かめてから切り替える（調査「AI電話の音声認識サービス選定」）
 */
function speechModel(): string {
  return env.twilioSpeechModel;
}

export function gather(text: string, actionUrl: string, voice: string, opts: GatherOptions = {}): string {
  const kind = opts.kind ?? "consult";
  const model = speechModel();
  const longer = kind === "address" || kind === "phone";
  // Deepgram はヒント（keyterms）が少ないほうがよい
  const hints = (opts.hints ?? hintsFor(kind, undefined)).slice(0, /^deepgram/.test(model) ? 100 : 500);
  // お電話番号：話しても、電話のボタンで押してもよい（最後の「#」で締める。押し終わって 8 秒待っても締める）
  const input = kind === "phone" ? ` input="dtmf speech" finishOnKey="#"` : ` input="speech"`;
  return (
    `<Gather${input} language="ja-JP" action="${escapeXml(actionUrl)}" method="POST"` +
    ` speechTimeout="${opts.speechTimeout ?? (longer ? LONG_SPEECH_TIMEOUT_SECONDS : SPEECH_TIMEOUT_SECONDS)}" timeout="${opts.timeout ?? (kind === "phone" ? 8 : 6)}"` +
    // profanityFilter：既定（true）では、引っかかった言葉が「*」に置き換わる（お名前・ご住所が欠けないように）
    ` actionOnEmptyResult="true" speechModel="${escapeXml(model)}" profanityFilter="false"` +
    `${hints.length ? ` hints="${escapeXml(hints.join(","))}"` : ""}>` +
    `${say(text, voice)}</Gather>`
  );
}

export function hangup(text: string, voice: string): string {
  return `${say(text, voice)}<Hangup/>`;
}

/** 別の URL に続きを取りに行く（AI の答えに時間がかかっているとき。お客様には先に「少々お待ちください」を伝える） */
export function redirect(url: string): string {
  return `<Redirect method="POST">${escapeXml(url)}</Redirect>`;
}

/**
 * 担当者へつなぐ。number は国際形式（+81…。utils.ts の e164Japan）。
 * 終わったら action に Twilio が結果（DialCallStatus）を送る（出なかったときの案内はそこで返す。
 * <Dial> のあとに続けて書くと、担当者と話し終えたあとにも「出られません」と流れてしまうため）
 */
export function dial(number: string, text: string, voice: string, opts: { action: string; callerId?: string }): string {
  const cid = opts.callerId ? ` callerId="${escapeXml(opts.callerId)}"` : "";
  return `${say(text, voice)}<Dial action="${escapeXml(opts.action)}" method="POST" timeout="25"${cid}><Number>${escapeXml(number)}</Number></Dial>`;
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

/**
 * Twilio からのリクエストか（TWILIO_AUTH_TOKEN があるときだけ確かめる）。
 * Twilio は、Twilio に設定した URL（クエリを含む）で署名する。その URL は、届いたリクエストのホスト名か
 * PUBLIC_BASE_URL のどちらか（独自ドメイン・Vercel のドメインのどちらで設定しても通るように、両方で確かめる）
 */
export function twilioRequestOk(req: Request, params: Record<string, string>): boolean {
  if (!env.twilioAuthToken) return true;
  const u = new URL(req.url);
  const rest = `${u.pathname}${u.search}`;
  const bases = [...new Set([requestOrigin(req), env.publicBaseUrl].filter(Boolean))];
  const sig = req.headers.get("x-twilio-signature");
  return bases.some((b) => validateTwilioSignature(env.twilioAuthToken, `${b}${rest}`, params, sig));
}
