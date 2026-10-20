import { describeBusinessHours, japanNow, resolvePhoneRouting } from "@/lib/hours";
import { error, json, readJson, requireAdmin } from "@/lib/http";
import { getSettings, saveSettings } from "@/lib/store";
import type { AppSettings, PhoneMode, PhoneSettings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODES: PhoneMode[] = ["ai_always", "ai_off_hours", "human_always"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

async function describe() {
  const settings = await getSettings();
  return {
    ok: true,
    settings,
    routing: resolvePhoneRouting(settings.phone),
    now: japanNow().display,
    hoursLabel: describeBusinessHours(settings.phone),
  };
}

/** 設定と現在の電話の振り分け（スタッフの転送先番号を含むため管理画面専用） */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return json(await describe());
}

export async function PUT(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const body = await readJson<Partial<AppSettings>>(req);
  if (!body) return error("リクエスト本文が不正です");
  const patch: Partial<AppSettings> = {};
  if (typeof body.companyName === "string") patch.companyName = body.companyName.trim().slice(0, 80);
  if (typeof body.companyPhone === "string") patch.companyPhone = body.companyPhone.trim().slice(0, 30);
  if (typeof body.lineAddFriendUrl === "string") patch.lineAddFriendUrl = body.lineAddFriendUrl.trim().slice(0, 300);
  if (typeof body.greeting === "string" && body.greeting.trim()) patch.greeting = body.greeting.trim().slice(0, 600);
  if (body.phone && typeof body.phone === "object") {
    const p = body.phone as Partial<PhoneSettings>;
    const phone: Partial<PhoneSettings> = {};
    if (p.mode && MODES.includes(p.mode)) phone.mode = p.mode;
    if (Array.isArray(p.businessDays))
      phone.businessDays = [...new Set(p.businessDays.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6))];
    if (typeof p.openTime === "string" && HHMM.test(p.openTime)) phone.openTime = p.openTime;
    if (typeof p.closeTime === "string" && HHMM.test(p.closeTime)) phone.closeTime = p.closeTime;
    if (Array.isArray(p.holidays)) phone.holidays = p.holidays.map((h) => String(h).trim()).filter((h) => YMD.test(h));
    if (typeof p.forwardNumber === "string") phone.forwardNumber = p.forwardNumber.trim().slice(0, 30);
    patch.phone = phone as PhoneSettings;
  }
  await saveSettings(patch);
  return json(await describe());
}
