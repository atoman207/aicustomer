// 熊本県の全市町村と大牟田市の町名（大字・町）と読み方（database/places.json。scripts/build-places.mjs で作る）。
// ご住所の町名の漢字を確かめる（一畳屋様のご要望 2026-10-28：声の聞き取りで「玉名市岱明町（たいめいまち）」が
// 「玉名市大名町」になる。熊本県と大牟田市の町名の漢字と読み方を覚えさせて、正しく聞き取らせたい）
//   ・lookupAddress：住所の市区町村と町名が一覧にあるか。なければ、その市区町村の町名を読みの近い順に返す
//   ・placeHintForLive：声の AI（GPT-Live）の指示に入れる市町村と旧町名の読み方（短い一覧）
import places from "../../database/places.json";
import { banchiReading, parseKanjiNumber } from "./jnum";

export interface PlaceCity {
  pref: string;
  /** 郡・市・区まで（「玉名郡長洲町」「熊本市中央区」） */
  name: string;
  county: string;
  city: string;
  ward: string;
  /** 読み（ひらがな） */
  kana: string;
  /** [町名, 読み] */
  towns: [string, string][];
}

export const PLACE_CITIES = places.cities as PlaceCity[];
export const PLACE_SOURCE = places.source;

/** 表記ゆれをそろえる（全角数字・空白・「ヶ」「ケ」） */
function norm(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, "").replace(/[ヶヵケ]/g, "ケ");
}

/**
 * 「づ」と「ず」、「ぢ」と「じ」は同じ音（一畳屋様のご指摘 2026-11-10：「東区えず2丁目」と伝えても「えず東2丁目」と確かめた。
 * 江津の読みは一覧では「えづ」で、お客様の「えず」と合わず、頭の音が同じ画図東（えずひがし）のほうが近いとしていた）
 */
const sameSound = (s: string) => s.replace(/づ/g, "ず").replace(/ぢ/g, "じ");
const hiragana = (s: string) => s.normalize("NFKC").replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** 読みがぴったり同じか比べる形（濁点は区別する。「づ」「ず」は同じ・長音と区切りを除く） */
function readingKey(s: string): string {
  return sameSound(hiragana(s)).replace(/[ー\s・、。]/g, "");
}

/** 読みを比べるための形（ひらがな・小さい字と濁点を区別しない・長音を除く） */
const SMALL: Record<string, string> = { ぁ: "あ", ぃ: "い", ぅ: "う", ぇ: "え", ぉ: "お", っ: "つ", ゃ: "や", ゅ: "ゆ", ょ: "よ", ゎ: "わ" };
export function kanaKey(s: string): string {
  return sameSound(hiragana(s))
    .normalize("NFD")
    .replace(/[゙゚]/g, "")
    .normalize("NFC")
    .replace(/[ぁぃぅぇぉっゃゅょゎ]/g, (c) => SMALL[c])
    .replace(/[ー\s・、。]/g, "");
}

function distance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** 読みの近さ（0〜1）。聞いた読みが町名の先頭だけ（「たいめい」）でも近いとみなす */
export function kanaSimilarity(heard: string, kana: string): number {
  const a = kanaKey(heard);
  const b = kanaKey(kana);
  if (!a || !b) return 0;
  const whole = 1 - distance(a, b) / Math.max(a.length, b.length);
  const head = b.length > a.length ? 1 - distance(a, b.slice(0, a.length)) / a.length - 0.05 : 0;
  return Math.max(whole, head);
}

/**
 * 聞いた読みが幾通りかあるとき（「こうやままち・たかやままち」）の、いちばん近い読みの近さ。文字起こしの漢字が聞き違いで
 * （「紺屋町（こうやまち）」が「高山町」）、その漢字の読みが幾通りもあるため（一畳屋様のご指摘 2026-11-02「こうやま→大山・たかやま」）
 */
export function readingSimilarity(readings: string, kana: string): number {
  return Math.max(0, ...readings.split(/[・、,，/／|｜\s]+/).filter(Boolean).map((r) => kanaSimilarity(r, kana)));
}

/** 町名の候補のうち、読みがとても近いもの（お客様に「〇〇町（よみ）でしょうか」と確かめる候補） */
const LIKELY_SIMILARITY = 0.75;

