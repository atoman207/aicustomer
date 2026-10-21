import { isAdminAuthenticated } from "@/lib/auth";
import { getBaseUrl, json } from "@/lib/http";
import { getIntegrationStatus } from "@/lib/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const admin = await isAdminAuthenticated();
  const url = new URL(req.url);
  // 接続の確認（OpenAI への問い合わせ）は管理者だけ
  const check = admin && url.searchParams.get("check") === "1";
  const status = await getIntegrationStatus(getBaseUrl(req), check);
  if (admin) return json({ ok: true, ...status });
  // 管理者以外には、動いているかどうかだけを返す（シートの ID・サービスアカウント・Webhook・エラーの内容は出さない）
  return json({
    ok: true,
    openai: { configured: status.openai.configured },
    knowledge: { source: status.knowledge.source, entries: status.knowledge.entries, fetchedAt: status.knowledge.fetchedAt },
    reception: { sink: status.reception.sink },
    storage: { persistent: status.storage.persistent },
    admin: { protected: status.admin.protected },
  });
}
