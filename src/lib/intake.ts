// 見積依頼の聞き取り（文字・声の相談で共通）
//   会話の中でお名前・ご住所・お電話番号・訪問のご希望日時（第1〜第3希望）を伺い、確認画面（EstimateForm）に自動で入れる
//   ・ここは規則だけの関数（ブラウザとサーバーの両方で使う）。OpenAI があれば intake-ai.ts が会話全体から読み取り、
//     ここの規則は電話番号・日付の整形と、OpenAI を使えないときの読み取りに使う
//   ・日程は AI が確定しない（ご希望を伺うだけ。担当者がお電話で調整して確定する）
import type { ChatMessage, EstimateRequest, IntakeDraft } from "./types";
import { isLikelyPhone, normalizePhone, truncate } from "./utils";

export type IntakeField = "name" | "address" | "phone" | "dates";
export type DraftField = IntakeField | "summary";
export const INTAKE_FIELDS: IntakeField[] = ["name", "address", "phone", "dates"];
export const FIELD_LABEL: Record<DraftField, string> = {
  name: "お名前",
  address: "ご住所",
  phone: "お電話番号",
  dates: "ご希望日時",
  summary: "ご相談内容",
};

/** 聞き取りの状態（ブラウザが会話と一緒に保存し、文字の相談では毎回サーバーに送る。声の相談とも共有） */
export interface IntakeState {
  /** 聞き取りの途中 */
  active: boolean;
  draft: IntakeDraft;
  /** 直前に AI が伺った項目（短い答え「山田です」をどの項目か判断するため） */
  asked?: IntakeField[];
  /** すべて伺えた（確認画面を開けば送信するだけ） */
  ready?: boolean;
  /** ご相談内容（要約）を作ったときの会話の件数（その後に会話が増えたら作り直す） */
  summaryAt?: number;
  /** お客様が確認画面でご相談内容を書き直した（AI の要約で上書きしない） */
  summaryEdited?: boolean;
  /** 確認画面でお客様が入力・修正した項目（会話からの読み取りで上書きしない） */
  touched?: DraftField[];
  /** AI が会話から入れた項目（受付の記録に残す） */
  aiFilled?: DraftField[];
}

const DRAFT_FIELDS: DraftField[] = ["name", "address", "phone", "dates", "summary"];
const fieldList = (v: unknown): DraftField[] => (Array.isArray(v) ? [...new Set(v.filter((f): f is DraftField => DRAFT_FIELDS.includes(f as DraftField)))] : []);

