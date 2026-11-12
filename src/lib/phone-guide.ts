// AI電話の決まった案内文（最初のガイダンス・AI停止中の案内）を、スプレッドシートの「AI電話の案内文」のタブから読む。
// 一畳屋様のご要望 2026-11-10：「最初のガイダンスの文言についても、実際に運用しながら微調整していきたい」。
// シートを直すと、資料と同じく約 1 分で反映する（knowledge.ts が資料と一緒に読む）。空の項目・タブがないときは既定の文
import type { PhoneGuide } from "./types";

/** タブの見出し（1 行目） */
export const PHONE_GUIDE_HEADER = ["場面", "案内文（AI電話がそのまま読み上げる文）", "メモ"];

/** 最初のガイダンス（休日・営業時間外）。一畳屋様の文案（2026-11-10） */
export const DEFAULT_OFF_HOURS =
  "お電話ありがとうございます。一畳屋です。ただいまの時間は、AIがお電話を承っております。お見積もりのご予約はもちろん、商品についてのご質問やご相談にも、できる限りお答えいたします。本日はどのようなご用件でしょうか？";
/** 最初のガイダンス（営業時間内にスタッフが出られなかったとき）。2026-11-10 に一畳屋様へご提案した文 */
export const DEFAULT_STAFF_AWAY =
  "お電話ありがとうございます。一畳屋です。ただいま担当者が電話に出ることができないため、AIがお電話を承っております。お見積もりのご予約はもちろん、商品についてのご質問やご相談にも、できる限りお答えいたします。本日はどのようなご用件でしょうか？";
/** AIを停止しているときの案内（シートの初めの文。シートが空なら phone-call.ts の時間帯に合わせた文） */
export const DEFAULT_AI_STOPPED =
  "お電話ありがとうございます。一畳屋です。ただいま、お電話に出ることができません。恐れ入りますが、しばらくしてから改めておかけ直しください。営業時間は、{営業時間}です。お電話ありがとうございました。";

/** タブを作るときに書く行（見出しの下） */
export const PHONE_GUIDE_ROWS: string[][] = [
  ["最初のガイダンス（休日・営業時間外）", DEFAULT_OFF_HOURS, "休日・営業時間外（と「常時AI」のとき）に、AIが最初に読み上げます。空欄にすると、管理画面の「電話の第一声」を使います"],
  [
    "最初のガイダンス（営業時間内にスタッフが出られなかったとき）",
    DEFAULT_STAFF_AWAY,
    "営業時間内に、お店の電話に出られなかったお電話がAIへ転送されたときに読み上げます。担当者へおつなぎして出られなかったときは、最初の「お電話ありがとうございます。一畳屋です。」を「お待たせいたしました。」に替えて読みます",
  ],
  [
    "AIを停止しているときの案内",
    DEFAULT_AI_STOPPED,
    "管理画面で「常にスタッフ対応（AI停止）」にしているとき、AIの番号に届いたお電話に読み上げて終えます。{営業時間} は管理画面の営業時間（例：平日の、午前8時から午後6時まで）に置き換わります",
  ],
  ["（使い方）", "", "B列の文を書き換えると、約1分でAI電話に反映されます。{会社名} は会社名に置き換わります。空欄にすると既定の文を使います。A列の「場面」の言葉は変えないでください"],
];

/** 読み上げる文の長さの上限（長すぎる案内は、お客様が話し始めるまでに時間がかかる） */
const MAX_LENGTH = 600;

/** セルの文：改行・前後の空白をそろえる（読み上げは 1 続きの文） */
function cleanText(s: string | undefined): string | undefined {
  const t = (s ?? "")
    .toString()
    .replace(/^["「『]|["」』]$/g, "")
    .replace(/\s*\n\s*/g, "")
    .replace(/[ \t　]+/g, " ")
    .trim()
    .slice(0, MAX_LENGTH);
  return t || undefined;
}

/** タブの行 → 案内文。A 列の「場面」の言葉で見分ける（行の順番は問わない。見出し・使い方の行は読まない） */
export function parsePhoneGuide(tab: string, rows: string[][]): PhoneGuide {
  const guide: PhoneGuide = { tab };
  for (const r of rows) {
    const scene = (r[0] ?? "").toString().normalize("NFKC").trim();
    const text = cleanText(r[1]);
    if (!scene || !text || /^場面$|使い方/.test(scene)) continue;
    if (/停止/.test(scene)) guide.aiStopped ??= text;
    else if (/出られ|営業時間内|スタッフ|担当者/.test(scene)) guide.staffAway ??= text;
    else if (/休日|営業時間外|時間外|最初|ガイダンス|あいさつ|挨拶/.test(scene)) guide.offHours ??= text;
  }
  return guide;
}

/** {会社名}・{営業時間} を置き換える */
export function fillGuide(text: string, vars: { company: string; hours: string }): string {
  return text.replace(/\{(?:会社名|company)\}/g, vars.company).replace(/\{営業時間\}/g, vars.hours);
}

/** 文の頭のあいさつ（「お電話ありがとうございます。一畳屋です。」）を除く */
function withoutGreeting(text: string): string {
  return text.replace(/^お電話(?:を)?ありがとうございます。(?:[^。？?]{0,30}です。)?/, "").trim();
}

/** 担当者へおつなぎして出られなかったあと：あいさつの代わりに「お待たせいたしました。」 */
export function afterDialText(text: string): string {
  return `お待たせいたしました。${withoutGreeting(text)}`;
}

/** 担当者へおつなぎして出られなかったあと（AI 停止中）：あいさつの代わりに「申し訳ございません。」 */
export function sorryText(text: string): string {
  return `申し訳ございません。${withoutGreeting(text)}`;
}
