import { error, json, rateLimited, readJson } from "@/lib/http";
import { missingFields, sanitizeDraft } from "@/lib/intake";
import { readDraft } from "@/lib/intake-ai";
import type { ChatMessage } from "@/lib/types";
import { headTail } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 確認画面を開くときに、会話からお名前・ご住所・お電話番号・ご希望日時・ご相談内容（AIの要約）を読み取る（文字・声の相談で共通）。
 * draft はこれまでに伺った内容（会話に訂正がなければそのまま返る）。keepSummary はお客様が書き直したご相談内容を残す。
 */
export async function POST(req: Request) {
  const limited = rateLimited(req, "estimate-draft", 20);
  if (limited) return limited;
  const body = await readJson<{ messages?: ChatMessage[]; draft?: unknown; keepSummary?: boolean }>(req);
  if (!body || !Array.isArray(body.messages)) return error("messages が必要です");
  // 長い会話も、最初のご相談（要約の中心）と最後の聞き取り・訂正の両方を読む
  const messages = headTail(body.messages.filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim())).map((m) => ({
    role: m.role,
    content: m.content.slice(0, 2000),
  }));
  const r = await readDraft(messages, sanitizeDraft(body.draft), { keepSummary: body.keepSummary === true });
  return json({ ok: true, draft: r.draft, missing: missingFields(r.draft), mode: r.mode, unsure: r.unsure ?? [] });
}
