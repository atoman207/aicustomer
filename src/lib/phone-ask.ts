// AI電話（Twilio の <Gather>）の聞き取りを、AI が何を伺ったか（問いの種類）に合わせる（2026-11-10。
// 調査「AI電話の音声認識サービス選定」の精度の改善策 2・3・5・6）：
//   ・問いごとのヒント：ご住所を伺うときは市町村名と、わかっていればその市区町村の町名だけ（商品名「さくら」などは入れない）
//   ・お電話番号を伺うときは、電話のボタンでも入力できる（聞き違いが起きない）
//   ・ご住所・お電話番号は、言葉の途中の間で締めないように、話し終わりの待ち時間を長めに
//   ・復唱の読み上げは、町名（と「町」「村」で終わる市区町村）を読み方のひらがなで（Amazon Polly が漢字を別の読みで読まないように）
import { lookupAddress, PLACE_CITIES } from "./gazetteer";
import { TOWN_NAMES } from "./places";
import type { AgentStage } from "./types";

export type AskKind = "consult" | "name" | "address" | "phone" | "dates" | "confirm";

/** 項目を伺う言い方（「…ですね」「…でしょうか」だけの復唱・確認は含まない） */
const ASKING = /お願い|お聞かせ|教えて|伺えます|伺って|おっしゃって|いただけ|ございますか|ありますか/;
/** 聞き取った内容の復唱・確認 */
const READBACK = /ですね|よろしい|お間違い|末尾|下4桁/;

/** 最後の問いの文（問いのあとに「ご指定がなければ、そのように承ります。」のような添え書きがあれば、その前の問い） */
function lastSentence(reply: string): string {
  const parts = reply
    .normalize("NFKC")
    .split(/(?<=[。?？!！])|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const question = [...parts].reverse().find((s) => /[?？]$|でしょうか|ますか|ですか|ございますか/.test(s) || ASKING.test(s));
  return question ?? parts[parts.length - 1] ?? "";
}

/** AI の発話の最後の問いが、何を伺っているか */
export function askKind(reply: string, stage: AgentStage): AskKind {
  const last = lastSentence(reply);
  if (!last) return "consult";
  // 「末尾…の番号へ折り返してよろしいでしょうか」「…ですね、よろしいでしょうか」は、はい・いいえの確認。
  // 「いつがよろしいでしょうか」「どちらの日が…」のような問いは、はい・いいえではない
  const open = /いつ|どちら|どの[日時]|何日|何時|何曜/.test(last);
  const asks = (ASKING.test(last) || open) && !/ですね|お間違い|末尾|下4桁/.test(last) && (open || !READBACK.test(last));
  if (asks && /(電話番号|ご連絡先)/.test(last)) return "phone";
  if (asks && /(ご住所|市町村名|町名|番地)/.test(last)) return "address";
  if (asks && /お名前/.test(last)) return "name";
  if (asks && /(希望日|希望の日|第[123]希望|日にち)/.test(last)) return "dates";
  if (stage !== "consult" && /[?？]$|でしょうか$|ですか$|ですね$|ましょうか$/.test(last)) return "confirm";
  return "consult";
}

/** ご相談の問い：品物・作業・商品の言葉（市町村名は入れない。ご住所の問いで使う） */
const CONSULT_HINTS = [
  "一畳屋", "畳", "たたみ", "表替え", "裏返し", "新調", "張替え", "琉球畳", "へり無し", "和紙表", "畳床", "襖", "ふすま", "障子", "網戸", "アミ戸",
  "クロス", "壁紙", "見積", "お見積り", "無料", "訪問", "料金", "何枚", "何畳", "四畳半", "六畳", "八畳", "古都", "さくら", "やすらぎ", "きずな",
  "なごみ", "めぐみ", "極み", "はい", "いいえ",
];
const DATE_HINTS = [
  "午前", "午後", "指定なし", "いつでも", "今週", "来週", "再来週", "明日", "あさって", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日", "日曜日",
  "第2希望", "第3希望", "特にありません", "ありません",
];
const CONFIRM_HINTS = ["はい", "いいえ", "違います", "そうです", "大丈夫です", "お願いします", "結構です"];

/** 市区町村名（熊本市は区と市の両方） */
const CITY_HINTS = [...new Set(["熊本市", ...PLACE_CITIES.map((c) => (c.county ? c.name.slice(c.county.length) : c.name)), ...PLACE_CITIES.map((c) => c.name)])];

/**
 * 問いに合わせたヒント（Twilio の hints。上限 500 件 × 100 字。Deepgram は少ないほうがよいので max で絞る）。
 * ご住所：市区町村名と、わかっている市区町村の町名（わからなければ、よく出る町名）
 */
export function hintsFor(kind: AskKind, address: string | undefined, max = 300): string[] {
  let list: string[];
  switch (kind) {
    case "name":
    case "phone":
      return [];
    case "dates":
      list = DATE_HINTS;
      break;
    case "confirm":
      list = CONFIRM_HINTS;
      break;
    case "address": {
      const l = address?.trim() ? lookupAddress(address) : null;
      const towns = l?.cities.length ? l.cities.flatMap((c) => c.towns.map(([t]) => t)) : TOWN_NAMES;
      // 町名を先に（市区町村がわかっていれば、町名の聞き違いを防ぐのがいちばん効く）
      list = l?.cities.length ? [...towns, ...CITY_HINTS] : [...CITY_HINTS, ...towns];
      break;
    }
    default:
      list = CONSULT_HINTS;
  }
  return [...new Set(list.map((h) => h.replace(/,/g, "").slice(0, 100)).filter(Boolean))].slice(0, Math.max(0, max));
}

/** 電話のボタンでの入力のご案内（お電話番号を伺うとき、1 通話に 1 回） */
export const KEYPAD_HINT = "電話のボタンで押して、最後にシャープを押していただいても結構です。";

/** 「づ」「ぢ」は、お客様の言う音のとおり「ず」「じ」で読む（江津＝えず） */
const sameSound = (s: string) => s.replace(/づ/g, "ず").replace(/ぢ/g, "じ");

/**
 * 読み上げ用：発話の中のご住所の町名（と「町」「村」で終わる市区町村名）を、一覧の読みのひらがなにする。
 * 画面・会話の記録は漢字のまま（読み上げる文だけ）。一覧にない町名はそのまま
 */
export function townsToKana(text: string, address: string | undefined): string {
  if (!address?.trim() || !text) return text;
  const l = lookupAddress(address);
  let out = text;
  const city = l.cities.length === 1 ? l.cities[0] : undefined;
  // 「菊陽町（きくようまち）」を「きくようちょう」と読まないように（市・区は読み違えにくいので漢字のまま）
  if (city && /[町村]$/.test(city.name) && out.includes(city.name)) out = out.split(city.name).join(city.kana);
  if (l.town && l.town.town.length >= 2 && out.includes(l.town.town)) out = out.split(l.town.town).join(sameSound(l.town.kana));
  return out;
}

/** 発話の中のご住所を、直したご住所に置き換える（全体が見つからなければ、町名の部分だけ） */
export function replaceAddressText(text: string, from: string, to: string): string {
  if (!from || from === to) return text;
  if (text.includes(from)) return text.split(from).join(to);
  const a = lookupAddress(from);
  const b = lookupAddress(to);
  if (a.head && b.town && a.head !== b.town.town && text.includes(a.head)) return text.split(a.head).join(b.town.town);
  return text;
}
