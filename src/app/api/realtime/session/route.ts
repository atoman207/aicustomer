import { env } from "@/lib/env";
import { japanNow } from "@/lib/hours";
import { json, rateLimited } from "@/lib/http";
import { getKnowledge, knowledgeToPromptText } from "@/lib/knowledge";
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
      "社内ナレッジ（畳・襖・障子・網戸・リフォームの料金目安・工期・対応エリア・支払い方法など）を検索する。回答の根拠が必要なときに使う。",
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
    const instructions = buildRealtimeInstructions(
      settings.companyName,
      knowledgeToPromptText(snapshot.entries, 12000),
      japanNow().display,
    );
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
