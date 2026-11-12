import { env } from "@/lib/env";
import { describeBusinessHours, japanNow, resolvePhoneRouting, spokenBusinessHours } from "@/lib/hours";
import { error, json, readJson, requireAdmin } from "@/lib/http";
import { getKnowledge, invalidateKnowledgeCache } from "@/lib/knowledge";
import { DEFAULT_STAFF_AWAY, fillGuide } from "@/lib/phone-guide";
import { parseSheetLink } from "@/lib/sheet-link";
import { getSettings, saveSettings, storageInfo } from "@/lib/store";
import type { AppSettings, PhoneMode, PhoneSettings } from "@/lib/types";
import { fillTemplate } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODES: PhoneMode[] = ["ai_always", "ai_off_hours", "human_always"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** AI電話の案内文：いま読み上げる文と、スプレッドシート（「AI電話の案内文」のタブ）から読んだか */
async function phoneGuideStatus(settings: AppSettings) {
  const guide = (await getKnowledge().catch(() => null))?.phoneGuide;
  const vars = { company: settings.companyName, hours: spokenBusinessHours(settings.phone) };
  const scene = (label: string, sheet: string | undefined, fallback: string) => ({
    label,
    fromSheet: Boolean(sheet),
    text: sheet ? fillGuide(sheet, vars) : fallback,
  });
  return {
    tab: env.phoneGuideTab,
    error: guide?.error ?? (env.phoneGuideTab && !env.hasServiceAccount ? "スプレッドシートに接続されていないため、既定の案内文を使います" : undefined),
    scenes: [
      scene("最初のガイダンス（休日・営業時間外）", guide?.offHours, fillTemplate(settings.greeting, { company: settings.companyName })),
      scene("最初のガイダンス（営業時間内にスタッフが出られなかったとき）", guide?.staffAway, fillGuide(DEFAULT_STAFF_AWAY, vars)),
      scene("AIを停止しているときの案内", guide?.aiStopped, "（時間帯に合わせた既定の文：営業時間内は「しばらくしてから改めておかけ直しください」、時間外は営業時間をご案内）"),
    ],
  };
}

async function describe() {
  const settings = await getSettings();
  return {
    ok: true,
    settings,
    routing: resolvePhoneRouting(settings.phone),
    now: japanNow().display,
    hoursLabel: describeBusinessHours(settings.phone),
    // 設定の保存先（Redis がないサーバーレスでは、保存した設定が再起動・別のサーバーで元に戻る）
    persistent: storageInfo().persistent,
    phoneGuide: await phoneGuideStatus(settings),
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
  if (typeof body.knowledgeSheetUrl === "string") {
    const url = body.knowledgeSheetUrl.trim().slice(0, 500);
    const link = parseSheetLink(url);
    if (link?.kind === "invalid") return error(link.reason);
    patch.knowledgeSheetUrl = url;
  }
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
  // スプレッドシートの URL を変えたら、次の回答からそのシートを読む
  if (patch.knowledgeSheetUrl !== undefined) invalidateKnowledgeCache();
  return json(await describe());
}
