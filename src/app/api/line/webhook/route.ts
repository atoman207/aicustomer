import { createSession, greetingFor, runTurn } from "@/lib/agent";
import { env } from "@/lib/env";
import { json } from "@/lib/http";
import { lineReply, textMessage, verifyLineSignature, type LineEvent } from "@/lib/line";
import { deleteSession, getSession } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CONSULT_QUICK = ["見積を依頼したい", "料金の目安を知りたい", "対応エリアを知りたい"];
const CONFIRM_QUICK = ["はい、この内容で", "お名前を修正", "ご住所を修正", "お電話番号を修正", "希望日を修正", "相談内容を修正"];

async function handleEvent(ev: LineEvent): Promise<void> {
  const userId = ev.source?.userId ?? "anonymous";
  const sid = `line_${userId}`;
  if (!ev.replyToken) return;

  if (ev.type === "follow") {
    await deleteSession(sid);
    await createSession("line", sid, { userId });
    await lineReply(ev.replyToken, [textMessage(await greetingFor("line"), CONSULT_QUICK)]);
    return;
  }

  let text = "";
  if (ev.type === "message" && ev.message?.type === "text") text = ev.message.text ?? "";
  else if (ev.type === "postback") text = ev.postback?.data ?? "";
  else if (ev.type === "message") text = "";
  if (!text.trim()) {
    if (ev.type === "message") {
      await lineReply(ev.replyToken, [textMessage("恐れ入ります、テキストでご用件をお送りください。", CONSULT_QUICK)]);
    }
    return;
  }

  const session = (await getSession(sid)) ?? (await createSession("line", sid, { userId }));
  const { result } = await runTurn(session, text);
  const quick = result.stage === "confirming" ? CONFIRM_QUICK : result.stage === "consult" ? CONSULT_QUICK : undefined;
  await lineReply(ev.replyToken, [textMessage(result.reply, quick)]);
  if (result.stage === "completed") await deleteSession(sid); // 次回のご相談は新規セッションで
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!env.hasLine) return json({ ok: false, reason: "LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN が未設定です" });
  if (!verifyLineSignature(raw, req.headers.get("x-line-signature"))) {
    return new Response("invalid signature", { status: 401 });
  }
  let body: { events?: LineEvent[] };
  try {
    body = JSON.parse(raw) as { events?: LineEvent[] };
  } catch {
    return new Response("bad request", { status: 400 });
  }
  const events = Array.isArray(body.events) ? body.events : [];
  await Promise.all(
    events.map((ev) =>
      handleEvent(ev).catch((e) => {
        console.error("[line webhook]", (e as Error).message);
      }),
    ),
  );
  return json({ ok: true });
}

export async function GET() {
  return json({ ok: true, configured: env.hasLine, message: "LINE Messaging API webhook endpoint" });
}
