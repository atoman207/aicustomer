import { createSession, greetingFor } from "@/lib/agent";
import { env } from "@/lib/env";
import { describeBusinessHours, japanNow, resolvePhoneRouting } from "@/lib/hours";
import { error, json, rateLimited, readJson } from "@/lib/http";
import { sanitizeDraft } from "@/lib/intake";
import { getSettings, saveSession } from "@/lib/store";
import type { Channel, ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHANNELS: Channel[] = ["phone", "web_voice", "web_text", "line"];

/** ブラウザ電話シミュレーター／音声フォールバック用のセッション開始 */
export async function POST(req: Request) {
  const limited = rateLimited(req, "agent-start", 20);
  if (limited) return limited;
  const body = await readJson<{ channel?: Channel; sessionId?: string; meta?: Record<string, string>; history?: ChatMessage[]; draft?: unknown }>(req);
  const channel = CHANNELS.includes(body?.channel as Channel) ? (body?.channel as Channel) : "phone";
  const meta: Record<string, string> = {};
  if (body?.meta && typeof body.meta === "object") {
    for (const [k, v] of Object.entries(body.meta).slice(0, 10)) meta[String(k).slice(0, 40)] = String(v).slice(0, 200);
  }
  const settings = await getSettings();
  const routing = resolvePhoneRouting(settings.phone);
  meta.routing = routing.reason;
  meta.simulated = "true";

  const session = await createSession(channel, body?.sessionId ? String(body.sessionId).slice(0, 80) : undefined, meta);
  // 接続が切れたあとの再開・文字の相談からの切り替え：それまでの会話を引き継いで続きから
  const history = (Array.isArray(body?.history) ? body.history : [])
    .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1500), at: m.at }));
  session.messages.push(...history);
  // HP の相談：文字の相談などで伺い済みのお名前・ご連絡先・ご希望日時は聞き直さない
  if (body?.draft && (channel === "web_voice" || channel === "web_text")) session.draft = sanitizeDraft(body.draft);
  const greeting = history.length ? "お待たせしました。先ほどのご相談の続きから伺います。どうぞお話しください。" : await greetingFor(channel);
  session.messages.push({ role: "assistant", content: greeting, at: new Date().toISOString() });
  await saveSession(session);
  if (!session.id) return error("セッションの作成に失敗しました", 500);

  return json({
    ok: true,
    sessionId: session.id,
    session,
    greeting,
    mode: env.hasOpenAI ? "openai" : "demo",
    routing,
    now: japanNow().display,
    settings: {
      companyName: settings.companyName,
      companyPhone: settings.companyPhone,
      forwardNumber: settings.phone.forwardNumber,
      mode: settings.phone.mode,
      hoursLabel: describeBusinessHours(settings.phone),
    },
  });
}
