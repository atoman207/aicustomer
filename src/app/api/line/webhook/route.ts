import { createSession, greetingFor, runTurn } from "@/lib/agent";
import { BRAND } from "@/lib/brand";
import { env } from "@/lib/env";
import { logError } from "@/lib/errorlog";
import { findReceptionId, linkEstimateToLine } from "@/lib/estimates";
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

  // 受付後の LINE 引き継ぎ：受付番号が送られてきたら、その受付とこの LINE をつなぐ
  const receptionId = findReceptionId(text);
  if (receptionId && userId !== "anonymous") {
    const linked = await linkEstimateToLine(receptionId, userId);
    const reply =
      linked === "linked" || linked === "already"
        ? `受付番号 ${receptionId} のご依頼とLINEをおつなぎしました。\n担当者より折り返しご連絡し、お見積り訪問の日程を確定いたします。今後のご連絡はこちらのLINEでも承ります。`
        : linked === "other"
          ? `受付番号 ${receptionId} は、すでに別のLINEアカウントとつながっています。お心当たりがない場合は、フリーダイヤル ${BRAND.freeDial} までお問い合わせください。`
          : `受付番号「${receptionId}」が見つかりませんでした。恐れ入りますが、番号をご確認のうえ、もう一度お送りください。`;
    await lineReply(ev.replyToken, [textMessage(reply, CONSULT_QUICK)]);
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
      handleEvent(ev).catch((e) => logError("line", "LINE のメッセージ処理", e)),
    ),
  );
  return json({ ok: true });
}

export async function GET() {
  return json({ ok: true, configured: env.hasLine, message: "LINE Messaging API webhook endpoint" });
}