export function emptyDraft(): IntakeDraft {
  return { dates: [] };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** ブラウザから届いた下書き・状態の検査（長さの上限つき） */
export function sanitizeDraft(raw: unknown): IntakeDraft {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const dates = Array.isArray(d.dates) ? d.dates.map((x) => str(x, 60)).filter(Boolean).slice(0, 3) : [];
  const out: IntakeDraft = { dates };
  const name = str(d.name, 60);
  const address = str(d.address, 200);
  const phone = str(d.phone, 30);
  const summary = str(d.summary, 1000);
  if (name) out.name = name;
  if (address) out.address = address;
  if (phone) out.phone = phone;
  if (summary) out.summary = summary;
  return out;
}

export function sanitizeIntake(raw: unknown): IntakeState {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const asked = Array.isArray(s.asked) ? s.asked.filter((f): f is IntakeField => INTAKE_FIELDS.includes(f as IntakeField)) : [];
  return {
    active: s.active === true,
    draft: sanitizeDraft(s.draft),
    asked,
    ready: s.ready === true,
    summaryAt: typeof s.summaryAt === "number" && s.summaryAt >= 0 ? Math.floor(s.summaryAt) : undefined,
    summaryEdited: s.summaryEdited === true,
    touched: fieldList(s.touched),
    aiFilled: fieldList(s.aiFilled),
  };
}

/** 読み取り直した下書きに、お客様が確認画面で入力・修正した項目を戻す */
export function keepTouched(next: IntakeDraft, prev: IntakeDraft, touched: DraftField[] = []): IntakeDraft {
  const out: IntakeDraft = { ...next, dates: [...next.dates] };
  for (const f of touched) {
    if (f === "dates") out.dates = [...prev.dates];
    else out[f] = prev[f];
  }
  return out;
}

/** patch の空でない項目で上書き（ご希望日は 1 つ以上あれば置き換え） */
export function mergeDraft(base: IntakeDraft | undefined, patch: Partial<IntakeDraft> | undefined): IntakeDraft {
  const b = base ?? emptyDraft();
  const p = patch ?? {};
  const pick = (k: "name" | "address" | "phone" | "summary") => (p[k]?.trim() ? p[k]!.trim() : b[k]);
  return {
    name: pick("name"),
    address: pick("address"),
    phone: pick("phone"),
    dates: p.dates?.length ? p.dates.slice(0, 3) : [...(b.dates ?? [])],
    summary: pick("summary"),
  };
}

/** AI・音声認識が返した下書きの書き方をそろえる（電話番号のハイフン・「11月5日（木） 午前」・「様」を外す） */
export function normalizeDraft(d: Partial<IntakeDraft> | undefined, today: Ymd = todayJst()): IntakeDraft {
  const x = d ?? {};
  const out: IntakeDraft = {
    dates: [...new Set((x.dates ?? []).map((v) => normalizeDateText(v, today)).filter(Boolean))].slice(0, 3),
  };
  const name = x.name?.trim().replace(/(?:様|さま)$/u, "").trim();
  if (name) out.name = name;
  if (x.address?.trim()) out.address = x.address.trim();
  if (x.phone?.trim()) out.phone = formatPhone(x.phone) || x.phone.trim();
  if (x.summary?.trim()) out.summary = x.summary.trim();
  return out;
}

/** 伺えていない項目（電話番号は桁数が合わないものも未入力として扱う） */
export function missingFields(d: IntakeDraft | undefined): IntakeField[] {
  const x = d ?? emptyDraft();
  const out: IntakeField[] = [];
  if (!x.name?.trim()) out.push("name");
  if (!x.address?.trim()) out.push("address");
  if (!x.phone?.trim() || !isLikelyPhone(x.phone)) out.push("phone");
  if (!x.dates?.some((v) => v.trim())) out.push("dates");
  return out;
}

/** ご住所が番地まであるか（「熊本市東区」だけなら番地まで伺う） */
export function addressComplete(a: string | undefined): boolean {
  const s = (a ?? "").normalize("NFKC");
  return /\d/.test(s) || /[一二三四五六七八九十]+(丁目|番地?|号)/.test(s);
}

// ---------------- 日付 ----------------

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

const WD = ["日", "月", "火", "水", "木", "金", "土"];
const DAY_MS = 86_400_000;
const toTime = (t: Ymd) => Date.UTC(t.y, t.m - 1, t.d);
function fromTime(ms: number): Ymd {
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}
const validYmd = (t: Ymd) => t.m >= 1 && t.m <= 12 && t.d >= 1 && t.d <= 31 && fromTime(toTime(t)).d === t.d;

/** 日本時間の今日 */
export function todayJst(now: Date = new Date()): Ymd {
  return fromTime(now.getTime() + 9 * 3_600_000);
}

export function addDays(t: Ymd, n: number): Ymd {
  return fromTime(toTime(t) + n * DAY_MS);
}

export function weekdayOf(t: Ymd): number {
  return new Date(toTime(t)).getUTCDay();
}

/** 「10月28日（水）」 */
export function formatDay(t: Ymd): string {
  return `${t.m}月${t.d}日（${WD[weekdayOf(t)]}）`;
}

/** 年のない月日 → 今日以降のいちばん近い日（60 日より前に過ぎた月日は来年とみなし、最近過ぎた日は past） */
function resolveMonthDay(m: number, d: number, today: Ymd): { day: Ymd; past: boolean } | null {
  let t: Ymd = { y: today.y, m, d };
  if (!validYmd(t)) return null;
  const diff = (toTime(t) - toTime(today)) / DAY_MS;
  if (diff < -60) t = { ...t, y: today.y + 1 };
  if (!validYmd(t)) return null;
  return { day: t, past: diff < 0 && diff >= -60 };
}

const WD_INDEX: Record<string, number> = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 };

const DATE_RE = new RegExp(
  [
    String.raw`(?<y>\d{4})[年/.\-](?<m1>\d{1,2})[月/.\-](?<d1>\d{1,2})日?`,
    String.raw`(?<m2>\d{1,2})月(?<d2>\d{1,2})日`,
    String.raw`(?<![\d/:])(?<m3>\d{1,2})/(?<d3>\d{1,2})(?![\d/])`,
    String.raw`(?<![\d月/:])(?<d4>\d{1,2})日(?![間目])`,
    String.raw`(?<rel>今日|本日|明日|あした|あす|明後日|あさって|明々後日|しあさって)`,
    String.raw`(?<wk>再来週|来週|今週)の?(?<wd1>[月火水木金土日])(?:曜日?)?`,
    String.raw`(?:次の|今度の)?(?<wd2>[月火水木金土日])曜日?`,
  ].join("|"),
  "g",
);

