// 熊本県の全市町村と大牟田市の町名（大字・町）と読み方（database/places.json。scripts/build-places.mjs で作る）。
// ご住所の町名の漢字を確かめる（一畳屋様のご要望 2026-10-28：声の聞き取りで「玉名市岱明町（たいめいまち）」が
// 「玉名市大名町」になる。熊本県と大牟田市の町名の漢字と読み方を覚えさせて、正しく聞き取らせたい）
//   ・lookupAddress：住所の市区町村と町名が一覧にあるか。なければ、その市区町村の町名を読みの近い順に返す
//   ・placeHintForLive：声の AI（GPT-Live）の指示に入れる市町村と旧町名の読み方（短い一覧）
import places from "../../database/places.json";

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

/** 読みを比べるための形（ひらがな・小さい字と濁点を区別しない・長音を除く） */
const SMALL: Record<string, string> = { ぁ: "あ", ぃ: "い", ぅ: "う", ぇ: "え", ぉ: "お", っ: "つ", ゃ: "や", ゅ: "ゆ", ょ: "よ", ゎ: "わ" };
export function kanaKey(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
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
function kanaSimilarity(heard: string, kana: string): number {
  const a = kanaKey(heard);
  const b = kanaKey(kana);
  if (!a || !b) return 0;
  const whole = 1 - distance(a, b) / Math.max(a.length, b.length);
  const head = b.length > a.length ? 1 - distance(a, b.slice(0, a.length)) / a.length - 0.05 : 0;
  return Math.max(whole, head);
}

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
    if (c.ward) add(c.city, c); // 「熊本市坪井」：区を言わなかった
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
}

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
  const rank = (list: AddressCandidate[], head: string) =>
    list
      .map((t) => ({ t, score: Math.max(reading ? kanaSimilarity(reading, t.kana) : 0, charSimilarity(head, norm(t.town)) * 0.9) }))
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
    return { ...empty, status: "ok", cities: ck.cities, cityText: ck.key, town, head: rest.slice(0, rest.length - tail.length), tail };
  }
  const [head, tail] = splitHead(rest);
  // 町名なしで番地だけ（「合志市3415」）は確かめようがないのでそのまま
  if (!head) return { ...empty, status: "ok", cities: ck.cities, cityText: ck.key, tail };
  return { ...empty, status: "town_unknown", cities: ck.cities, cityText: ck.key, head, tail, candidates: rank(list, head) };
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

/**
 * 声の AI の check_address の結果（/api/address/check）。一覧にあればその町名と読み、なければ市区町村の町名を読みの近い順に、
 * 委任先のモデルがそのまま使える案内（note）を付けて返す
 */
export function checkAddress(address: string, reading = ""): Record<string, string> {
  const l = lookupAddress(address, reading);
  const city = l.cities.map((c) => `${c.name}（${c.kana}）`).join("・");
  if (l.status === "ok") {
    return {
      status: "ok",
      address,
      ...(city ? { city } : {}),
      ...(l.town ? { town: `${l.town.town}（${l.town.kana}）` } : {}),
      note: "町名は熊本県・大牟田市の町名の一覧にあります。この住所（町名の漢字と読み方）のとおりに復唱してください。",
    };
  }
  if (l.status === "town_unknown") {
    return {
      status: "town_unknown",
      address,
      city,
      heard_town: l.head,
      towns: formatTowns(l.candidates, l.cities.length > 1),
      note: `「${l.head}」という町名は${l.cities.map((c) => c.name).join("・")}にありません（聞き違いの可能性が高い）。お客様の発音に合う町名を towns から1つ選び、町名をその漢字に置き換えた住所で復唱してください（番地は変えない）。合う町名がなければ、町名をもう一度伺ってください。`,
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
