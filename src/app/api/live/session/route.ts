import { env } from "@/lib/env";
import { logError } from "@/lib/errorlog";
import { japanNow } from "@/lib/hours";
import { error, json, rateLimited, readJson } from "@/lib/http";
import { FIELD_LABEL, normalizeDraft } from "@/lib/intake";
import { getKnowledge } from "@/lib/knowledge";
import { createLiveSession } from "@/lib/openai";
import { LIVE_BACKEND_TOOLS, LIVE_GREETING, buildLiveBackendInstructions, buildLiveInstructions } from "@/lib/prompts";
import { getSettings } from "@/lib/store";
import type { IntakeDraft } from "@/lib/types";
import { truncate } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Body {
  /** ブラウザの WebRTC の接続の申し込み */
  sdp?: string;
  /** それまでの会話（文字の相談を含む）。声を始めたときに AI に渡し、聞き直さずに続ける */
  history?: { role?: string; content?: string }[];
  /** 見積依頼のために伺い済みの内容 */
  draft?: Partial<IntakeDraft>;
}

/** GPT-Live に渡す会話の長さ（startup の input は 128 件・8,192 トークンまで。日本語なので短めに） */
const HISTORY_MESSAGES = 16;
const HISTORY_CHARS = 300;

/** 声を続きから始めるときの指示（あいさつし直さない） */
const CONTINUE_GREETING =
  "お客様が声での相談に切り替えたところです（それまでの会話は文字で続いていた場合もあります）。あいさつし直さず、「はい、声でどうぞ。続きを伺います。」のように一言だけ伝えて、お客様のお話を待ってください。前の回答はくり返さないでください。";

/**
 * GPT-Live の声のセッションを作る（POST /v1/live/sessions）。ブラウザの接続の申し込み（sdp）を受け取り、答えの sdp を返す。
 * 指示・会話・委任先（Responses）の設定はサーバーで決める（ブラウザから変えられない）
 */
export async function POST(req: Request) {
  const limited = rateLimited(req, "live", 10);
  if (limited) return limited;
  if (!env.hasOpenAI) return error("OPENAI_API_KEY が未設定です", 503);
  const body = await readJson<Body>(req);
  const sdp = typeof body?.sdp === "string" ? body.sdp : "";
  if (!sdp.trim() || sdp.length > 60_000) return error("接続の申し込み（sdp）が必要です");
  const prior = (Array.isArray(body?.history) ? body.history : [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-HISTORY_MESSAGES)
    .map((m) => ({
      type: "message" as const,
      role: m.role as "user" | "assistant",
      content: [{ type: m.role === "user" ? ("input_text" as const) : ("output_text" as const), text: truncate(String(m.content).replace(/\s+/g, " "), HISTORY_CHARS) }],
    }));
  const draft = normalizeDraft(body?.draft ?? {});
  const known = [
    draft.name ? `${FIELD_LABEL.name}：${draft.name}` : "",
    draft.address ? `${FIELD_LABEL.address}：${draft.address}` : "",
    draft.phone ? `${FIELD_LABEL.phone}：${draft.phone}` : "",
    draft.dates.length ? `${FIELD_LABEL.dates}：${draft.dates.join("、")}` : "",
  ].filter(Boolean);
  const greeting = prior.length ? CONTINUE_GREETING : LIVE_GREETING;
  const developer = [
    greeting,
    known.length ? `見積依頼のために以前に伺った内容（同じことは聞き直さない。お客様がいま違う内容をおっしゃったら、必ずそちらに置き換え、以前の内容は使わない）：${known.join("／")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    // スタッフの修正点・要望（スプレッドシートの「修正点など」）も指示に入れる（読めなければ入れずに続ける）
    const [settings, snapshot] = await Promise.all([getSettings(), getKnowledge().catch(() => null)]);
    const today = japanNow().display;
    const notes = snapshot?.staffNotes?.text;
    const result = await createLiveSession({
      sdp,
      instructions: buildLiveInstructions(settings.companyName, today, notes),
      backendInstructions: buildLiveBackendInstructions(settings.companyName, today, notes),
      tools: LIVE_BACKEND_TOOLS,
      // 会話の続き → 最後に「どう話し始めるか」の指示（developer）
      input: [...prior, { type: "message", role: "developer", content: [{ type: "input_text", text: developer }] }],
    });
    return json({ ok: true, session: result.session, transport: result.transport, greeting });
  } catch (e) {
    await logError("realtime", "声の相談の接続（GPT-Live のセッション）", e);
    return error(`GPT-Live の接続に失敗しました：${(e as Error).message.slice(0, 200)}`, 502);
  }
}