const TIME_SRC = String.raw`(?:(?:午前|午後)\s*)?\d{1,2}(?::\d{2}|時(?:半|\d{1,2}分)?)(?:\s*(?:から|〜|~|-|以降|頃|ごろ|まで|以前)(?:\s*\d{1,2}(?::\d{2}|時(?:半)?)\s*(?:まで|頃|ごろ)?)?)?`;
const SLOT_RE = new RegExp(
  String.raw`${TIME_SRC}|午前中?|午後(?:から|以降)?|朝(?:一番?|いち)?|お?昼(?:から|以降|過ぎ|すぎ)|夕方|終日|一日中|何時でも|時間(?:は)?(?:指定なし|いつでも|おまかせ|お任せ)|(?<![A-Za-z])[AaPp]\.?[Mm]\.?(?![A-Za-z])`,
  "g",
);
const NONE_RE = /^(?:特に)?(?:指定(?:は)?(?:なし|無し|ありません)|(?:希望は)?(?:なし|無し|ない|ありません)|いつでも|おまかせ|お任せ|そちらに合わせ|そちらの都合|都合に合わせ)/;
const FREE_RE = /(?:再来週|来週|今週|今月|来月)(?:中|の)?(?:平日|週末|土日|前半|後半)?|平日|週末|月末|月初/;

function slotLabel(raw: string): string {
  const t = raw.replace(/\s+/g, "");
  if (/\d/.test(t)) return t.replace(/[~\-]/g, "〜");
  if (/^[Aa]\.?[Mm]/.test(t)) return "午前";
  if (/^[Pp]\.?[Mm]/.test(t)) return "午後";
  if (/^午前|^朝/.test(t)) return "午前";
  if (/^午後|^お?昼/.test(t)) return "午後";
  if (/^夕方/.test(t)) return "夕方";
  return "時間指定なし";
}

interface DateToken {
  at: number;
  end: number;
  day: Ymd;
  past: boolean;
  slot?: string;
}

/**
 * 発言からご希望日時を読み取る（「10月28日の午前か30日の午後」「来週火曜の午前」「明日の10時から」など）。
 * 返す形は「10月28日（水） 午前」。日付のない希望（「来週の平日」）はそのまま、「指定なし」は「指定なし」。
 */
export function parseDates(text: string, today: Ymd = todayJst()): { dates: string[]; past: string[] } {
  const s = text.normalize("NFKC");
  const tokens: DateToken[] = [];
  let lastMonth: number | undefined;
  const mon0 = (weekdayOf(today) + 6) % 7; // 月曜始まりで今日は何日目か
  for (const m of s.matchAll(DATE_RE)) {
    const g = m.groups ?? {};
    let r: { day: Ymd; past: boolean } | null = null;
    if (g.y) {
      const t: Ymd = { y: Number(g.y), m: Number(g.m1), d: Number(g.d1) };
      r = validYmd(t) ? { day: t, past: toTime(t) < toTime(today) } : null;
    } else if (g.m2 || g.m3) {
      r = resolveMonthDay(Number(g.m2 ?? g.m3), Number(g.d2 ?? g.d3), today);
    } else if (g.d4) {
      const d = Number(g.d4);
      let month = lastMonth ?? today.m;
      if (lastMonth === undefined && d < today.d) month = (today.m % 12) + 1;
      r = resolveMonthDay(month, d, today);
    } else if (g.rel) {
      const n = /今日|本日/.test(g.rel) ? 0 : /明々後日|しあさって/.test(g.rel) ? 3 : /明後日|あさって/.test(g.rel) ? 2 : 1;
      r = { day: addDays(today, n), past: false };
    } else if (g.wk) {
      const base = g.wk === "再来週" ? 14 : g.wk === "来週" ? 7 : 0;
      const n = base - mon0 + ((WD_INDEX[g.wd1] + 6) % 7);
      r = { day: addDays(today, n), past: n < 0 };
    } else if (g.wd2) {
      const n = (WD_INDEX[g.wd2] - weekdayOf(today) + 7) % 7 || 7;
      r = { day: addDays(today, n), past: false };
    }
    if (!r) continue;
    lastMonth = r.day.m;
    tokens.push({ at: m.index ?? 0, end: (m.index ?? 0) + m[0].length, ...r });
  }
  // 時間帯は、その前にあるいちばん近い日付に付ける（「28日か30日の午前」のように最後に 1 つだけなら全部に）
  const slots = [...s.matchAll(SLOT_RE)]
    .map((m) => ({ at: m.index ?? 0, end: (m.index ?? 0) + m[0].length, label: slotLabel(m[0]) }))
    .filter((x) => !tokens.some((t) => x.at < t.end && x.end > t.at));
  for (const sl of slots) {
    const target = [...tokens].reverse().find((t) => t.at < sl.at && !t.slot);
    if (target) target.slot = sl.label;
  }
  if (tokens.length > 1 && slots.length === 1 && slots[0].at > tokens[tokens.length - 1].at) {
    for (const t of tokens) t.slot ??= slots[0].label;
  }
  const label = (t: DateToken) => `${formatDay(t.day)}${t.slot ? ` ${t.slot}` : ""}`;
  const past = tokens.filter((t) => t.past).map(label);
  let dates = tokens.filter((t) => !t.past).map(label);
  if (!tokens.length) {
    const plain = s.replace(/^(?:第[1-3一二三]希望|希望日?(?:時)?)(?:は|:|：)?\s*/, "").trim();
    if (NONE_RE.test(plain)) dates = ["指定なし"];
    else if (FREE_RE.test(plain)) dates = [truncate(plain.replace(/(?:で|が)?(?:お願いします|お願い|です|希望です|がいいです|だと助かります)[。!！]*$/, "").trim(), 40)];
  }
  return { dates: [...new Set(dates)].slice(0, 3), past };
}

