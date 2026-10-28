// 声の AI の読み方。ブラウザとサーバーの両方で使う
//   一畳屋様のご指摘 2026-10-28：声の相談で「承る」を「しょる」、「畳床」を「たたみゆか」（正しくは たたみどこ）、
//   「見積り」を「けんつもり」と読むことがある。2026-10-28 の試験（声の AI に決まった答えを話させ、声を文字起こし）でも、
//   「承っております」→「お尋ねております」、「戸車」→「トクレナ」、「表替え」→「おもべ替え」と読み違えた。
//   そのため、声の AI に渡す文（声の AI とバックエンドの指示・search_knowledge の答え）では、読み間違えやすい言葉をひらがなにする
//   （speakableWords）。スプレッドシートに一畳屋様が書いた読み方の一覧（「畳床（たたみどこ）　七島（しっとう）…」）も使う
//   （parseReadings）。画面に出す字幕は、ここで決めた言葉だけ漢字に戻す（captionWords）

/** [言葉, 読み（ひらがな・カタカナ）] */
export type Reading = [string, string];

/** いつもひらがなにする言葉（読み間違いが起きた・起きやすい言葉。長いものから当てる） */
const BASE: Reading[] = [
  ["お見積もり", "おみつもり"],
  ["お見積り", "おみつもり"],
  ["見積もり", "みつもり"],
  ["見積り", "みつもり"],
  ["見積", "みつもり"],
  ["一畳屋", "いちじょうや"],
  ["畳床", "たたみどこ"],
  ["畳表", "たたみおもて"],
  ["表替え", "おもてがえ"],
  ["表替", "おもてがえ"],
  ["戸車", "とぐるま"],
  ["諸経費", "しょけいひ"],
  ["引手", "ひきて"],
  ["引き手", "ひきて"],
  ["押入れ", "おしいれ"],
  ["押し入れ", "おしいれ"],
  ["張替え", "はりかえ"],
  ["張り替え", "はりかえ"],
];

/** 「承る」「承ります」「承っております」（「承知」はそのまま） */
const UKETAMAWARU = /承(?=[りるっれろらわ])/g;

/** 字幕で漢字に戻す読み（3 文字以上で、ほかの言葉と取り違えないもの） */
const CAPTION: [RegExp, string][] = [
  [/おみつもり/g, "お見積り"],
  [/みつもり/g, "見積り"],
  [/うけたまわ(?=[りるっれろらわ])/g, "承"],
  [/たたみどこ/g, "畳床"],
  [/たたみおもて/g, "畳表"],
  [/おもてがえ/g, "表替え"],
  [/とぐるま/g, "戸車"],
  [/しょけいひ/g, "諸経費"],
  [/いちじょうや/g, "一畳屋"],
  [/ふすま/g, "襖"],
  [/しょうじ/g, "障子"],
  [/ぜいこみ/g, "税込み"],
  [/べっと/g, "別途"],
];

/** スプレッドシートの読み方のうち、字幕で漢字に戻すもの（4 文字以上の読み。「おおめ」（多め）のような短い読みはほかの言葉と取り違えるので戻さない） */
const CAPTION_MIN_KANA = 4;

const KANA = /^[ぁ-ゖァ-ヺー]+$/;
const PAIR = /([^\s　・、，,。：:（）()「」『』]{1,12})[（(]([ぁ-ゖァ-ヺー]{1,20})[)）]/g;

/**
 * 読み方の一覧の行から [言葉, 読み] を読む。「畳床（たたみどこ）　七島（しっとう）」のように「言葉（読み）」が 4 つ以上並び、
 * ほかの文がほとんどない行だけ（「極み（ひのみどり）：30年」のような、かっこの中が品種などの行は使わない）
 */
export function parseReadings(text: string): Reading[] {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const pairs = [...line.matchAll(PAIR)];
    if (pairs.length < 4) continue;
    const rest = line.replace(PAIR, "").replace(/[\s　・、，,。：:※*＊\-ー]/g, "");
    if (rest.length > Math.max(4, line.length * 0.1)) continue;
    for (const [, word, kana] of pairs) {
      if (KANA.test(word) || word.length < 2) continue; // ひらがなだけ・1 文字の言葉（「浮」「燦」）はほかの言葉の中にも出るので使わない
      if (!out.has(word)) out.set(word, kana);
    }
  }
  return [...out.entries()];
}

/** 言葉を読みに置き換える（「税込み」の「み」のように、読みの終わりと同じ送り仮名が続けば一緒に置き換える） */
function replaceWord(text: string, word: string, kana: string): string {
  let out = "";
  let i = 0;
  for (;;) {
    const j = text.indexOf(word, i);
    if (j < 0) return out + text.slice(i);
    let end = j + word.length;
    for (const k of [2, 1]) {
      const next = text.slice(end, end + k);
      if (next.length === k && KANA.test(next) && kana.endsWith(next)) {
        end += k;
        break;
      }
    }
    out += text.slice(i, j) + kana;
    i = end;
  }
}

/** 声の AI に渡す文：読み間違えやすい言葉をひらがなにする（readings はスプレッドシートの読み方の一覧） */
export function speakableWords(text: string, readings: Reading[] = []): string {
  const all = [...readings, ...BASE].sort((a, b) => b[0].length - a[0].length);
  const seen = new Set<string>();
  let s = text.replace(UKETAMAWARU, "うけたまわ");
  for (const [word, kana] of all) {
    if (seen.has(word)) continue;
    seen.add(word);
    if (s.includes(word)) s = replaceWord(s, word, kana);
  }
  return s;
}

/** 画面に出す字幕：ひらがなにした言葉を漢字に戻す（声の AI がひらがなのまま書いたとき。readings はスプレッドシートの読み方の一覧） */
export function captionWords(text: string, readings: Reading[] = []): string {
  let s = CAPTION.reduce((acc, [re, word]) => acc.replace(re, word), text);
  for (const [word, kana] of [...readings].sort((a, b) => b[1].length - a[1].length)) {
    if (kana.length >= CAPTION_MIN_KANA && s.includes(kana)) s = s.split(kana).join(word);
  }
  return s;
}

/** 声の AI の指示に入れる読み方の一覧（「畳床＝たたみどこ、七島＝しっとう」） */
export function readingsLine(readings: Reading[]): string {
  return readings.map(([w, k]) => `${w}＝${k}`).join("、");
}
