import { answerModelFor, learnAnswer, learnedKeyFor, learnedReply, learnedSources, planAnswer, type AnswerPlan, type AnswerSource } from "@/lib/answer";
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
import { headTail, truncate, uid } from "@/lib/utils";

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
  // 見積依頼の聞き取り（ご相談内容の要約）は、最初のご相談から読む。回答は直近 20 件
  const conversation = headTail(
    body.messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      // 声の相談の雑音で、文字起こしが手がかりの文をなぞっただけの行（お客様の発言ではない）は使わない
      .filter((m) => !(m.role === "user" && isPromptEcho(m.content))),
  ).map((m) => ({ role: m.role, content: m.content.slice(0, 4000), at: m.at }));
  const messages = conversation.slice(-20);
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return error("ユーザーメッセージがありません");

  const intake = sanitizeIntake(body.intake);
  // 直前の AI の発言（「よろしければ、ご都合のよい日にお伺いしましょうか？」への「お願いします」で、見積依頼の聞き取りを始める）
  const prevAi = [...messages.slice(0, -1)].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const useIntake = channel === "web_text" && intakeApplies(last.content, intake, prevAi);
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
    const [turn, snapshot] = await Promise.all([intakeTurn(conversation, intake, { company: settings.companyName }), getKnowledge()]);
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
    const system = buildChatSystemPrompt(settings.companyName, plan.context, channel, plan.snapshot.staffNotes?.text);
    const history = recentHistory(messages);
    const { model, effort } = answerModelFor(plan);
    // 同じ質問（AI に渡す内容とお客様の質問がまったく同じ）には、前に AI が作った回答をそのまま返す（AI を使わない）。
    // 見積依頼でお名前・ご連絡先を伺っている会話は、その人だけの会話なので使わない
    const personal = intake.active || Boolean(intake.draft.name || intake.draft.phone || intake.draft.address);
    const key = personal ? null : learnedKeyFor(plan, { model, effort, system }, history);
    const learned = await learnedReply(plan, key);
    if (learned) {
      await persist(learned.answer, "cache", plan.snapshot.source, "learned");
      return new Response(learned.answer, { headers: headers(learnedSources(learned), plan.snapshot.source, "learned", "cache") });
    }
    // 資料の全文で答えるとき：先に資料から根拠を引用させ（お客様には送らない）、回答だけを送る
    const evidence = usesEvidence(plan.context);
    const hide = evidence
      ? { until: ANSWER_MARKER, onMissing: (all: string) => splitEvidence(all).answer || "申し訳ありません、ただいま回答をまとめられませんでした。もう一度お送りいただくか、お電話（0120-158-108）でお問い合わせください。" }
      : undefined;
    const start = (m: string) =>
      streamChatCompletion(
        {
          model: m,
          // 回答のモデルは設定の考える深さ（既定 low）。答え直しのモデル（gpt-5.6-sol）は考えずにすぐ答える
          reasoningEffort: m === model ? effort : m === env.answerFallbackModel ? "none" : undefined,
          messages: [{ role: "system", content: system }, ...history],
          temperature: 0.3,
          // 料金の一覧なども省略せずに答えられる長さ（根拠の引用の分も）
          maxTokens: evidence ? 3000 : 2000,
          purpose: "chat",
        },
        async (full, _usage, _hidden, finish) => {
          await persist(full, "openai", plan.snapshot.source, plan.kind);
          // 学習するのは、回答のモデルで最後まで書けた回答だけ（答え直しのモデル・途中で切れた回答は、次回は作り直す）
          await learnAnswer(plan, full, m === model && finish === "stop" ? key : null);
        },
        hide,
      );
    let stream: ReadableStream<Uint8Array>;
    try {
      stream = await start(model);
    } catch (e) {
      // 混み合っている・一時的な障害・この API キーでは使えないモデル：答え直しのモデルで答える（理由は管理画面のエラー履歴に）
      const backup = plan.fullContext ? env.answerFallbackModel : null;
      if (!backup || backup === model || !canRetryWithChatModel(e)) throw e;
      await logError("openai", `文字の相談（${model} が使えないため ${backup} で回答）`, e);
      stream = await start(backup);
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
