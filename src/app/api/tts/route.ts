import { env } from "@/lib/env";
import { logError } from "@/lib/errorlog";
import { error, rateLimited, readJson } from "@/lib/http";
import { speakableYen } from "@/lib/jnum";
import { synthesizeSpeech } from "@/lib/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 声の相談（Realtime）と同じ声・話し方：20代の日本人女性の受付スタッフ、日本語が母語の人の自然な発音
const TTS_INSTRUCTIONS =
  "熊本の老舗畳店「一畳屋」の受付を担当する20代の日本人女性として、明るく澄んだ、よく通る声で話してください。日本語を母語とする人の自然な標準語のアクセントとイントネーションで、一音一音をはっきり、ふつうの会話の速さで。接客の丁寧語で親しみをこめて、語尾を伸ばさず、文の途中で途切れさせないでください。「一畳屋」は「いちじょうや」、「表替え」は「おもてがえ」、「6畳」は「ろくじょう」、「8畳」は「はちじょう」と読みます。";

/** 読み上げ音声（OpenAI TTS）。未設定時は 204 を返し、クライアント側でブラウザ合成音声にフォールバック */
export async function POST(req: Request) {
  const limited = rateLimited(req, "tts", 40);
  if (limited) return limited;
  const body = await readJson<{ text?: string }>(req);
  const text = (body?.text ?? "").toString().trim().slice(0, 1500);
  if (!text) return error("text が必要です");
  if (!env.hasOpenAI) return new Response(null, { status: 204, headers: { "X-Mode": "demo" } });
  try {
    // 金額はひらがなの読みにしてから読み上げる（「13,200円」を「13万2千円」と読み違えないように）
    const audio = await synthesizeSpeech(speakableYen(text), { instructions: TTS_INSTRUCTIONS, format: "mp3" });
    return new Response(audio, {
      status: 200,
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Mode": "openai" },
    });
  } catch (e) {
    await logError("openai", "声の相談の読み上げ（TTS）", e);
    return new Response(null, {
      status: 204,
      headers: { "X-Mode": "demo", "X-Error": encodeURIComponent((e as Error).message.slice(0, 200)) },
    });
  }
}
