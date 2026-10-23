// お客様の相談内容をこの端末に保存する（文字・声の相談で共通。6 時間）
//   ・声の相談の接続が切れても、ページを読み直しても、続きから再開できる
//   ・声の相談 → 文字の相談（またはその逆）に切り替えても、同じ会話の続きになる（AI にもそれまでの会話を渡す）
//   ・見積依頼で伺ったお名前・ご連絡先・ご希望日時（intake）も一緒に保存し、文字・声のどちらで「見積依頼」を押しても確認画面に入る
//   ・ブラウザだけで使う（保存できない環境では何もしない）
import { sanitizeIntake, type IntakeState } from "./intake";

export type ConversationChannel = "text" | "voice";

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  at?: number;
  /** どちらの相談で話した内容か（未指定は文字） */
  channel?: ConversationChannel;
  sources?: { title: string; category: string; origin?: string }[];
  mode?: string;
  kind?: string;
}

export interface StoredConversation {
  /** 管理画面の会話ログと同じ ID（文字・声で共通） */
  id: string;
  messages: StoredMessage[];
  estimateId?: string;
  /** 見積依頼の聞き取りの状態（伺った内容の下書き） */
  intake?: IntakeState;
  savedAt: number;
}

/**
 * 保存の名前。v3（2026-10-23）：一畳屋様のご依頼で、それまでの会話（以前の仕組みの回答を含む）はすべて消して使わない
 */
const KEY = "ichijoya-ai-conversation-v3";
/** 以前の保存（読まずに消す） */
const OLD_LOCAL_KEYS = ["ichijoya-ai-conversation-v2"];
const LEGACY_KEY = "ichijoya-ai-chat-v1";
export const CONVERSATION_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_MESSAGES = 80;

/** 保存した発言の形をそろえる（id・時刻・窓口・根拠の見出しの形が違うものは直すか捨てる） */
function cleanMessage(m: StoredMessage, i: number): StoredMessage {
  const sources = Array.isArray(m.sources)
    ? m.sources.filter((s) => s && typeof s === "object" && typeof s.title === "string").map((s) => ({ title: s.title, category: typeof s.category === "string" ? s.category : "", origin: typeof s.origin === "string" ? s.origin : undefined }))
    : undefined;
  return {
    id: typeof m.id === "string" && m.id ? m.id : `restored-${i}`,
    role: m.role,
    content: m.content,
    at: typeof m.at === "number" && Number.isFinite(m.at) ? m.at : undefined,
    channel: m.channel === "voice" ? "voice" : "text",
    sources,
    mode: typeof m.mode === "string" ? m.mode : undefined,
    kind: typeof m.kind === "string" ? m.kind : undefined,
  };
}

export function loadConversation(): StoredConversation | null {
  try {
    OLD_LOCAL_KEYS.forEach((k) => localStorage.removeItem(k));
    sessionStorage.removeItem(LEGACY_KEY);
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<StoredConversation>;
    const id = typeof c.id === "string" ? c.id : "";
    if (!id || !Array.isArray(c.messages) || !c.messages.length || typeof c.savedAt !== "number" || Date.now() - c.savedAt > CONVERSATION_TTL_MS) return null;
    // 保存した内容が壊れていても表示できるように、形の合わない値は捨てる（相談の画面が表示できなくなるのを防ぐ）
    const messages = c.messages.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim()).map(cleanMessage);
    return messages.length
      ? { id, messages, estimateId: typeof c.estimateId === "string" ? c.estimateId : undefined, intake: c.intake && typeof c.intake === "object" ? sanitizeIntake(c.intake) : undefined, savedAt: c.savedAt }
      : null;
  } catch {
    return null;
  }
}

export function saveConversation(c: { id: string; messages: StoredMessage[]; estimateId?: string; intake?: IntakeState }): void {
  try {
    const messages = c.messages.filter((m) => m.content.trim()).slice(-MAX_MESSAGES);
    if (!messages.length) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify({ id: c.id, messages, estimateId: c.estimateId, intake: c.intake, savedAt: Date.now() }));
    sessionStorage.removeItem(LEGACY_KEY);
  } catch {
    // 保存できない環境（プライベートモードなど）では保存しない
  }
}

export function clearConversation(): void {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(LEGACY_KEY);
  } catch {
    // noop
  }
}

/** AI に渡す「これまでの会話」（新しいものから最大 n 件・1 件 300 字まで） */
export function transcriptForAi(messages: StoredMessage[], n = 16): string {
  return messages
    .slice(-n)
    .map((m) => `${m.role === "user" ? "お客様" : "AI"}${m.channel === "voice" ? "（声）" : "（文字）"}：${m.content.replace(/\s+/g, " ").slice(0, 300)}`)
    .join("\n");
}
