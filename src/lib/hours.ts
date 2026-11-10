import type { PhoneSettings } from "./types";
import { e164Japan } from "./utils";

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

/**
 * AI の電話番号（Twilio）に届いた着信をどうするか：
 *   ai：AI が受ける ／ dial：転送先（スタッフ）へつなぐ（出なければ AI か「おかけ直しください」）／
 *   ai_after_staff：スタッフ対応の時間だが、転送先がない・転送先から転送されてきた
 *     ＝お店の電話（0120 の着信先）が先に鳴り、出られなかったお電話（NTT のボイスワープの無応答時・話中時転送）→ AI が代わりに受ける ／
 *   closed：AI 停止中（常にスタッフ対応）で、つなぐ先がない →「おかけ直しください」とご案内して終える
 */
export type CallAction = "ai" | "dial" | "ai_after_staff" | "closed";

export interface PhoneRouting {
  handler: "ai" | "human";
  inBusinessHours: boolean;
  reason: string;
  action: CallAction;
}

export interface RoutingOptions {
  /** この着信が転送先の番号から転送されてきた（つなぎ返すと、転送がぐるぐる回る） */
  fromForwardLine?: boolean;
}

/** 現在の設定・時刻から、AI 対応かスタッフ対応か・AI の番号に届いた着信をどうするかを判定 */
export function resolvePhoneRouting(settings: PhoneSettings, at: Date = new Date(), opts: RoutingOptions = {}): PhoneRouting {
  const inHours = isBusinessHours(settings, at);
  const handler: PhoneRouting["handler"] =
    settings.mode === "ai_always" ? "ai" : settings.mode === "human_always" ? "human" : inHours ? "human" : "ai";
  const canDial = Boolean(e164Japan(settings.forwardNumber)) && !opts.fromForwardLine;
  if (handler === "ai") {
    const reason = settings.mode === "ai_always" ? "設定：常時AI対応" : "休日・営業時間外のためAI対応";
    return { handler, inBusinessHours: inHours, reason, action: "ai" };
  }
  const why = settings.mode === "human_always" ? "設定：常にスタッフ対応（AI停止）" : "営業時間内のためスタッフ対応";
  if (canDial) {
    const after = settings.mode === "human_always" ? "出られなければ、おかけ直しのご案内" : "出られなければAIが代わりに受付";
    return { handler, inBusinessHours: inHours, reason: `${why}。転送先の電話へおつなぎ（${after}）`, action: "dial" };
  }
  if (settings.mode === "human_always") {
    return { handler, inBusinessHours: inHours, reason: `${why}。AIの番号に届いたお電話は、おかけ直しのご案内`, action: "closed" };
  }
  return {
    handler,
    inBusinessHours: inHours,
    reason: `${why}。お店の電話が先に鳴り、出られなかったお電話（転送されてきたお電話）はAIが代わりに受付`,
    action: "ai_after_staff",
  };
}

/** 営業時間の読み上げ（「平日の、午前8時から午後6時まで」） */
export function spokenBusinessHours(settings: PhoneSettings): string {
  const days = settings.businessDays.slice().sort();
  const dayText =
    days.join(",") === "1,2,3,4,5" ? "平日" : days.join(",") === "1,2,3,4,5,6" ? "月曜日から土曜日" : days.map((d) => `${DAY_LABEL[d]}曜日`).join("、");
  const clock = (hhmm: string) => {
    const m = toMinutes(hhmm);
    const h = Math.floor(m / 60) % 24;
    const min = m % 60;
    if (h === 12 && !min) return "正午";
    return `${h < 12 ? "午前" : "午後"}${h % 12}時${min ? `${min}分` : ""}`;
  };
  return `${dayText ? `${dayText}の、` : ""}${clock(settings.openTime)}から${clock(settings.closeTime)}まで`;
}

export function describeBusinessHours(settings: PhoneSettings): string {
  const days = settings.businessDays
    .slice()
    .sort()
    .map((d) => DAY_LABEL[d])
    .join("・");
  return `${days || "（営業日未設定）"} ${settings.openTime}〜${settings.closeTime}`;
}
