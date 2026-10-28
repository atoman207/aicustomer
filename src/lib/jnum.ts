// 金額の書き方（声の相談）。ブラウザとサーバーの両方で使う
//   声の AI（gpt-realtime）は「13,200円」のような 3桁区切りの数字を、画面の文字は正しいのに声では「13万2千円」と
//   読み違えることがある（2026-10-26 一畳屋様のご指摘）。2026-10-26 の試験（本番と同じ指示で答えを話させ、声を文字起こし）：
//     ・3桁区切り「16,500円」・1.1倍速：答え 24 回中 6 回、声の金額が違った（16,500円 → 16万5千円 など）
//     ・万の位で区切る「1万6500円」・標準の速さ：36 回中 0 回（57 の金額がすべて正しい・画面の文字と声が一致）
//     ・ひらがなの読み「いちまんろくせんごひゃく円」：36 回中 7 回（AI が読みを数字に直すときに取り違える）
//   そのため、声の AI・読み上げに渡す文の金額は万の位で区切り（speakableYen）、画面に出すときは 3桁区切りに戻す（yenDigits）

const AMOUNT = /(\d{1,3}(?:,\d{3})+|\d+)(?:\s*)円/g;

/** 金額の数を万の位で区切った書き方にする（16500 → 1万6500、264000 → 26万4000、5500 → 5500） */
export function manNotation(n: number): string {
  if (!Number.isFinite(n) || n < 10000 || n >= 1e8) return String(n);
  const man = Math.floor(n / 10000);
  const rest = n % 10000;
  return `${man}万${rest ? rest : ""}`;
}

/** 声の AI・読み上げに渡す文：金額（「13,200円」）を万の位で区切った書き方（「1万3200円」）にする */
export function speakableYen(text: string): string {
  return text.normalize("NFKC").replace(AMOUNT, (m, d: string) => {
    const n = Number(d.replace(/,/g, ""));
    return n > 0 && n < 1e8 ? `${manNotation(n)}円` : m;
  });
}

// ---- 声の AI が話した文を画面に出すとき：万の位の書き方・ひらがなの読みを 3桁区切りの数字に戻す ----
const DIGIT = ["", "いち", "に", "さん", "よん", "ご", "ろく", "なな", "はち", "きゅう"];

/** 1〜9999 の読み（百・千の音の変化：さんびゃく・ろっぴゃく・はっぴゃく・さんぜん・はっせん） */
function under10000(n: number): string {
  const th = Math.floor(n / 1000);
  const hu = Math.floor((n % 1000) / 100);
  const te = Math.floor((n % 100) / 10);
  const on = n % 10;
  let s = "";
  if (th) s += th === 1 ? "せん" : th === 3 ? "さんぜん" : th === 8 ? "はっせん" : `${DIGIT[th]}せん`;
  if (hu) s += hu === 1 ? "ひゃく" : hu === 3 ? "さんびゃく" : hu === 6 ? "ろっぴゃく" : hu === 8 ? "はっぴゃく" : `${DIGIT[hu]}ひゃく`;
  if (te) s += te === 1 ? "じゅう" : `${DIGIT[te]}じゅう`;
  if (on) s += DIGIT[on];
  return s;
}

/** 金額の数のひらがなの読み（13200 → いちまんさんぜんにひゃく）。1 億未満。指示の読み方の例・試験に使う */
export function yenReading(n: number): string {
  if (!Number.isFinite(n) || n <= 0 || n >= 1e8) return String(n);
  const man = Math.floor(n / 10000);
  const rest = n % 10000;
  return `${man ? `${under10000(man)}まん` : ""}${rest ? under10000(rest) : ""}`;
}

const KANA_DIGIT: [string, number][] = [
  ["きゅう", 9],
  ["はち", 8],
  ["はっ", 8],
  ["なな", 7],
  ["しち", 7],
  ["ろく", 6],
  ["ろっ", 6],
  ["ご", 5],
  ["よん", 4],
  ["さん", 3],
  ["に", 2],
  ["いち", 1],
  ["いっ", 1],
];
const KANA_UNIT: [string, number][] = [
  ["じゅう", 10],
  ["ひゃく", 100],
  ["びゃく", 100],
  ["ぴゃく", 100],
  ["せん", 1000],
  ["ぜん", 1000],
];

