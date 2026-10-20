import { env } from "@/lib/env";
import { japanNow } from "@/lib/hours";
import { json, rateLimited } from "@/lib/http";
import { getKnowledge } from "@/lib/knowledge";
import { createRealtimeSecret } from "@/lib/openai";
import { buildRealtimeInstructions } from "@/lib/prompts";
import { getSettings } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REALTIME_TOOLS = [
  {
    type: "function",
    name: "search_knowledge",
    description:
      "一畳屋のナレッジ（顧客対応マニュアル・会社情報・ホームページ）を検索する。料金・工期・営業時間・対応エリア・店舗など事実を答える前に必ず使う。answer があればそれが回答の根拠。",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "検索したい内容（日本語）" } },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "propose_estimate_request",
    description:
      "お客様が見積・訪問・折り返しを希望し、氏名・住所・電話番号・希望日・相談内容を口頭で確認できたら呼び出す。画面に確認フォームが表示され、お客様が最終確認・修正して送信する。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "お名前" },
        address: { type: "string", description: "ご住所" },
        phone: { type: "string", description: "お電話番号" },
        preferred_dates: { type: "array", items: { type: "string" }, description: "第1〜第3希望（例: 10月20日 午前）" },
        summary: { type: "string", description: "ご相談内容の要約（1〜2文）" },
      },
      required: ["summary"],
    },
  },
];

/** HP上の音声相談（Realtime API / WebRTC）用の一時キーを発行 */
export async function POST(req: Request) {
  const limited = rateLimited(req, "realtime", 10);
  if (limited) return limited;
  if (!env.hasOpenAI) {
    return json({ ok: true, mode: "demo", reason: "OPENAI_API_KEY が未設定のため、ブラウザ音声認識によるデモモードで動作します" });
  }
  try {
    const [settings, snapshot] = await Promise.all([getSettings(), getKnowledge()]);
    // ナレッジ全文は渡さず、事実は search_knowledge で確認させる（毎回の応答で読み込まれる指示を短く保つ）
    const instructions = buildRealtimeInstructions(settings.companyName, japanNow().display);
    const secret = await createRealtimeSecret({ instructions, tools: REALTIME_TOOLS });
    return json({
      ok: true,
      mode: "openai",
      clientSecret: secret.value,
      expiresAt: secret.expiresAt,
      model: secret.model,
      api: secret.api,
      voice: env.realtimeVoice,
      knowledgeSource: snapshot.source,
    });
  } catch (e) {
    return json({ ok: true, mode: "demo", reason: `Realtime セッションの発行に失敗したためデモモードで動作します：${(e as Error).message.slice(0, 200)}` });
  }
}
