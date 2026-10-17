import { createSession, greetingFor } from "@/lib/agent";
import { env } from "@/lib/env";
import { describeBusinessHours, japanNow, resolvePhoneRouting } from "@/lib/hours";
import { error, json, readJson } from "@/lib/http";
import { getSettings, saveSession } from "@/lib/store";
import type { Channel } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNELS: Channel[] = ["phone", "web_voice", "web_text", "line"];

/** ブラウザ電話シミュレーター／音声フォールバック用のセッション開始 */
export async function POST(req: Request) {
  const body = await readJson<{ channel?: Channel; sessionId?: string; meta?: Record<string, string> }>(req);
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
  const greeting = await greetingFor(channel);
  session.messages.push({ role: "assistant", content: greeting, at: new Date().toISOString() });
  await saveSession(session);
  if (!session.id) return error("セッションの作成に失敗しました", 500);

  return json({
    ok: true,
    sessionId: session.id,
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
