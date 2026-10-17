// LINE Messaging API（署名検証・返信・プッシュ）
import crypto from "crypto";
import { env } from "./env";

export function verifyLineSignature(rawBody: string, signature: string | null): boolean {
  if (!env.lineChannelSecret || !signature) return false;
  const digest = crypto.createHmac("sha256", env.lineChannelSecret).update(rawBody).digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface LineQuickReplyItem {
  type: "action";
  action: { type: "message"; label: string; text: string };
}

export interface LineTextMessage {
  type: "text";
  text: string;
  quickReply?: { items: LineQuickReplyItem[] };
}

export function textMessage(text: string, quick?: string[]): LineTextMessage {
  const msg: LineTextMessage = { type: "text", text: text.slice(0, 4900) };
  if (quick && quick.length > 0) {
    msg.quickReply = {
      items: quick.slice(0, 13).map((label) => ({
        type: "action",
        action: { type: "message", label: label.slice(0, 20), text: label },
      })),
    };
  }
  return msg;
}

async function lineApi(path: string, body: unknown): Promise<void> {
  const res = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.lineChannelAccessToken}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`LINE API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function lineReply(replyToken: string, messages: LineTextMessage[]): Promise<void> {
  await lineApi("reply", { replyToken, messages: messages.slice(0, 5) });
}

export async function linePush(to: string, messages: LineTextMessage[]): Promise<void> {
  await lineApi("push", { to, messages: messages.slice(0, 5) });
}

export interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { type: string; userId?: string };
  message?: { type: string; text?: string };
  postback?: { data: string };
}
