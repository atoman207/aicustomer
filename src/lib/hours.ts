import type { PhoneSettings } from "./types";

export interface JapanNow {
  date: string; // YYYY-MM-DD
  day: number; // 0=日
  minutes: number; // 0:00からの分
  display: string; // 例: 2026/10/17(土) 14:05
}

const DAY_LABEL = ["日", "月", "火", "水", "木", "金", "土"];

export function japanNow(at: Date = new Date()): JapanNow {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const y = get("year");
  const m = get("month");
  const d = get("day");
  const hh = Number(get("hour")) % 24;
  const mm = Number(get("minute"));
  const wd = get("weekday").replace(/[()（）]/g, "");
  const day = Math.max(0, DAY_LABEL.indexOf(wd));
  return {
    date: `${y}-${m}-${d}`,
    day,
    minutes: hh * 60 + mm,
    display: `${y}/${m}/${d}(${DAY_LABEL[day]}) ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((v) => Number(v));
  if (!Number.isFinite(h)) return 0;
  return h * 60 + (Number.isFinite(m) ? m : 0);
}

export function isBusinessHours(settings: PhoneSettings, at: Date = new Date()): boolean {
  const now = japanNow(at);
  if (settings.holidays.includes(now.date)) return false;
  if (!settings.businessDays.includes(now.day)) return false;
  const open = toMinutes(settings.openTime);
  const close = toMinutes(settings.closeTime);
  if (close <= open) return now.minutes >= open || now.minutes < close; // 深夜またぎ
  return now.minutes >= open && now.minutes < close;
}

export interface PhoneRouting {
  handler: "ai" | "human";
  inBusinessHours: boolean;
  reason: string;
}

/** 現在の設定・時刻からAI対応か人間（転送）対応かを判定 */
export function resolvePhoneRouting(settings: PhoneSettings, at: Date = new Date()): PhoneRouting {
  const inHours = isBusinessHours(settings, at);
  switch (settings.mode) {
    case "ai_always":
      return { handler: "ai", inBusinessHours: inHours, reason: "設定：常時AI対応" };
    case "human_always":
      return { handler: "human", inBusinessHours: inHours, reason: "設定：常にスタッフ対応（転送）" };
    case "ai_off_hours":
    default:
      return inHours
        ? { handler: "human", inBusinessHours: true, reason: "営業時間内のためスタッフ対応（転送）" }
        : { handler: "ai", inBusinessHours: false, reason: "休日・営業時間外のためAI対応" };
  }
}

export function describeBusinessHours(settings: PhoneSettings): string {
  const days = settings.businessDays
    .slice()
    .sort()
    .map((d) => DAY_LABEL[d])
    .join("・");
  return `${days || "（営業日未設定）"} ${settings.openTime}〜${settings.closeTime}`;
}
