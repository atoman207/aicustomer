import { parseForm } from "@/lib/http";
import { getSession, saveSession, upsertConversation } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Twilio 通話ステータスコールバック（通話終了などを会話履歴に記録） */
export async function POST(req: Request) {
  const params = await parseForm(req);
  const callSid = params.CallSid;
  if (callSid) {
    const session = await getSession(`tw_${callSid}`);
    if (session) {
      session.meta = { ...(session.meta ?? {}), callStatus: params.CallStatus ?? "", callDuration: params.CallDuration ?? "" };
      session.updatedAt = new Date().toISOString();
      await saveSession(session);
      await upsertConversation({
        id: session.id,
        channel: "phone",
        startedAt: session.createdAt,
        updatedAt: session.updatedAt,
        messages: session.messages,
        estimateId: session.estimateId,
        meta: session.meta,
      });
    }
  }
  return new Response(null, { status: 204 });
}
