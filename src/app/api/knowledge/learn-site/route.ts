import { error, requireAdmin } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ホームページ（ichijoya.co.jp）の再学習。回答の根拠は指定のスプレッドシートだけにしたため（一畳屋様のご要望 2026-10-22・10-23）、
 * ホームページは読み込まない
 */
export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return error("ホームページは回答に使わないため、再学習はできません（回答の根拠は指定のスプレッドシートだけです）。", 410);
}
