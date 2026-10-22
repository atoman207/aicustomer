// 声の相談の文字起こしの後始末（サーバー・ブラウザ共通）

/**
 * 以前、文字起こしに渡していた言葉の手がかり（2026-10-22 まで）。いまは渡していないが、
 * 雑音のときに文字起こしがこの文をなぞって返した行が、保存された会話に残っていることがあるため照合に使う
 */
export const TRANSCRIBE_PROMPT = "一畳屋への畳・襖・障子・網戸のご相談。表替え、新調、裏返し、ヘリ、天袋、地袋、張替え、見積、熊本。";

const norm = (s: string) => s.normalize("NFKC").replace(/[\s、。・,.!?！？「」]/g, "");

/**
 * 文字起こしが手がかりの文をなぞっただけか（雑音・物音のときに、文字起こしのモデルが手がかりの文をそのまま返すことがある）。
 * そのまま会話に残すと、お客様が言っていない「襖・障子・網戸」が見積の計算や文字の相談に入ってしまう
 */
export function isPromptEcho(text: string): boolean {
  const t = norm(text);
  if (t.length < 6) return false;
  const p = norm(TRANSCRIBE_PROMPT);
  if (p.includes(t)) return true;
  // ほとんどが手がかりの文の言葉（2 文字ずつの並びの 85% 以上が手がかりの文にある）
  const pairs = Array.from({ length: t.length - 1 }, (_, i) => t.slice(i, i + 2));
  const inPrompt = pairs.filter((x) => p.includes(x)).length;
  return t.length >= 10 && inPrompt / pairs.length >= 0.85;
}
