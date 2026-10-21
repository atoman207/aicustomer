import { json, requireAdmin } from "@/lib/http";
import { describeKnowledge, getKnowledge } from "@/lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** ナレッジの一覧と情報源ごとの件数（管理画面専用）。回答の情報源は Googleスプレッドシートとホームページだけ（管理画面からの追加はなし） */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return json(describeKnowledge(await getKnowledge()));
}
