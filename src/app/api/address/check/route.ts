import { checkAddress } from "@/lib/gazetteer";
import { error, json, rateLimited, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 声の相談の check_address（ご住所の町名の確認）。熊本県・大牟田市の町名の一覧（漢字と読み方）にあるかを返し、
 * なければ、その市区町村の町名を読みの近い順に返す（声の AI の委任先が、お客様の発音に合う町名を選んで復唱する）。
 * 一畳屋様のご要望 2026-10-28：「玉名市岱明町（たいめいまち）」を「玉名市大名町」と聞き取ってしまう
 */
export async function POST(req: Request) {
  const limited = rateLimited(req, "address-check", 60);
  if (limited) return limited;
  const body = await readJson<{ address?: unknown; town_reading?: unknown }>(req);
  const address = typeof body?.address === "string" ? body.address.slice(0, 200) : "";
  const reading = typeof body?.town_reading === "string" ? body.town_reading.slice(0, 60) : "";
  if (!address.trim()) return error("address が必要です");
  return json({ ok: true, ...checkAddress(address, reading) });
}
