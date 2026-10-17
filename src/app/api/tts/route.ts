import { env } from "@/lib/env";
import { error, rateLimited, readJson } from "@/lib/http";
import { synthesizeSpeech } from "@/lib/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TTS_INSTRUCTIONS =
  "熊本の住宅設備会社（畳・襖・障子・網戸・リフォーム）の受付担当として、落ち着いた丁寧な日本語で、はっきりと自然に、少しゆっくり話してください。";

/** 読み上げ音声（OpenAI TTS）。未設定時は 204 を返し、クライアント側でブラウザ合成音声にフォールバック */
export async function POST(req: Request) {
  const limited = rateLimited(req, "tts", 40);
  if (limited) return limited;
  const body = await readJson<{ text?: string }>(req);
  const text = (body?.text ?? "").toString().trim().slice(0, 1500);
  if (!text) return error("text が必要です");
  if (!env.hasOpenAI) return new Response(null, { status: 204, headers: { "X-Mode": "demo" } });
  try {
    const audio = await synthesizeSpeech(text, { instructions: TTS_INSTRUCTIONS, format: "mp3" });
    return new Response(audio, {
      status: 200,
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Mode": "openai" },
    });
  } catch (e) {
    return new Response(null, {
      status: 204,
      headers: { "X-Mode": "demo", "X-Error": encodeURIComponent((e as Error).message.slice(0, 200)) },
    });
  }
}
