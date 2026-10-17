// 電話・LINE・音声フォールバックで共通利用する会話エージェント
import { env } from "./env";
import { createEstimate } from "./estimates";
import { fallbackTurn } from "./fallback";
import { japanNow } from "./hours";
import { getKnowledge, knowledgeToPromptText } from "./knowledge";
import { chatCompletionJson } from "./openai";
import { AGENT_JSON_SCHEMA, buildAgentSystemPrompt } from "./prompts";
import { hybridSearch } from "./retrieval";
import { getSession, getSettings, saveSession, upsertConversation } from "./store";
import type { AgentSession, AgentStage, AgentTurnResult, Channel, IntakeDraft, KnowledgeEntry } from "./types";
import { fillTemplate, truncate, uid } from "./utils";

interface ModelTurn {
  reply: string;
  stage: AgentStage;
  draft: { name: string | null; address: string | null; phone: string | null; dates: string[]; summary: string | null };
  customer_confirmed: boolean;
  end_call: boolean;
}

export async function createSession(channel: Channel, id?: string, meta?: Record<string, string>): Promise<AgentSession> {
  const now = new Date().toISOString();
  const session: AgentSession = {
    id: id ?? uid(),
    channel,
    stage: "consult",
    draft: { dates: [] },
    messages: [],
    createdAt: now,
    updatedAt: now,
    emptyTurns: 0,
    meta,
  };
  await saveSession(session);
  return session;
}

export async function getOrCreateSession(id: string, channel: Channel, meta?: Record<string, string>): Promise<AgentSession> {
  return (await getSession(id)) ?? createSession(channel, id, meta);
}

export async function greetingFor(channel: Channel): Promise<string> {
  const settings = await getSettings();
  const company = settings.companyName;
  if (channel === "phone") return fillTemplate(settings.greeting, { company });
  if (channel === "line")
    return `${company}の公式LINEにご登録ありがとうございます。\n畳・襖・障子・網戸・リフォームのご相談や、お見積りのご依頼を承ります。ご用件をメッセージでお送りください。`;
  return `こんにちは。${company}のAI相談員です。畳・襖・障子・網戸・リフォームについて、お気軽にご質問ください。お見積りのご依頼も承ります。`;
}

function draftComplete(d: IntakeDraft): boolean {
  return Boolean(d.name && d.address && d.phone && d.dates.length > 0);
}

function missingPrompt(d: IntakeDraft): string {
  if (!d.name) return "恐れ入ります、お名前をフルネームでお聞かせください。";
  if (!d.address) return "恐れ入ります、ご住所を市区町村から番地までお聞かせください。";
  if (!d.phone) return "恐れ入ります、折り返しご連絡できるお電話番号をお聞かせください。";
  return "恐れ入ります、訪問のご希望日時を、日にちと午前・午後でお聞かせください。";
}

function summaryFromMessages(session: AgentSession): string {
  const texts = session.messages.filter((m) => m.role === "user").map((m) => m.content.trim());
  return truncate(texts.join(" ／ "), 220) || "（会話から抽出できませんでした）";
}

async function openaiTurn(
  session: AgentSession,
  text: string,
  company: string,
  entries: KnowledgeEntry[],
): Promise<AgentTurnResult> {
  const search = await hybridSearch(text, entries, 4);
  const now = japanNow();
  let system = buildAgentSystemPrompt(company, knowledgeToPromptText(entries, 12000), session.channel, now.display);
  if (search.hits.length > 0) {
    system += `\n\n# 直近の発話に関連するナレッジ（優先して参照）\n${search.hits
      .map((h) => `- ${h.entry.title}: ${h.entry.content}`)
      .join("\n")}`;
  }
  system += `\n\n# 現在の受付状態\nstage=${session.stage}\ndraft=${JSON.stringify(session.draft)}`;
  if (session.meta?.callerNumber) {
    system += `\n発信者番号: ${session.meta.callerNumber}（お電話番号を伺う際は、この番号へ折り返してよいかを確認するだけで構いません。同意されたら draft.phone にこの番号を入れてください）`;
  }
  const history = session.messages.slice(-20).map((m) => ({ role: m.role, content: m.content }));
  const out = await chatCompletionJson<ModelTurn>({
    messages: [{ role: "system", content: system }, ...history],
    jsonSchema: AGENT_JSON_SCHEMA,
    temperature: 0.3,
    maxTokens: 700,
  });
  const draft: IntakeDraft = {
    name: out.draft.name?.trim() || undefined,
    address: out.draft.address?.trim() || undefined,
    phone: out.draft.phone?.trim() || undefined,
    dates: (out.draft.dates ?? []).map((d) => d.trim()).filter(Boolean).slice(0, 3),
    summary: out.draft.summary?.trim() || session.draft.summary,
  };
  let stage: AgentStage = out.stage;
  if (out.stage === "completed" && !out.customer_confirmed) stage = "confirming";
  return { reply: out.reply.trim(), stage, draft, done: out.end_call, mode: "openai", sources: search.hits };
}

/** 1ターン処理：ユーザー発話 → 応答。受付完了時はスプレッドシート等へ記録 */
export async function runTurn(
  session: AgentSession,
  userText: string,
): Promise<{ result: AgentTurnResult; session: AgentSession }> {
  const text = userText.trim();
  const [settings, snapshot] = await Promise.all([getSettings(), getKnowledge()]);
  const at = new Date().toISOString();
  session.messages.push({ role: "user", content: text, at });

  let result: AgentTurnResult;
  if (env.hasOpenAI) {
    try {
      result = await openaiTurn(session, text, settings.companyName, snapshot.entries);
    } catch (e) {
      session.meta = { ...(session.meta ?? {}), lastError: truncate((e as Error).message, 200) };
      result = fallbackTurn(session, text, snapshot.entries);
    }
  } else {
    result = fallbackTurn(session, text, snapshot.entries);
  }

  if (result.stage === "completed" && !session.estimateId) {
    if (draftComplete(result.draft)) {
      const estimate = await createEstimate({
        channel: session.channel,
        name: result.draft.name ?? "",
        address: result.draft.address ?? "",
        phone: result.draft.phone ?? "",
        summary: result.draft.summary || summaryFromMessages(session),
        preferredDates: result.draft.dates,
        sessionId: session.id,
        confirmedByCustomer: true,
      });
      session.estimateId = estimate.id;
      result.estimate = estimate;
      if (session.channel !== "phone") result.reply = `${result.reply}\n受付番号：${estimate.id}`;
    } else {
      result.stage = "collecting";
      result.reply = missingPrompt(result.draft);
      result.done = false;
    }
  }

  session.stage = result.stage;
  session.draft = result.draft;
  session.messages.push({ role: "assistant", content: result.reply, at: new Date().toISOString() });
  if (session.messages.length > 60) session.messages = session.messages.slice(-60);
  session.updatedAt = new Date().toISOString();
  await saveSession(session);
  await upsertConversation({
    id: session.id,
    channel: session.channel,
    startedAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: session.messages,
    estimateId: session.estimateId,
    meta: { ...(session.meta ?? {}), mode: result.mode, stage: session.stage },
  });
  return { result, session };
}
