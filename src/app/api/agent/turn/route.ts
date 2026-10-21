import { runTurn } from "@/lib/agent";
import { error, json, rateLimited, readJson } from "@/lib/http";
import { sanitizeSession } from "@/lib/session-codec";
import { getSession } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 1ターン処理。セッションはサーバー側ストアを優先し、見つからない場合は
 * クライアントが往復させている session（ステートレス）から復元する。
 */
export async function POST(req: Request) {
  const limited = rateLimited(req, "agent-turn", 60);
  if (limited) return limited;
  const body = await readJson<{ sessionId?: string; text?: string; session?: unknown }>(req);
  const sessionId = (body?.sessionId ?? "").toString().slice(0, 80);
  const text = (body?.text ?? "").toString().trim().slice(0, 2000);
  if (!sessionId) return error("sessionId が必要です");
  if (!text) return error("text が必要です");
  const session = (await getSession(sessionId)) ?? sanitizeSession(body?.session, sessionId);
  if (!session) return error("セッションが見つかりません。通話を開始し直してください", 404);
  const { result, session: updated } = await runTurn(session, text);
  return json({
    ok: true,
    reply: result.reply,
    stage: result.stage,
    draft: result.draft,
    done: result.done,
    mode: result.mode,
    answeredBy: result.answeredBy ?? null,
    estimate: result.estimate ?? null,
    formReady: result.formReady === true,
    estimateId: updated.estimateId ?? null,
    sources: (result.sources ?? []).map((h) => ({ id: h.entry.id, title: h.entry.title, score: Math.round(h.score * 100) / 100 })),
    session: updated,
  });
}