/** 「10月28日 午前」などの書き方を「10月28日（水） 午前」にそろえる（曜日は計算し直す） */
export function normalizeDateText(text: string, today: Ymd = todayJst()): string {
  const s = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (/^(?:指定なし|なし|特になし)$/.test(s)) return "指定なし";
  const md = s.match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日(?:\s*[（(][月火水木金土日][)）])?\s*(.*)$/);
  if (md) {
    const y = md[1] ? Number(md[1]) : undefined;
    const r = y ? { day: { y, m: Number(md[2]), d: Number(md[3]) } } : resolveMonthDay(Number(md[2]), Number(md[3]), today);
    if (r && validYmd(r.day)) {
      const rest = md[4].replace(/^の/, "").trim();
      return `${formatDay(r.day)}${rest ? ` ${rest}` : ""}`;
    }
  }
  const parsed = parseDates(s, today);
  return parsed.dates.length === 1 && parsed.past.length === 0 ? parsed.dates[0] : truncate(s, 60);
}

/** 「10月19日（月） 午前」が今日より前か（年のない月日は、最近過ぎた日だけを過去とみなす） */
export function isPastDate(text: string, today: Ymd = todayJst()): boolean {
  const md = text.normalize("NFKC").match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/);
  if (!md) return false;
  if (md[1]) return toTime({ y: Number(md[1]), m: Number(md[2]), d: Number(md[3]) }) < toTime(today);
  return Boolean(resolveMonthDay(Number(md[2]), Number(md[3]), today)?.past);
}

/** 例に使う日付（今日から 3 日以上先の平日と、その次の平日） */
export function exampleDays(today: Ymd = todayJst()): [string, string] {
  const nextWeekday = (t: Ymd) => {
    let x = t;
    while (weekdayOf(x) === 0 || weekdayOf(x) === 6) x = addDays(x, 1);
    return x;
  };
  const a = nextWeekday(addDays(today, 3));
  const b = nextWeekday(addDays(a, 2));
  return [`${a.m}月${a.d}日`, `${b.m}月${b.d}日`];
}

// ---------------- 電話番号・ご住所・お名前 ----------------

/** 当社の番号（お客様の番号として拾わない） */
const COMPANY_PHONES = ["0120158108"];

