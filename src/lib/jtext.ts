// 日本語の回答を読みやすく表示するための整形（表示のときだけ。計算や保存する文には使わない）
//   ・表記をそろえる：全角の英数字 → 半角（「８：００」→「8:00」「９６ｃｍ」→「96cm」）、範囲の「～」→「〜」、
//     金額の 3 桁区切り（「2530円」→「2,530円」）、括弧・句読点の前後の余分な空白を取る
//   ・段落に分ける：長い段落は 1〜2 文ずつに分ける（括弧の中では分けない）
//   内容（数字の値・品名）は変えない。ブラウザ（RichText）とサーバーの両方で使う純粋な関数だけ

/** 全角の英数字・記号（英数字のあいだのもの）を半角に、範囲の「～」を「〜」に */
export function normalizeNotation(text: string): string {
  return (
    text
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      // 数字・英字のあいだの全角の「：」「．」「，」「－」（時刻・小数・品番）
      .replace(/(?<=[0-9A-Za-z])[：．，－](?=[0-9A-Za-z])/g, (c) => ({ "：": ":", "．": ".", "，": ",", "－": "-" })[c] ?? c)
      .replace(/(?<=[0-9])％/g, "%")
      .replace(/～/g, "〜")
  );
}

/** 金額の 3 桁区切り（「49500円」「＋36300）」）。年・品番・電話番号には付けない */
export function groupAmounts(text: string): string {
  const comma = (d: string) => Number(d).toLocaleString("en-US");
  return text
    .replace(/(?<![0-9,.\-/])([1-9][0-9]{3,})(?=円)/g, (_, d: string) => comma(d))
    .replace(/(?<=[＋+])([1-9][0-9]{3,})(?=[）)円\s/]|$)/g, (_, d: string) => comma(d));
}

/** 余分な空白（括弧・句読点の前後、「/」のあと、連続する空白） */
export function tidySpaces(text: string): string {
  return text
    .replace(/[ \t　]{2,}/g, " ")
    .replace(/[ \t　]+(?=[、。，．（「『【〔）」』】〕※：])/g, "")
    .replace(/(?<=[（「『【〔、。）」』】〕])[ \t　]+/g, "")
    .replace(/(?<=[぀-ヿ一-鿿々])\/[ \t]+(?=[぀-ヿ一-鿿々])/g, "/");
}

/** 表示用の表記の整形（1 行ずつ。行頭の字下げや箇条書きの記号はそのまま） */
export function polishJa(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const lead = line.match(/^\s*/)?.[0] ?? "";
      return lead + tidySpaces(groupAmounts(normalizeNotation(line.slice(lead.length)))).trimEnd();
    })
    .join("\n");
}

/** 文に分ける（「。」「！」「？」のあと。かぎ括弧・丸括弧の中では分けない） */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    cur += ch;
    if ("「『（(【".includes(ch)) depth++;
    else if ("」』）)】".includes(ch)) depth = Math.max(0, depth - 1);
    else if ("。！？".includes(ch) && depth === 0) {
      out.push(cur);
      cur = "";
    }
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * 長い段落を文ごとの段落に分ける。
 *   ・短い 2 文（合わせて maxChars 字まで）はひとつの段落のまま
 *   ・それより長いときは 1 文ずつの段落に（「はい。」のようなごく短い文は次の文とつなげる）
 */
export function toParagraphs(line: string, maxChars = 70): string[] {
  const sentences = splitSentences(line);
  if (sentences.length <= 1) return [line.trim()];
  if (sentences.length === 2 && line.length <= maxChars) return [line.trim()];
  const out: string[] = [];
  let carry = "";
  for (const s of sentences) {
    const text = carry + s;
    if (text.length < 12 && s !== sentences[sentences.length - 1]) {
      carry = text;
      continue;
    }
    out.push(text);
    carry = "";
  }
  if (carry) out.push(carry);
  return out;
}
