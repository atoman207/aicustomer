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
  /** 折り返しをご提案した（handoffOffered）・折り返しの受付にした（handoff） */
  o?: string;
  h?: string;
  /** 最後に保存した時刻（サーバーの保存と Cookie のどちらが新しいかを比べる） */
  u?: string;
  /** 答えを作っている途中のお客様の発言と、「少々お待ちください」を伝えた回数（AI の答えに時間がかかっているとき。twilio/gather） */
  p?: string;
  w?: number;
  /** この通話で担当者へつないだが出なかった（つなぎ直さない）・続けて起きた問題の回数 */
  k?: string;
  z?: string;
}

/** Cookie に入れる会話：短い会話はすべて、長い会話は最初のご相談（あいさつのあとの 2 件）と直近の 6 件 */
function cookieMessages(messages: AgentSession["messages"], tail: number): [string, string][] {
  const keep = messages.length <= 2 + tail ? messages : [...messages.slice(1, 3), ...messages.slice(-tail)];
  return keep.map((m) => [m.role === "user" ? "u" : "a", m.content.slice(0, 140)]);
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b + "=".repeat((4 - (b.length % 4)) % 4), "base64");
}

/** Twilio Cookie 用に圧縮（4KB 制限に収まるよう、最初のご相談と直近の会話のみ保持） */
export function encodeCallCookie(s: AgentSession): string {
  const holds = Number(s.meta?.holds ?? 0);
  const compact: CompactSession = {
    v: 1,
    i: s.id,
    c: s.channel,
    s: s.stage,
    f: s.fallbackStep,
    d: { ...s.draft, summary: s.draft.summary?.slice(0, 160) },
    e: s.estimateId,
    m: cookieMessages(s.messages, 6),
    t: s.createdAt,
    n: s.meta?.callerNumber,
    x: s.emptyTurns,
    o: s.meta?.handoffOffered || undefined,
    h: s.meta?.handoff || undefined,
    u: s.updatedAt,
    p: s.meta?.pendingSpeech ? s.meta.pendingSpeech.slice(0, 300) : undefined,
    w: holds > 0 ? holds : undefined,
    k: s.meta?.staffUnanswered || undefined,
    z: s.meta?.turnErrors || undefined,
  };
  const pack = () => b64url(deflateRawSync(Buffer.from(JSON.stringify(compact), "utf8")));
  let payload = pack();
  if (payload.length > 3800) {
    compact.m = cookieMessages(s.messages, 4);
    payload = pack();
  }
  if (payload.length > 3800) {
    compact.m = compact.m.slice(-3);
    payload = pack();
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
      updatedAt: c.u || now,
      estimateId: c.e,
      emptyTurns: typeof c.x === "number" ? c.x : 0,
      fallbackStep: c.f,
      meta: {
        callerNumber: c.n ?? "",
        restoredFrom: "cookie",
        ...(c.o ? { handoffOffered: c.o } : {}),
        ...(c.h ? { handoff: c.h } : {}),
        ...(c.p ? { pendingSpeech: c.p } : {}),
        ...(typeof c.w === "number" && c.w > 0 ? { holds: String(c.w) } : {}),
        ...(c.k ? { staffUnanswered: c.k } : {}),
        ...(c.z ? { turnErrors: c.z } : {}),
      },
    };
  } catch {
    return null;
  }
}

export const CALL_COOKIE = "aic_call";

export function callCookieHeader(s: AgentSession): string {
  return `${CALL_COOKIE}=${encodeCallCookie(s)}; Path=/; Max-Age=7200; HttpOnly`;
}