export function formatPhone(raw: string): string {
  const p = normalizePhone(raw).replace(/^\+81-?/, "0");
  const digits = p.replace(/\D/g, "");
  if (p.includes("-")) return p;
  if (/^0[789]0\d{8}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (/^0120\d{6}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  return digits;
}

const PHONE_FIND = /(?:\+81|0)[\d\-‐－―ー−\s()]{8,16}\d/g;

/** 文中の電話番号（見つかった文字の位置も返す） */
function findPhone(s: string): { value: string; at: number; end: number } | null {
  for (const m of s.matchAll(PHONE_FIND)) {
    const p = formatPhone(m[0]);
    const digits = p.replace(/\D/g, "");
    if (isLikelyPhone(p) && !COMPANY_PHONES.includes(digits)) return { value: p, at: m.index ?? 0, end: (m.index ?? 0) + m[0].length };
  }
  return null;
}

// 熊本県内・営業範囲の市町村（区切りのない「山田花子熊本市…」でもご住所の始まりがわかるように）
const KNOWN_AREAS =
  "熊本県|福岡県|熊本市|合志市|菊池市|菊池郡|菊陽町|大津町|山鹿市|荒尾市|玉名市|玉名郡|宇土市|宇城市|八代市|八代郡|上益城郡|下益城郡|阿蘇市|阿蘇郡|大牟田市|天草市|上天草市|人吉市|水俣市|益城町|嘉島町|御船町|甲佐町|山都町|美里町|和水町|南関町|長洲町|玉東町|南阿蘇村|高森町|小国町|南小国町|産山村|西原村|氷川町|芦北町|葦北郡|津奈木町|球磨郡|錦町|あさぎり町|多良木町|湯前町|相良村|山江村|球磨村|天草郡|苓北町";
const PREF = String.raw`(?:北海道|東京都|京都府|大阪府|[一-龯]{2,3}県)`;
const ADDRESS_START = new RegExp(String.raw`(?:${KNOWN_AREAS})|(?:^|(?<=[\s、,]))(?:${PREF}|[一-龯ぁ-んァ-ヶ]{1,5}(?:市|郡))`);
const ADDRESS_LABEL = /(?:ご?住所|お住まい)(?:は|が|:|：)\s*/;
const NAME_LABEL = /(?:お?名前|氏名|名義)(?:は|が|:|：)\s*/;
const PHONE_LABEL = /(?:お?電話(?:番号)?|携帯(?:番号)?|連絡先|番号)(?:は|が|:|：)\s*/;
const DATE_LABEL = /(?:(?:ご?希望(?:日時?|の日)?|第\s*[1-3一二三]\s*希望|都合のいい日|空いている日)(?:は|が|:|：)?)/;
const NAME_TAIL = /(?:と申します|といいます|と言います|でございます|です|になります)[。.!！]*$/;
const NOT_NAME =
  /^(?:はい|いいえ|いえ|ええ|うん|大丈夫|お願いします?|よろしく(?:お願いします)?|わかりました|了解|ok|結構|なし|ありません|特に|未定|まだ|見積|畳|襖|障子|網戸|表替え|新調|張替え|相談|午前|午後)/i;
const CHUNK_SPLIT = /[、,，。\n]|\s*[/／]\s*|\s{2,}/;
/** 番号などを取り除いたあとに残る言葉だけの部分 */
const FILLER = /^(?:です|になります|でお願いします|でございます|お願いします|まで|へ)?[。.!！]*$/;

export const QUESTION_RE = /[?？]|(?:ですか|ますか|でしょうか|ませんか|できる[？?]?$|いくら|何日|何時間|どれくらい|どのくらい|どのような|どんな|教えて|知りたい|聞きたい)/;
export const CANCEL_RE = /(?:やっぱり|やはり|今回は|今は|いったん|一旦)?(?:やめ(?:ます|ておきます|とき|る)|キャンセル|結構です|けっこうです|いりません|必要ありません|大丈夫です(?:、|。)?(?:また|今度))|やっぱりいい|また(?:今度|にします)/;

export interface Extracted {
  draft: Partial<IntakeDraft>;
  /** 読み取れた項目 */
  found: IntakeField[];
  /** 過ぎた日付（「10月20日」が昨日など） */
  past: string[];
  /** 番号・住所・日付などを除いた残りの文（質問が含まれているかの判断・要約用） */
  leftover: string;
  /** 「第2希望は〜」のように、すでに伺ったご希望日に足す */
  appendDates: boolean;
}

function cleanName(s: string): string {
  return s
    .replace(/^(?:はい|えっと|えーと|あの|わたしは|私は|僕は|ぼくは)[、,]?\s*/u, "")
    .replace(NAME_LABEL, "")
    .replace(NAME_TAIL, "")
    .replace(/(?:様|さま)$/u, "")
    .replace(/[、,。.\s]+$/u, "")
    .trim();
}

/** お名前ではない言い回し（「その前に」「やっぱりやめておきます」など） */
const NOT_NAME_LEAD = /^(?:その前に|ちなみに|ところで|あと|それと|それから|すみません|ちょっと|まず|えっと|あの|では|じゃあ|やっぱり|やはり|今は|今回は)/;
const NOT_NAME_TAIL = /(?:に|を|が|へ|って|けど|けれど|ので|から|のは|には|では|ます|ません|ました|でした|ください|たい|ない)$/;

function plausibleName(s: string): boolean {
  if (!s || s.length > 20 || /\d/.test(s) || /[?？!！]/.test(s)) return false;
  if (NOT_NAME.test(s) || NOT_NAME_LEAD.test(s) || NOT_NAME_TAIL.test(s) || ADDRESS_START.test(s) || QUESTION_RE.test(s) || CANCEL_RE.test(s)) return false;
  return /^[一-龯々ぁ-んァ-ヶー\sA-Za-z・.]+$/u.test(s);
}

/**
 * 1 つの発言からお名前・ご住所・お電話番号・ご希望日時を読み取る。
 * asked は直前に AI が伺った項目（「山田です」のような短い答えをお名前と判断するため）。
 */
export function extractIntake(text: string, asked: IntakeField[] = [], today: Ymd = todayJst()): Extracted {
  const draft: Partial<IntakeDraft> = {};
  const found: IntakeField[] = [];
  let past: string[] = [];
  let appendDates = false;
  const leftovers: string[] = [];
  // 「名前は〜、住所は〜」の見出しごとに区切ってから読む
  const s = text
    .normalize("NFKC")
    .replace(new RegExp(`(${NAME_LABEL.source}|${ADDRESS_LABEL.source}|${PHONE_LABEL.source}|${DATE_LABEL.source})`, "g"), "\n$1")
    .trim();
  const chunks = s.split(CHUNK_SPLIT).map((c) => c.trim()).filter(Boolean);
  const dateChunks: string[] = [];
  for (const chunk0 of chunks) {
    let chunk = chunk0;
    // お電話番号
    const ph = findPhone(chunk);
    if (ph) {
      if (!draft.phone) {
        draft.phone = ph.value;
        found.push("phone");
      }
      chunk = `${chunk.slice(0, ph.at)} ${chunk.slice(ph.end)}`.replace(PHONE_LABEL, "").trim();
      if (!chunk || FILLER.test(chunk)) continue;
    } else if (PHONE_LABEL.test(chunk) && /^\s*(?:お?電話|携帯|連絡先|番号)/.test(chunk)) {
      leftovers.push(chunk);
      continue;
    }
    // ご希望日時（聞かれたとき・見出しがあるときだけ。「何日かかる？」などを日付と取り違えないように）
    const labeledDate = DATE_LABEL.test(chunk);
    if (asked.includes("dates") || labeledDate) {
      const pd = parseDates(chunk, today);
      if (pd.dates.length || pd.past.length) {
        dateChunks.push(chunk);
        past = [...past, ...pd.past];
        if (/第\s*[23二三]\s*希望|(?:あと|それと|追加で|ほかに|他に)/.test(chunk)) appendDates = true;
        continue;
      }
    }
    // ご住所（見出し・市町村名から後ろ）
    const labeledAddr = ADDRESS_LABEL.test(chunk);
    const body = chunk.replace(ADDRESS_LABEL, "");
    const start = body.search(ADDRESS_START);
    if ((labeledAddr || asked.includes("address") || (start >= 0 && addressComplete(body.slice(start)))) && start >= 0 && !QUESTION_RE.test(body.slice(start))) {
      const addr = body.slice(start).replace(/(?:です|になります|でお願いします)[。.!！]*$/, "").trim();
      if (addr.length >= 3 && addr.length <= 120 && !draft.address) {
        draft.address = addr;
        found.push("address");
      }
      chunk = body.slice(0, start).trim();
      if (!chunk) continue;
    } else if (labeledAddr && body.trim() && !QUESTION_RE.test(body)) {
      if (!draft.address) {
        draft.address = body.replace(/(?:です|になります)[。.!！]*$/, "").trim();
        found.push("address");
      }
      continue;
    }
    // お名前（見出し・「〜と申します」・お名前を伺った直後の短い答え）
    const labeledName = NAME_LABEL.test(chunk);
    const named = cleanName(chunk);
    if (!draft.name && plausibleName(named) && (labeledName || /と申します|といいます|と言います/.test(chunk) || asked.includes("name"))) {
      draft.name = named;
      found.push("name");
      continue;
    }
    leftovers.push(chunk);
  }
  if (dateChunks.length) {
    const pd = parseDates(dateChunks.join("、"), today);
    if (pd.dates.length) {
      draft.dates = pd.dates;
      found.push("dates");
    }
  }
  return { draft, found, past: [...new Set(past)], leftover: leftovers.join("、").trim(), appendDates };
}

/** AI の発言から、伺っている項目を推定する（状態が届かなかったときの補い） */
export function askedFromText(text: string): IntakeField[] {
  if (!/(教えて|お聞かせ|伺|お願い|ください|ますか)/.test(text)) return [];
  const out: IntakeField[] = [];
  if (/お名前|氏名/.test(text)) out.push("name");
  if (/ご住所/.test(text)) out.push("address");
  if (/電話番号/.test(text)) out.push("phone");
  if (/ご?希望日|日時|日にち|日程/.test(text)) out.push("dates");
  return out;
}

// ---------------- 見積のご依頼かどうか ----------------

const ESTIMATE_QUESTION = /(?:見積|見積り|見積もり|みつもり)(?:り|もり)?(?:は|って|に|を出すのに|を出してもらうのに)(?:無料|有料|お金|費用|料金|いくら|かかり|かかる|必要|何日|どのくらい|どれくらい|時間)/;
const ESTIMATE_REQUEST = new RegExp(
  [
    String.raw`(?:見積|見積り|見積もり|みつもり)(?:り|もり)?(?:を|も|の)?(?:お願い|おねがい|頼|依頼|申し?込|希望|したい|ほしい|欲しい|ください|下さい|取りたい|とりたい|出して|もらいたい|もらえ|いただきたい|いただけ)`,
    String.raw`(?:見|み|見積|見積り|見積もり|みつもり)(?:に|で)?来て(?:ほしい|欲しい|もらいたい|もらえ|いただきたい|いただけ|ください)`,
    String.raw`(?:下見|現地調査|現地確認|訪問)(?:を|に|して)?(?:お願い|頼|依頼|希望|ほしい|欲しい|来て|もらいたい|もらえ|いただきたい|いただけ|ください)`,
    String.raw`(?:工事|施工|作業|表替え|張替え|張り替え|新調|交換|修理|リフォーム)(?:を|も)?(?:お願いしたい|依頼したい|頼みたい|申し込みたい|お願いします|お願いしたいです)`,
    String.raw`申し込みたい|申し込みます|依頼したい|依頼します`,
  ].join("|"),
);

/** 「土日に工事をお願いしたいのですが、できますか？」のような、条件（日時・急ぎなど）の質問 */
const CONDITION_QUESTION = /(?:土日|土曜|日曜|祝日|週末|夜|夕方|何時|急ぎ|すぐ|今日中|明日中|年末|お盆)[^?？]*(?:できますか|可能ですか|大丈夫ですか|いけますか|もらえますか|[?？])/;

/** 文字の相談で「見積をお願いしたい」などのご依頼か（「見積は無料ですか？」「土日も工事できますか？」のような質問は含めない） */
export function wantsEstimate(text: string): boolean {
  const s = text.normalize("NFKC");
  if (ESTIMATE_QUESTION.test(s) && !/(?:お願い|依頼|頼みたい|申し込)/.test(s)) return false;
  if (CONDITION_QUESTION.test(s) && !/(?:見積|みつもり)/.test(s)) return false;
  return ESTIMATE_REQUEST.test(s);
}

// ---------------- AI が話す文（文字の相談） ----------------

const ASK_LINE: Record<Exclude<IntakeField, "dates">, string> = {
  name: "・お名前（フルネーム）",
  address: "・ご住所（番地まで）",
  phone: "・お電話番号（日中つながる番号）",
};

/**
 * まだ伺う項目。ご住所が「熊本市東区」のように番地までないときは、1 回だけ番地を伺う
 * （lastAsked・prev は前のターンで伺った項目と、そのときの下書き。番地を伺ったのに答えがなければそのまま進む）
 */
export function intakeNeeds(draft: IntakeDraft, lastAsked: IntakeField[] = [], prev?: IntakeDraft): IntakeField[] {
  const need = missingFields(draft);
  const askedNumber = lastAsked.length === 1 && lastAsked[0] === "address" && Boolean(prev?.address) && !addressComplete(prev?.address);
  if (draft.address && !addressComplete(draft.address) && !askedNumber && !need.includes("address")) need.unshift("address");
  return INTAKE_FIELDS.filter((f) => need.includes(f));
}

/** 次に伺う内容（needs の項目だけ。お名前・ご住所・お電話番号はまとめて、ご希望日時はそのあと） */
export function intakeQuestion(
  draft: IntakeDraft,
  opts: { needs?: IntakeField[]; start?: boolean; got?: IntakeField[]; past?: string[]; today?: Ymd } = {},
): { text: string; asked: IntakeField[] } {
  const missing = opts.needs ?? missingFields(draft);
  const contact = missing.filter((f): f is Exclude<IntakeField, "dates"> => f !== "dates");
  const thanks = opts.start
    ? "かしこまりました。無料お見積り（担当者が現地を確認してお見積りを作成します）のご依頼を承ります。\n"
    : opts.got?.length
      ? "ありがとうございます。"
      : "";
  if (contact.length >= 2) {
    return {
      text: `${thanks}お伺いするために、次の内容を教えてください。\n${contact.map((f) => ASK_LINE[f]).join("\n")}\nまとめて1つのメッセージで送っていただいてかまいません。`,
      asked: contact,
    };
  }
  if (contact.length === 1) {
    const f = contact[0];
    const line =
      f === "name"
        ? "お名前（フルネーム）を教えてください。"
        : f === "address"
          ? draft.address && !addressComplete(draft.address)
            ? `ご住所を、「${draft.address}」のあとの番地まで教えてください（わからなければ「わからない」でもかまいません）。`
            : "ご住所を番地まで教えてください。"
          : draft.phone
            ? "恐れ入ります、お電話番号を市外局番から教えてください（例：090-1234-5678）。"
            : "折り返しご連絡するお電話番号を教えてください。";
    return { text: `${thanks}${opts.start ? "" : "続いて、"}${line}`, asked: [f] };
  }
  const [a, b] = exampleDays(opts.today);
  const pastNote = opts.past?.length ? `恐れ入ります、${opts.past.join("・")}はすでに過ぎているようです。` : "";
  return {
    text: `${thanks}${pastNote}${opts.start || pastNote ? "" : "最後に、"}お見積り（訪問）のご希望日時を、第3希望まで教えてください。\n例：「${a} 午前、${b} 午後」\n※日程は確定ではありません。担当者よりお電話でご相談のうえ決めさせていただきます。ご希望がなければ「指定なし」でもかまいません。`,
    asked: ["dates"],
  };
}

/** すべて伺えたときの案内（確認画面のボタンへ） */
export function intakeReadyText(draft: IntakeDraft): string {
  const more = draft.dates.length < 3 && draft.dates[0] !== "指定なし" ? "第2・第3希望があれば、確認画面で追加できます。\n" : "";
  return `ありがとうございます。お伺いした内容で、お見積り依頼の確認画面をご用意しました。\n下の「内容を確認して送信」ボタンを押して、ご確認のうえ送信してください（修正もできます）。\n${more}※訪問の日程は確定ではありません。担当者よりお電話でご相談のうえ決定いたします。`;
}

export const INTAKE_CANCEL_TEXT =
  "かしこまりました。お見積りのご依頼はいつでも承りますので、またお気軽にお申し付けください。ほかにご不明な点があれば、お気軽にどうぞ。";

// ---------------- 会話全体から（OpenAI を使えないとき） ----------------

const INTENT_ONLY = /^(?:(?:すみません|では|じゃあ|あの)[、,]?\s*)?(?:無料)?(?:お?見積(?:り|もり)?|下見|訪問)(?:を|の)?(?:お願い|依頼|希望|申し込み)?(?:します|したい(?:です)?|できますか)?[。!！]*$/;
const SMALLTALK_ONLY = /^(?:はい|いいえ|ありがとう(?:ございます)?|わかりました|了解(?:です)?|お願いします|よろしく(?:お願いします)?|大丈夫です?|ok)[。!！]*$/i;

/** 会話全体からお名前などを読み取り、ご相談内容（お客様の発言から個人情報を除いたもの）を作る */
export function extractFromConversation(messages: ChatMessage[], today: Ymd = todayJst()): { draft: IntakeDraft; summary: string } {
  let draft = emptyDraft();
  const consult: string[] = [];
  messages.forEach((m, i) => {
    if (m.role !== "user") return;
    const prev = [...messages.slice(0, i)].reverse().find((x) => x.role === "assistant");
    const asked = prev ? askedFromText(prev.content) : [];
    const x = extractIntake(m.content, asked, today);
    if (x.found.length) {
      const dates = x.draft.dates && x.appendDates ? [...draft.dates, ...x.draft.dates].slice(0, 3) : x.draft.dates;
      draft = mergeDraft(draft, { ...x.draft, dates });
    }
    const rest = (x.found.length ? x.leftover : m.content.trim()).replace(/\s+/g, " ");
    // AI が伺った項目への短い答え（「保田窪2-1-21」「指定なしです」など）はご相談内容に入れない
    const answer = asked.length > 0 && rest.length <= 40 && !QUESTION_RE.test(rest);
    const intentOnly = INTENT_ONLY.test(rest) || (rest.length <= 20 && wantsEstimate(rest));
    if (rest && !answer && !intentOnly && !SMALLTALK_ONLY.test(rest) && rest.length >= 4) consult.push(rest);
  });
  return { draft, summary: truncate(consult.join(" ／ "), 220) };
}

// ---------------- 受付の記録 ----------------

const AUTOFILL_FIELDS: DraftField[] = ["name", "address", "phone", "dates", "summary"];

/** 受付のうち AI が会話から入力した項目（例：「お名前・ご住所・ご希望日時（お客様が修正：ご住所）」） */
export function autofillLabel(e: Pick<EstimateRequest, "channel" | "autofill">): string {
  if (e.channel === "phone" || e.channel === "line") return "AIが会話で聞き取り（口頭で確認）";
  if (!e.autofill) return "";
  const names = (list: string[]) =>
    AUTOFILL_FIELDS.filter((f) => list.includes(f))
      .map((f) => FIELD_LABEL[f])
      .join("・");
  const filled = names(e.autofill.filled);
  const edited = names(e.autofill.edited);
  if (!filled) return "なし（お客様が入力）";
  return edited ? `${filled}（お客様が修正：${edited}）` : filled;
}