/** ひらがなの読み（いちまんさんぜんにひゃく）を数にする。読めなければ null */
export function parseYenReading(s: string): number | null {
  let i = 0;
  let total = 0;
  let section = 0;
  let digit = 0;
  while (i < s.length) {
    const d = KANA_DIGIT.find(([k]) => s.startsWith(k, i));
    if (d) {
      if (digit) return null;
      digit = d[1];
      i += d[0].length;
      continue;
    }
    const u = KANA_UNIT.find(([k]) => s.startsWith(k, i));
    if (u) {
      section += (digit || 1) * u[1];
      digit = 0;
      i += u[0].length;
      continue;
    }
    if (s.startsWith("まん", i)) {
      total += (section + digit || 1) * 10000;
      section = 0;
      digit = 0;
      i += 2;
      continue;
    }
    return null;
  }
  const n = total + section + digit;
  return n > 0 ? n : null;
}

const MAN_AMOUNT = /(\d{1,4})万(\d{1,3},\d{3}|\d{1,4})?\s*円/g;
/** 区切りのない 4〜7 桁の金額（「1650円」）。3桁区切りに直す */
const PLAIN_AMOUNT = /(?<![\d,.万])(\d{4,7})(?=\s*円)/g;
/** ひらがなの金額（「いちまんさんぜんにひゃく円」。声の AI は「いちまん、さんぜん、にひゃくえん」と区切って書くこともある） */
const READ_AMOUNT = /([いちにさんよごろくなはっしきゅうじひゃくびぴせぜまん]+(?:[、,\s]+[いちにさんよごろくなはっしきゅうじひゃくびぴせぜまん]+)*)\s*(?:円|えん)/g;

/** 漢数字の金額（「四十一万、千四百円」。声の AI がひらがなの言葉の多い指示で話すと、字幕を漢数字で書くことがある） */
const KANJI_AMOUNT = /([〇一二三四五六七八九十百千万]+(?:[、,]\s*[〇一二三四五六七八九十百千万]+)*)\s*円/g;
const KANJI_DIGIT: Record<string, number> = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const KANJI_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** 漢数字（四十一万千四百）を数にする。読めなければ null */
export function parseKanjiNumber(s: string): number | null {
  let total = 0;
  let section = 0;
  let digit = -1;
  for (const c of s) {
    if (c in KANJI_DIGIT) {
      if (digit >= 0) return null;
      digit = KANJI_DIGIT[c];
    } else if (c in KANJI_UNIT) {
      section += (digit >= 0 ? digit : 1) * KANJI_UNIT[c];
      digit = -1;
    } else if (c === "万") {
      total += (section + Math.max(digit, 0) || 1) * 10000;
      section = 0;
      digit = -1;
    } else return null;
  }
  const n = total + section + Math.max(digit, 0);
  return n > 0 ? n : null;
}

/** 画面に出す文：「1万3200円」「いちまんさんぜんにひゃく円」「四十一万、千四百円」を「13,200円」に戻す（文字の相談と同じ書き方） */
export function yenDigits(text: string): string {
  return text
    .replace(KANJI_AMOUNT, (m, k: string) => {
      const n = parseKanjiNumber(k.replace(/[、,\s]+/g, ""));
      return n ? `${n.toLocaleString("ja-JP")}円` : m;
    })
    .replace(MAN_AMOUNT, (m, man: string, rest?: string) => {
      const r = rest ? Number(rest.replace(/,/g, "")) : 0;
      if (r >= 10000) return m;
      return `${(Number(man) * 10000 + r).toLocaleString("ja-JP")}円`;
    })
    .replace(PLAIN_AMOUNT, (d: string) => Number(d).toLocaleString("ja-JP"))
    .replace(READ_AMOUNT, (m, k: string) => {
      // 位（まん・せん・ひゃく・じゅう）のない読み（「ごえん」＝ご縁 など）は金額とみなさない
      if (!/まん|せん|ぜん|ひゃく|びゃく|ぴゃく|じゅう/.test(k)) return m;
      const n = parseYenReading(k.replace(/[、,\s]+/g, ""));
      return n ? `${n.toLocaleString("ja-JP")}円` : m;
    });
}
