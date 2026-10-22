import { learnAnswer, planAnswer, type AnswerPlan, type AnswerSource } from "@/lib/answer";
import { logError } from "@/lib/errorlog";
import { error, rateLimited, readJson } from "@/lib/http";
import { sanitizeIntake } from "@/lib/intake";
import { intakeApplies, intakeTurn } from "@/lib/intake-ai";
import { env } from "@/lib/env";
import { getKnowledge } from "@/lib/knowledge";
import { canRetryWithChatModel, streamChatCompletion } from "@/lib/openai";
import { ANSWER_MARKER, buildChatSystemPrompt, splitEvidence, usesEvidence } from "@/lib/prompts";
import { getConversation, getSettings, upsertConversation } from "@/lib/store";
import { isPromptEcho } from "@/lib/transcribe";
import type { Channel, ChatMessage } from "@/lib/types";
import { truncate, uid } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Body {
  sessionId?: string;
  channel?: Channel;
  messages: ChatMessage[];
  /** 見積依頼の聞き取りの状態（ブラウザが保存して毎回送る） */
  intake?: unknown;
}

/** OpenAI に渡す会話履歴は直近の数往復だけ（長い履歴はトークンが増えるため） */
function recentHistory(messages: ChatMessage[]): { role: "user" | "assistant"; content: string }[] {
  return messages.slice(-6).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: truncate(m.content, 500) }));
}

export async function POST(req: Request) {
  const limited = rateLimited(req, "chat", 20);
  if (limited) return limited;
  const body = await readJson<Body>(req);
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) return error("messages が必要です");
  const sessionId = (body.sessionId ?? "").toString().slice(0, 80) || uid();
  const channel: Channel = body.channel === "web_voice" ? "web_voice" : "web_text";
  const messages = body.messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    // 声の相談の雑音で、文字起こしが手がかりの文をなぞっただけの行（お客様の発言ではない）は使わない
    .filter((m) => !(m.role === "user" && isPromptEcho(m.content)))
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000), at: m.at }));
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return error("ユーザーメッセージがありません");

  const intake = sanitizeIntake(body.intake);
  const useIntake = channel === "web_text" && intakeApplies(last.content, intake);
  const [settings, plan] = await Promise.all([getSettings(), useIntake ? null : planAnswer(last.content, messages.slice(0, -1), { channel })]);

  const headers = (sources: AnswerSource[], knowledgeSource: string, kind: string, mode: string): Record<string, string> => ({
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Sources": encodeURIComponent(JSON.stringify(sources)),
    "X-Knowledge-Source": knowledgeSource,
    "X-Answer-Kind": kind,
    "X-Mode": mode,
  });

  const persist = async (reply: string, mode: string, knowledgeSource: string, answer: string) => {
    try {
      const now = new Date().toISOString();
      const existing = await getConversation(sessionId);
      // ブラウザからは直近 20 件だけ届くため、保存済みの会話（声の相談からの続きを含む）に今回の質問と回答を足す
      const prior = existing?.messages ?? [];
      const base = prior.length >= messages.length - 1 ? prior : messages.slice(0, -1);
      const channels = new Set([...(existing?.meta?.channels ?? existing?.channel ?? "").split(",").filter(Boolean), channel]);
      await upsertConversation({
        id: sessionId,
        channel,
        startedAt: existing?.startedAt ?? now,
        updatedAt: now,
        messages: [...base, last, { role: "assistant", content: reply, at: now }],
        estimateId: existing?.estimateId,
        // 管理画面の「AIに質問（テスト）」の会話は test として記録
        meta: {
          ...(existing?.meta ?? {}),
          mode,
          knowledgeSource,
          answer,
          channels: [...channels].join(","),
          ...(sessionId.startsWith("admintest-") ? { test: "1" } : {}),
        },
      });
    } catch {
      // ログ保存失敗は応答に影響させない
    }
  };

  // 見積依頼の聞き取り（お名前・ご住所・お電話番号・ご希望日時を伺い、そろったら確認画面へ）。状態は X-Intake で返す
  if (useIntake || !plan) {
    const [turn, snapshot] = await Promise.all([intakeTurn(messages, intake, { company: settings.companyName }), getKnowledge()]);
    await persist(turn.reply, `intake-${turn.mode}`, snapshot.source, "intake");
    return new Response(turn.reply, {
      headers: { ...headers(turn.sources, snapshot.source, "intake", "intake"), "X-Intake": encodeURIComponent(JSON.stringify(turn.state)) },
    });
  }
  const planHeaders = (p: AnswerPlan, mode: string) => headers(p.sources, p.snapshot.source, p.kind, mode);

  // OpenAI を使わずに答えられる質問（料金表・会社情報・学習済み・定型文・該当なし・デモ）
  if (plan.mode !== "openai") {
    await persist(plan.reply, plan.mode, plan.snapshot.source, plan.kind);
    return new Response(plan.reply, { headers: planHeaders(plan, plan.mode) });
  }

  try {
    const system = buildChatSystemPrompt(settings.companyName, plan.context, channel);
    // 資料の全文で答えるとき：先に資料から根拠を引用させ（お客様には送らない）、回答だけを送る
    const evidence = usesEvidence(plan.context);
    const hide = evidence
      ? { until: ANSWER_MARKER, onMissing: (all: string) => splitEvidence(all).answer || "申し訳ありません、ただいま回答をまとめられませんでした。もう一度お送りいただくか、お電話（0120-158-108）でお問い合わせください。" }
      : undefined;
    const start = (model: string) =>
      streamChatCompletion(
        {
          model,
          // 回答のモデルが推論するモデル（gpt-5 系）なら、考える深さは設定のとおり（既定 none＝すぐ答える）
          reasoningEffort: model === env.answerModel ? env.answerReasoning : undefined,
          messages: [{ role: "system", content: system }, ...recentHistory(messages)],
          temperature: 0.3,
          maxTokens: evidence ? 1200 : 600,
          purpose: "chat",
        },
        async (full) => {
          await persist(full, "openai", plan.snapshot.source, plan.kind);
          await learnAnswer(plan, full);
        },
        hide,
      );
    const model = plan.fullContext ? env.answerModel : env.chatModel;
    let stream: ReadableStream<Uint8Array>;
    try {
      stream = await start(model);
    } catch (e) {
      // 混み合っている・一時的な障害・この API キーでは使えないモデル：いつものモデルで答え直す
      if (model === env.chatModel || !canRetryWithChatModel(e)) throw e;
      await logError("openai", `文字の相談（${model} が使えないため ${env.chatModel} で回答）`, e);
      stream = await start(env.chatModel);
    }
    return new Response(stream, { headers: planHeaders(plan, "openai") });
  } catch (e) {
    // エラーの内容は管理画面の「エラー履歴」に記録し、お客様には登録済みの情報からご案内する
    await logError("openai", "文字の相談（AIの回答）", e);
    const top = plan.hits[0];
    const reply = top
      ? `「${top.entry.title.replace(/^.*｜/, "")}」についてご案内します。\n${truncate(top.entry.content, 800)}`
      : "申し訳ありません、ただいま回答の準備に時間がかかっています。少し時間をおいてもう一度お試しいただくか、お電話（0120-158-108）でお問い合わせください。";
    await persist(reply, "demo-error", plan.snapshot.source, plan.kind);
    return new Response(reply, { headers: planHeaders(plan, "demo-error") });
  }
}
