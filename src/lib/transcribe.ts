// 声の相談の文字起こしの後始末（サーバー・ブラウザ共通）
import { PLACE_HINT } from "./places";

/**
 * 以前、文字起こしに渡していた言葉の手がかり（2026-10-22 まで）。いまは渡していないが、
 * 雑音のときに文字起こしがこの文をなぞって返した行が、保存された会話に残っていることがあるため照合に使う
 */
export const TRANSCRIBE_PROMPT = "一畳屋への畳・襖・障子・網戸のご相談。表替え、新調、裏返し、ヘリ、天袋、地袋、張替え、見積、熊本。";

/** いまの文字起こしの手がかり（熊本の地名。places.ts） */
export const TRANSCRIBE_HINT = PLACE_HINT;

const norm = (s: string) => s.normalize("NFKC").replace(/[\s、。・,.!?！？「」（）()]/g, "");

/**
 * 文字起こしが手がかりの文をなぞっただけか（雑音・物音のときに、文字起こしのモデルが手がかりの文をそのまま返すことがある）。
 * そのまま会話に残すと、お客様が言っていない「襖・障子・網戸」や地名が見積の計算や文字の相談に入ってしまう
 */
export function isPromptEcho(text: string): boolean {
  const t = norm(text);
  if (t.length < 6) return false;
  const pairs = Array.from({ length: t.length - 1 }, (_, i) => t.slice(i, i + 2));
  const ratio = (p: string) => pairs.filter((x) => p.includes(x)).length / pairs.length;
  // 以前の手がかりの文：そのまま含まれるか、ほとんど（2 文字ずつの並びの 85% 以上）が手がかりの文の言葉
  const old = norm(TRANSCRIBE_PROMPT);
  if (old.includes(t) || (t.length >= 10 && ratio(old) >= 0.85)) return true;
  // 地名の手がかり：お客様は「熊本市中央区」「菊池郡菊陽町」のように地名だけを答えることがあるので、
  // 地名がいくつも並んだ長い文（手がかりの文をなぞったもの）だけを手がかりの文とみなす
  const hint = norm(TRANSCRIBE_HINT);
  return t.length >= 16 && ratio(hint) >= 0.9;
}