/** 漢字の重なり（0〜1） */
function charSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const set = new Set([...b]);
  const shared = [...a].filter((c) => set.has(c)).length;
  return shared / Math.max(a.length, b.length);
}

interface CityKey {
  key: string;
  cities: PlaceCity[];
}

/** 市区町村の書き方（「玉名郡長洲町」「長洲町」「熊本市中央区」「熊本市」）。長いものから当てる */
const CITY_KEYS: CityKey[] = (() => {
  const map = new Map<string, PlaceCity[]>();
  const add = (key: string, c: PlaceCity) => map.set(norm(key), [...(map.get(norm(key)) ?? []), c]);
  for (const c of PLACE_CITIES) {
    add(c.name, c);
    if (c.county) add(`${c.city}${c.ward}`, c);
    if (c.ward) {
      add(c.city, c); // 「熊本市坪井」：区を言わなかった
      add(c.ward, c); // 「中央区坪井」：市を言わなかった
    }
  }
  return [...map.entries()].map(([key, cities]) => ({ key, cities })).sort((a, b) => b.key.length - a.key.length);
})();

const PREF = /^(?:熊本県|福岡県)/;

export type AddressStatus = "ok" | "town_unknown" | "city_unknown" | "empty";

export interface AddressCandidate {
  city: string;
  town: string;
  kana: string;
}

export interface AddressLookup {
  status: AddressStatus;
  /** 当てた市区町村（「熊本市」だけのときは区の一覧） */
  cities: PlaceCity[];
  /** 住所のうち、市区町村の部分（入力のまま） */
  cityText: string;
  /** 一覧にあった町名 */
  town?: AddressCandidate;
  /** 町名の部分（番地より前。一覧になかったときの聞き取ったままの町名） */
  head: string;
  /** 町名より後ろ（番地など） */
  tail: string;
  /** 都道府県（入力にあったときだけ） */
  pref: string;
  /** 一覧になかったとき：読み・漢字の近い順の町名（その市区町村のもの。市区町村もわからなければ全体から） */
  candidates: AddressCandidate[];
  /** 市区町村を直したとき（「玉名市中央区坪井」→ 熊本市中央区）：直した住所と、直す前の市区町村 */
  corrected?: { address: string; fromCity: string };
  /** 町名が一覧になかったとき：その町名がある、ほかの市区町村（市区町村の聞き違いの手がかり） */
  elsewhere?: AddressCandidate[];
  /**
   * 町名がひらがな・カタカナ（「えず2丁目」）か、一覧の町名の頭の部分だけ（「画図2丁目」）で、読みのぴったり合う町名が 1 つだけあった
   * （→ 江津）：その町名にした住所と、もとの町名
   */
  fixedTown?: { address: string; from: string };
}

/** 町名の部分が、ひらがな・カタカナだけ（音声認識が漢字にできなかった町名） */
const KANA_HEAD = /^[ぁ-ゖァ-ヺー]{2,}$/;

/** 熊本市の区（「玉名市中央区」のように、ほかの市の後ろに区が付いたら、熊本市の区の聞き違い） */
const KUMAMOTO_WARD = /^(中央|東|西|南|北)区/;

/** 番地より前（町名の部分）。「3415の11」「3丁目」「1-2-3」「番地」から後ろは番地 */
function splitHead(rest: string): [string, string] {
  const m = rest.match(/^(.*?)(?=\d|[一二三四五六七八九十]+丁目|番地|-)/);
  if (!m || !m[1]) return /^\d/.test(rest) ? ["", rest] : [rest, ""];
  return [m[1], rest.slice(m[1].length)];
}

function townsOf(cities: PlaceCity[]): AddressCandidate[] {
  return cities.flatMap((c) => c.towns.map(([town, kana]) => ({ city: c.name, town, kana })));
}

function commonPrefix(list: string[]): string {
  return list.reduce((p, s) => {
    let i = 0;
    while (i < p.length && i < s.length && p[i] === s[i]) i++;
    return p.slice(0, i);
  });
}

/**
 * 町名の部分に合う町名。一覧の町名で始まる（長い町名を先に当てる）か、一覧の町名の頭の部分だけを言った
 * （「岱明町123」：岱明町扇崎・岱明町大野下… の「岱明町」。読みはそれらの読みの共通の頭）
 */
