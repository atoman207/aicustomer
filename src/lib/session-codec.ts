// セッションのステートレス化：
//  - ブラウザ（電話シミュレーター／音声フォールバック）はセッション全体を往復させる
//  - Twilio は通話ごとの Cookie に圧縮したセッションを持たせる（Twilio は Webhook 間で Cookie を保持する）
// これにより、Redis 未設定のサーバーレス環境でも会話状態が途切れません。
import { deflateRawSync, inflateRawSync } from "zlib";
import type { AgentSession, AgentStage, Channel, ChatMessage, IntakeDraft } from "./types";

const CHANNELS: Channel[] = ["web_text", "web_voice", "phone", "line"];
const STAGES: AgentStage[] = ["consult", "collecting", "confirming", "completed"];

function str(v: unknown, max: number): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
}

function sanitizeDraft(v: unknown): IntakeDraft {
  const d = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    name: str(d.name, 80),
    address: str(d.address, 200),
    phone: str(d.phone, 40),
    dates: Array.isArray(d.dates) ? d.dates.map((x) => String(x).slice(0, 60)).filter(Boolean).slice(0, 3) : [],
    summary: str(d.summary, 400),
  };
}

function sanitizeMessages(v: unknown, max: number, maxLen: number): ChatMessage[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((m) => m && typeof m === "object" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-max)
    .map((m) => ({ role: m.role as ChatMessage["role"], content: String(m.content).slice(0, maxLen), at: typeof m.at === "string" ? m.at : undefined }));
}

/** クライアントから受け取ったセッションを検証・正規化 */
export function sanitizeSession(input: unknown, expectId?: string): AgentSession | null {
  if (!input || typeof input !== "object") return null;
  const s = input as Record<string, unknown>;
  const id = str(s.id, 80);
  if (!id || (expectId && id !== expectId)) return null;
  const channel = CHANNELS.includes(s.channel as Channel) ? (s.channel as Channel) : "web_voice";
  const stage = STAGES.includes(s.stage as AgentStage) ? (s.stage as AgentStage) : "consult";
  const now = new Date().toISOString();
  const meta: Record<string, string> = {};
  if (s.meta && typeof s.meta === "object") {
    for (const [k, v] of Object.entries(s.meta as Record<string, unknown>).slice(0, 12)) meta[k.slice(0, 40)] = String(v).slice(0, 200);
  }
  return {
    id,
    channel,
    stage,
    draft: sanitizeDraft(s.draft),
    messages: sanitizeMessages(s.messages, 60, 3000),
    createdAt: str(s.createdAt, 40) ?? now,
    updatedAt: now,
    estimateId: str(s.estimateId, 40),
    emptyTurns: typeof s.emptyTurns === "number" ? Math.max(0, Math.min(5, s.emptyTurns)) : 0,
    fallbackStep: str(s.fallbackStep, 20),
    meta,
  };
}

interface CompactSession {
  v: 1;
  i: string;
  c: Channel;
  s: AgentStage;
  f?: string;
  d: IntakeDraft;
  e?: string;
  m: [string, string][];
  t: string;
  n?: string;
  x: number;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b + "=".repeat((4 - (b.length % 4)) % 4), "base64");
}

/** Twilio Cookie 用に圧縮（4KB 制限に収まるよう直近の会話のみ保持） */
export function encodeCallCookie(s: AgentSession): string {
  const compact: CompactSession = {
    v: 1,
    i: s.id,
    c: s.channel,
    s: s.stage,
    f: s.fallbackStep,
    d: { ...s.draft, summary: s.draft.summary?.slice(0, 160) },
    e: s.estimateId,
    m: s.messages.slice(-6).map((m) => [m.role === "user" ? "u" : "a", m.content.slice(0, 140)]),
    t: s.createdAt,
    n: s.meta?.callerNumber,
    x: s.emptyTurns,
  };
  let payload = b64url(deflateRawSync(Buffer.from(JSON.stringify(compact), "utf8")));
  if (payload.length > 3800) {
    compact.m = compact.m.slice(-3);
    payload = b64url(deflateRawSync(Buffer.from(JSON.stringify(compact), "utf8")));
  }
  return payload;
}

export function decodeCallCookie(value: string | null, expectId: string): AgentSession | null {
  if (!value) return null;
  try {
    const c = JSON.parse(inflateRawSync(fromB64url(value)).toString("utf8")) as CompactSession;
    if (c.v !== 1 || c.i !== expectId) return null;
    const now = new Date().toISOString();
    return {
      id: c.i,
      channel: CHANNELS.includes(c.c) ? c.c : "phone",
      stage: STAGES.includes(c.s) ? c.s : "consult",
      draft: sanitizeDraft(c.d),
      messages: (c.m ?? []).map(([r, text]) => ({ role: r === "u" ? "user" : "assistant", content: text })),
      createdAt: c.t || now,
      updatedAt: now,
      estimateId: c.e,
      emptyTurns: typeof c.x === "number" ? c.x : 0,
      fallbackStep: c.f,
      meta: { callerNumber: c.n ?? "", restoredFrom: "cookie" },
    };
  } catch {
    return null;
  }
}

export const CALL_COOKIE = "aic_call";

export function callCookieHeader(s: AgentSession): string {
  return `${CALL_COOKIE}=${encodeCallCookie(s)}; Path=/; Max-Age=7200; HttpOnly`;
}