function findTown(rest: string, list: AddressCandidate[]): AddressCandidate | undefined {
  const sorted = [...list].sort((a, b) => b.town.length - a.town.length);
  const full = sorted.find((t) => rest.startsWith(norm(t.town)));
  if (full) return full;
  const [head] = splitHead(rest);
  if (head.length < 2) return undefined;
  const part = sorted.filter((t) => norm(t.town).startsWith(head));
  if (!part.length) return undefined;
  return part.length === 1 ? part[0] : { city: part[0].city, town: head, kana: commonPrefix(part.map((t) => t.kana)) };
}

/**
 * ご住所の市区町村と町名が、熊本県・大牟田市の町名の一覧にあるかを確かめる。
 * reading：お客様が言った町名の読み（ひらがな。わかるとき）。一覧にない町名の候補を読みの近い順に並べるのに使う
 */
export function lookupAddress(address: string, reading = "", limit = 250): AddressLookup {
  const s0 = norm(address);
  const pref = s0.match(PREF)?.[0] ?? "";
  const s = s0.slice(pref.length);
  const empty: AddressLookup = { status: "empty", cities: [], cityText: "", head: "", tail: "", pref, candidates: [] };
  if (!s) return empty;
  const ck = CITY_KEYS.find((k) => s.startsWith(k.key));
  // 「玉名市中央区坪井」：熊本市のほかに区はないので、区の前の市は聞き違い（熊本市のその区の住所に直す）
  const ward = ck && !ck.cities.some((c) => c.ward) ? s.slice(ck.key.length).match(KUMAMOTO_WARD) : null;
  if (ck && ward) {
    const address = `${pref}熊本市${s.slice(ck.key.length)}`;
    return { ...lookupAddress(address, reading, limit), corrected: { address, fromCity: ck.key } };
  }
  // 「中央区坪井」：熊本市を足す（区だけの書き方は一覧の中で熊本市だけ）
  if (ck && ck.key.length <= 3 && KUMAMOTO_WARD.test(ck.key)) {
    const address = `${pref}熊本市${s}`;
    return { ...lookupAddress(address, reading, limit), corrected: { address, fromCity: "" } };
  }
  const rank = (list: AddressCandidate[], head: string) =>
    list
      .map((t) => ({ t, score: Math.max(reading ? readingSimilarity(reading, t.kana) : 0, charSimilarity(head, norm(t.town)) * 0.9) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.t);
  if (!ck) {
    // 市区町村を言わなかった（「坪井3丁目」）：町名が一覧にあればそのまま
    const town = findTown(s, townsOf(PLACE_CITIES));
    if (town) {
      const [head, tail] = splitHead(s);
      return { ...empty, status: "ok", town, head, tail };
    }
    const [head, tail] = splitHead(s);
    return { ...empty, status: "city_unknown", head, tail, candidates: rank(townsOf(PLACE_CITIES), head).slice(0, 40) };
  }
  const rest = s.slice(ck.key.length).replace(/^大字/, "");
  const list = townsOf(ck.cities);
  if (!rest) return { ...empty, status: "ok", cities: ck.cities, cityText: ck.key };
  const town = findTown(rest, list);
  if (town) {
    const t = norm(town.town);
    const tail = rest.startsWith(t) ? rest.slice(t.length) : splitHead(rest)[1];
    const found: AddressLookup = { ...empty, status: "ok", cities: ck.cities, cityText: ck.key, town, head: rest.slice(0, rest.length - tail.length), tail };
    // 一覧の町名の頭の部分だけだった（「画図2丁目」：画図東・画図町… の「画図」）。読みのぴったり合う町名がほかに 1 つだけあれば、
    // その町名（江津＝えづ）。お客様の「えず」を音声認識が「画図」と書いた（2026-11-10 の試験。一畳屋様のご指摘「東区えず2丁目」）
    if (!list.some((x) => x.town === town.town)) {
      const same = list.filter((x) => readingKey(x.kana) === readingKey(town.kana));
      if (same.length === 1) {
        const real: AddressLookup = { ...found, town: same[0] };
        return { ...real, fixedTown: { address: replaceTown(real, same[0].town), from: found.head } };
      }
    }
    return found;
  }
  const [head, tail] = splitHead(rest);
  // 町名なしで番地だけ（「合志市3415」）は確かめようがないのでそのまま
  if (!head) return { ...empty, status: "ok", cities: ck.cities, cityText: ck.key, tail };
  // 町名がひらがな（「熊本市東区えず2丁目」）：その市区町村に読みのぴったり合う町名が 1 つだけなら、その町名（江津）の漢字にする
  if (KANA_HEAD.test(head)) {
    const key = readingKey(head);
    const same = list.filter((t) => readingKey(t.kana) === key);
    if (same.length === 1) {
      const found: AddressLookup = { ...empty, status: "ok", cities: ck.cities, cityText: ck.key, town: same[0], head, tail };
      return { ...found, fixedTown: { address: replaceTown(found, same[0].town), from: head } };
    }
  }
  const others = townsOf(PLACE_CITIES.filter((c) => !ck.cities.includes(c)));
  const elsewhere = others.filter((t) => norm(t.town) === head).slice(0, 5);
  return {
    ...empty,
    status: "town_unknown",
    cities: ck.cities,
    cityText: ck.key,
    head,
    tail,
    candidates: rank(list, head),
    ...(elsewhere.length ? { elsewhere } : {}),
  };
}

/** 町名を一覧の町名に置き換えた住所（都道府県・市区町村・番地は入力のまま） */
export function replaceTown(l: AddressLookup, town: string): string {
  return `${l.pref}${l.cityText}${town}${l.tail}`;
}

/** 町名の一覧（「漢字（よみ）」を「、」でつなぐ） */
export function formatTowns(list: AddressCandidate[], withCity = false): string {
  return list.map((t) => `${withCity ? t.city : ""}${t.town}（${t.kana}）`).join("、");
}

/** 市区町村の一覧（「玉名市（たまなし）」） */
export function formatCities(): string {
  return PLACE_CITIES.map((c) => `${c.name}（${c.kana}）`).join("、");
}

/** check_address の結果（caption_words は声の AI には渡さず、ブラウザが字幕を漢字に戻すのに使う） */
export type AddressCheck = { status: string; address: string; caption_words?: [string, string][] } & Record<string, unknown>;

const PREF_KANA: Record<string, string> = { 熊本県: "くまもとけん", 福岡県: "ふくおかけん" };

/**
 * 声で読む住所：都道府県・市区町村・町名をひらがなにする（番地はそのまま。「くまもとしちゅうおうく、こせん、1丁目2の3」）。
 * 一畳屋様のご指摘 2026-11-04：お客様が「こせん」と言い、字幕も「壺川」と正しいのに、声の AI は「つぼかわ」と読んだ
 * （声の AI は漢字を自分の判断で読み、漢字のあとに添えた読みを使わないことがある。2026-11-05 の試験でも再現）
 */
function readAloud(l: AddressLookup, town?: AddressCandidate): string {
  const pick = town ?? l.town;
  const city = (town && l.cities.find((c) => c.name === town.city)) || (l.cities.length === 1 ? l.cities[0] : undefined);
  const cityKana = city?.kana ?? (l.cities.length ? commonPrefix(l.cities.map((c) => c.kana)) : "");
  const head = `${PREF_KANA[l.pref] ?? l.pref}${cityKana}`;
  // 「づ」「ぢ」は、お客様の言う音のとおり「ず」「じ」で読む（江津＝えず）
  return [head, pick?.kana ? sameSound(pick.kana) : l.head, tailReading(l.tail) || l.tail].filter(Boolean).join("、");
}

/**
 * 丁目・番地の読み（「2丁目2」→「にちょうめ、に」）。一畳屋様のご指摘 2026-11-10「番地も含め表記通りに読まないことがある」。
 * 「2」だけのような短い読み（「に」）は、字幕で数字に戻せない（ほかの「に」も変わる）ので、数字のまま
 */
function tailReading(tail: string): string {
  const r = banchiReading(tailDigits(tail));
  return r.replace(/、/g, "").length >= 4 ? r : "";
}

const KANJI_RUN = /[〇一二三四五六七八九十百千]+/g;
const KANJI_ONE: Record<string, string> = { 〇: "0", 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9" };

/**
 * 番地の漢数字を数字にする（音声認識が「江津、二丁目、二」と書いた → 「2丁目2」。確認画面・受付一覧は数字で）。
 * 丁目・番地・号・「の」・「-」だけの書き方のときだけ（建物の名前などがあれば、そのまま）
 */
export function tailDigits(tail: string): string {
  if (!/[〇一二三四五六七八九十百千]/.test(tail)) return tail;
  const t = tail.replace(KANJI_RUN, (k) => {
    const n = parseKanjiNumber(k);
    if (n !== null) return String(n);
    return /^[〇一二三四五六七八九]+$/.test(k) ? [...k].map((c) => KANJI_ONE[c]).join("") : k;
  });
  return banchiReading(t) ? t : tail;
}

/** ご住所の番地の漢数字を数字にした住所（声で伺ったご住所。確認画面に入れる前） */
export function addressTailDigits(address: string): string {
  const l = lookupAddress(address);
  const d = tailDigits(l.tail);
  if (!l.tail || d === l.tail) return address;
  const a = norm(address);
  return a.endsWith(l.tail) ? `${a.slice(0, a.length - l.tail.length)}${d}` : address;
}

/** 字幕で漢字に戻す読み（声で読む住所の、市区町村・町名）。[言葉, 読み] */
function addressWords(l: AddressLookup, towns: (AddressCandidate | undefined)[]): [string, string][] {
  const out: [string, string][] = [];
  for (const c of l.cities) {
    out.push([c.name, c.kana]);
    // 声の AI は「くまもとし中央区」「熊本市ちゅうおうく」のように、半分だけひらがなで書くことがある（2026-11-06 の本番の試験）。
    // 区だけの読み（きたく・にしく）は単独では戻さない（「行きたくない」が「行北区ない」になる）
    if (c.name.startsWith("熊本市") && c.kana.startsWith("くまもとし")) {
      out.push([c.name, `熊本市${c.kana.slice("くまもとし".length)}`], ["熊本市", "くまもとし"]);
    }
  }
  if (PREF_KANA[l.pref]) out.push([l.pref, PREF_KANA[l.pref]]);
  for (const t of towns) if (t) out.push([t.town, t.kana], ...(sameSound(t.kana) !== t.kana ? [[t.town, sameSound(t.kana)] as [string, string]] : []));
  // 丁目・番地の読み（区切りの「、」を書かないこともある）
  const tail = tailReading(l.tail);
  const written = tailDigits(l.tail);
  if (tail) out.push([written, tail], [written, tail.replace(/、/g, "")]);
  return out;
}

/**
 * 声の AI の check_address の結果（/api/address/check）。一覧にあればその町名と読み、なければ市区町村の町名を読みの近い順に、
 * 委任先のモデルがそのまま使える案内（note）を付けて返す
 */
export function checkAddress(address: string, reading = ""): AddressCheck {
  const l = lookupAddress(address, reading);
  const city = l.cities.map((c) => `${c.name}（${c.kana}）`).join("・");
  // 「玉名市中央区坪井」→「熊本市中央区坪井」のように、市区町村を直した
  const fixedCity = l.corrected
    ? `市区町村を「${l.cities.map((c) => c.name).join("・")}」に直しました（${l.corrected.fromCity ? `「${l.corrected.fromCity}」に区はなく、` : ""}区があるのは熊本市だけのため）。`
    : "";
  // 町名がひらがなだった（「えず」）：読みの合う一覧の町名（江津）の漢字にした住所。番地の漢数字（「二丁目二」）は数字に
  const shown = addressTailDigits(l.fixedTown?.address ?? l.corrected?.address ?? address);
  const fixedTown = l.fixedTown && l.town ? `町名「${l.fixedTown.from}」は、一覧の「${l.town.town}（${l.town.kana}）」です。確認画面に入れるご住所は「${shown}」。` : "";
  if (l.status === "ok") {
    return {
      status: "ok",
      address: shown,
      ...(city ? { city } : {}),
      ...(l.town ? { town: `${l.town.town}（${l.town.kana}）` } : {}),
      read_aloud: readAloud(l),
      caption_words: addressWords(l, [l.town]),
      note: `${fixedCity}${fixedTown}町名は熊本県・大牟田市の町名の一覧にあります。復唱は read_aloud のとおり、ひらがなのまま読んでください（漢字・数字を渡すと、別の読みで読むことがあります。丁目・番地の読みも変えない）。`,
    };
  }
  if (l.status === "town_unknown") {
    const other = l.elsewhere?.length
      ? `なお「${l.head}」という町名は${l.elsewhere.map((t) => t.city).join("・")}にあります。市区町村の聞き違いかもしれないので、「${l.elsewhere[0].city}${l.elsewhere[0].town}でしょうか」とお客様に確かめてください。`
      : "";
    // 読みがとても近い町名（「こうやまち」→ 紺屋町）。読みの難しい町名は、文字起こしで別の漢字になりやすい（一畳屋様のご指摘 2026-11-02）
    // いちばん近い読みとほとんど同じ近さのものだけ（読みがぴったりの町名があれば、それだけを確かめる。「えず」は江津（えづ）だけで、
    // 頭の音が同じ画図東（えずひがし）は出さない。一畳屋様のご指摘 2026-11-10）
    const scored = reading ? l.candidates.map((t) => ({ t, s: readingSimilarity(reading, t.kana) })) : [];
    const best = Math.max(0, ...scored.map((x) => x.s));
    const floor = best >= 0.999 ? best - 0.001 : Math.max(LIKELY_SIMILARITY, best - 0.1);
    const likely = scored.filter((x) => x.s >= floor).slice(0, 3).map((x) => x.t);
    const likelyNote = likely.length
      ? `お客様の言った音に近いのは ${formatTowns(likely, l.cities.length > 1)} です。合えば、likely_read_aloud のとおり、ひらがなのまま「${readAloud(l, likely[0])}でしょうか」と確かめてください（漢字を渡さない。文字起こしの漢字の読みで言い直さない）。`
      : "";
    return {
      status: "town_unknown",
      address: shown,
      city,
      heard_town: l.head,
      ...(likely.length ? { likely: formatTowns(likely, l.cities.length > 1), likely_read_aloud: readAloud(l, likely[0]) } : {}),
      caption_words: addressWords(l, likely),
      towns: formatTowns(l.candidates, l.cities.length > 1),
      ...(l.elsewhere?.length ? { elsewhere: formatTowns(l.elsewhere, true) } : {}),
      note: `${fixedCity}「${l.head}」という町名は${l.cities.map((c) => c.name).join("・")}の一覧にありません（聞き違いの可能性が高いので、「${l.head}」のまま復唱しない）。${likelyNote}お客様の発音に合う町名を towns から1つ選び、町名をその漢字に置き換えた住所で、町名の読み方も添えて復唱してください（番地は変えない）。${other}合う町名がなければ、町名をもう一度伺ってください。`,
    };
  }
  return {
    status: l.status === "empty" ? "empty" : "city_unknown",
    address,
    cities: formatCities(),
    ...(l.candidates.length ? { towns: formatTowns(l.candidates, true) } : {}),
    note: "市区町村がわかりません（熊本県・大牟田市の市区町村の一覧にない）。cities から発音に合う市区町村を選べればその住所で復唱し、選べなければ市町村からもう一度伺ってください。熊本県・大牟田市の外のご住所なら、聞き取ったとおりに復唱してください。",
  };
}

/**
 * 声の AI（GPT-Live）の指示に入れる地名の手がかり：熊本県の全市町村と大牟田市の読み方と、
 * 市の中の旧町（「岱明町扇崎」「岱明町大野下」の「岱明町」など、2 つ以上の町名の頭にある「◯◯町」）の読み方
 */
export function placeHintForLive(): string {
  return PLACE_CITIES.map((c) => {
    const groups = new Map<string, { kana: string; n: number }>();
    for (const [town, kana] of c.towns) {
      const m = town.match(/^(.+?[町村])(.+)$/);
      if (!m) continue;
      const k = kana.match(/^(.+?(?:まち|ちょう|むら|そん))/);
      if (!k) continue;
      const g = groups.get(m[1]);
      groups.set(m[1], { kana: g?.kana ?? k[1], n: (g?.n ?? 0) + 1 });
    }
    const old = [...groups.entries()].filter(([, g]) => g.n >= 2).map(([name, g]) => `${name}＝${g.kana}`);
    return `${c.name}＝${c.kana}${old.length ? `（${old.join("・")}）` : ""}`;
  }).join("、");
}
