// 「○○町は来てもらえますか？」に、顧客対応マニュアルの営業範囲から直接答える（OpenAI を使わない）
//   営業範囲は「熊本市・菊池郡・…」のように市と郡で書かれているため、郡に属する町村は下の対応表で判定する
// 見積依頼のご住所が営業エリアの外か（areaOf。一畳屋様のご指摘 2026-10-30「なにもことわらずに営業エリア外の住所をこたえたら、
//   配送費のことを説明せずに受け付けた」）：エリアの外のご住所では、配送費が別途かかることを必ず伝える
//   （文字の相談の聞き取り・声の相談の check_address・電話/LINE・確認画面）
import { PLACE_CITIES, lookupAddress, type PlaceCity } from "./gazetteer";

/** 熊本県の市町村（郡ごと）と近隣の市。地理的な事実のみ */
const GUN: Record<string, string[]> = {
  下益城郡: ["美里町"],
  玉名郡: ["玉東町", "南関町", "長洲町", "和水町"],
  菊池郡: ["大津町", "菊陽町"],
  阿蘇郡: ["南小国町", "小国町", "産山村", "高森町", "南阿蘇村", "西原村"],
  上益城郡: ["御船町", "嘉島町", "益城町", "甲佐町", "山都町"],
  八代郡: ["氷川町"],
  葦北郡: ["芦北町", "津奈木町"],
  球磨郡: ["錦町", "あさぎり町", "多良木町", "湯前町", "水上村", "相良村", "五木村", "山江村", "球磨村"],
  天草郡: ["苓北町"],
};
const CITIES = ["熊本市", "八代市", "人吉市", "荒尾市", "水俣市", "玉名市", "山鹿市", "菊池市", "宇土市", "上天草市", "宇城市", "阿蘇市", "天草市", "合志市"];
const NEARBY = ["大牟田市", "みやま市", "柳川市", "久留米市", "筑後市", "八女市"];
const WARDS = ["中央区", "東区", "西区", "南区", "北区"];

interface Place {
  name: string;
  gun?: string;
  stem: string;
}

const PLACES: Place[] = (() => {
  const list: Place[] = [];
  const stem = (n: string) => n.replace(/(市|町|村|郡)$/, "");
  for (const c of [...CITIES, ...NEARBY]) list.push({ name: c, stem: stem(c) });
  for (const [g, towns] of Object.entries(GUN)) {
    list.push({ name: g, stem: stem(g) });
    for (const t of towns) list.push({ name: t, gun: g, stem: stem(t) });
  }
  // 長い名前から照合（「南小国」を「小国」より先に）
  return list.sort((a, b) => b.stem.length - a.stem.length);
})();

const AREA_INTENT = /(来て|来れ|来られ|行って|伺|対応|エリア|範囲|出張|お願いでき|頼め|大丈夫|可能|いけ|行け|まで来|も来|見積|工事でき|施工でき)/;

export interface AreaAnswer {
  reply: string;
  place: string;
  inArea: boolean;
}

/** マニュアルの文章から営業範囲の行と、エリア外の注記を取り出す */
export function areaFromManual(text: string): { areas: string[]; outside: string } | null {
  const m = text.match(/営業範囲\s*[：:]?\s*([^\n]+)/);
  if (!m) return null;
  const areas = m[1]
    .replace(/（[^）]*）|\([^)]*\)/g, "")
    .split(/[・、,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const o = text.match(/(エリア外[^\n]*)/);
  return { areas, outside: o ? o[1].replace(/※/g, "。").replace(/。+/g, "。").trim() : "" };
}

export function answerArea(question: string, manualText: string): AreaAnswer | null {
  const q = question.normalize("NFKC").replace(/\s+/g, "");
  // 「玉名店の住所は？」のような店舗の質問は対象外
  if (/(店|ショールーム|住所|場所|どこに|地図|行き方)/.test(q)) return null;
  if (!AREA_INTENT.test(q) && !/^[^\s]{2,8}(市|町|村|郡|区)?(は|って|も)?[?？]?$/.test(q)) return null;
  const place = PLACES.find((p) => p.stem.length >= 2 && q.includes(p.stem));
  const ward = WARDS.find((w) => q.includes(`熊本市${w}`) || (q.includes(w) && /熊本/.test(q)));
  if (!place && !ward) return null;
  const area = areaFromManual(manualText);
  if (!area) return null;
  const name = ward ? `熊本市${ward}` : place!.name;
  const covered = ward ? area.areas.includes("熊本市") : area.areas.includes(place!.name) || (place!.gun ? area.areas.includes(place!.gun) : false);
  const where = place?.gun ? `（${place.gun}）` : "";
  if (covered) {
    return { reply: `はい、${name}${where}は当社の営業範囲です。担当者が伺って現地を確認し、お見積り（無料）を提出します。`, place: name, inArea: true };
  }
  // シートの書き方（「ご相談承ります※配送費が別途掛かります（場所による）」）を文として整える
  const outside = area.outside
    ? area.outside
        .replace(/ご相談承ります/, "ご相談を承ります")
        .replace(/\s*※\s*/g, "。")
        .replace(/掛かります/, "かかります")
        .replace(/（場所による）/, "（金額は場所によります）")
    : "エリア外のご依頼は担当者が確認してご案内します";
  return { reply: `${name}${where}は当社の通常の営業範囲外ですが、${outside.replace(/^エリア外でも/, "")}${/。$/.test(outside) ? "" : "。"}`.replace(/、。/g, "。"), place: name, inArea: false };
}

// ---------------- 見積依頼のご住所が営業エリアの外か ----------------

/** 資料に「営業範囲」の行がないときの営業エリア（2026-10-30 の資料のとおり） */
export const DEFAULT_AREA = ["熊本市", "合志市", "菊池市", "菊池郡", "山鹿市", "荒尾市", "玉名市", "玉名郡", "宇土市", "宇城市", "八代市", "上益城郡", "下益城郡", "阿蘇市", "阿蘇郡", "大牟田市"];

/** ナレッジ（資料の項目）から営業範囲の市・郡を読む（「営業範囲　熊本市・合志市・…・大牟田市（福岡）」） */
export function serviceAreaFrom(entries: { title: string; content: string }[]): string[] {
  for (const e of entries) {
    const areas = areaFromManual(`${e.title}\n${e.content}`)?.areas.filter((a) => /[市郡町村]$/.test(a));
    if (areas && areas.length >= 3) return areas;
  }
  return DEFAULT_AREA;
}

/** 熊本県・大牟田市の一覧にない、近くの県のおもな市（都道府県を言わなかったご住所の手がかり） */
const NEARBY_OUTSIDE = /^(?:福岡市|北九州市|久留米市|柳川市|みやま市|筑後市|大川市|八女市|佐賀市|鳥栖市|唐津市|長崎市|佐世保市|諫早市|鹿児島市|出水市|薩摩川内市|宮崎市|延岡市|都城市|大分市|日田市|別府市)/;

export type AreaStatus = "in" | "out" | "unknown";

export interface AreaCheck {
  status: AreaStatus;
  /** 市町村郡を言っていないご住所（町名だけ）。エリアの外と決めつけず、市町村名を伺う */
  cityMissing: boolean;
}

/** 市町村郡を言わなかったお客様に伺う一言（文字の相談・電話/LINE。声の相談は check_address の area_ask） */
export const CITY_ASK_TEXT = "恐れ入ります、ご住所の市町村名（〇〇市・〇〇郡など）も教えていただけますか？";
/** 市町村名と番地の両方がないとき */
export const CITY_NUMBER_ASK_TEXT = "恐れ入ります、ご住所を市町村名から番地まで教えていただけますか？（例：熊本市中央区坪井3丁目5-8）";
/** AI が市町村名を伺った文（2 回は伺わない・次の答えを前のご住所の頭につなげる） */
export const CITY_ASKED = /市町村名/;
/** 確認画面のご住所の欄に出す一言 */
export const CITY_HINT_TEXT = "ご住所は、市町村名（〇〇市・〇〇郡など）からご入力ください。";

const placeNorm = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").replace(/[ヶヵケ]/g, "ケ");

/**
 * 市町村郡を言わなかったご住所の町名がある市町村（一覧の町名で始まる。なければ、一覧の町名の頭の部分を言った
 * 「岱明町123」）。同じ町名がいくつもの市町村にある（「新町」「栄町」）ときは、そのすべて
 */
function townCities(a: string): PlaceCity[] {
  const full = PLACE_CITIES.flatMap((c) => c.towns.filter(([t]) => a.startsWith(placeNorm(t))).map(([t]) => ({ c, n: t.length })));
  if (full.length) {
    const longest = Math.max(...full.map((x) => x.n));
    return [...new Set(full.filter((x) => x.n === longest).map((x) => x.c))];
  }
  const head = a.match(/^(.*?)(?=\d|[一二三四五六七八九十]+丁目|番地|-)/)?.[1] || a;
  if (head.length < 2) return [];
  return PLACE_CITIES.filter((c) => c.towns.some(([t]) => placeNorm(t).startsWith(head)));
}

/**
 * ご住所が営業エリアの中か外か（市区町村がわからなければ unknown。わからないときは「外」と言わない）。
 * 市町村郡を言わずに町名だけのご住所は、その町名がある市町村がすべてエリアの中のときだけ「中」。エリアの外の市町村にも
 * ある町名・一覧にない町名は unknown（町名の一覧は一部の市で欠けているので、町名だけで「外」とは決めない）。
 * 一畳屋様のご指摘 2026-10-31「市町村郡を省略して住所を伝えてきた相談に対して、エリア外と決めつけない。そのあとに続く町名で
 * エリア外かどうか判断するか、市町村郡を教えてもらうよう促す」（EST-20261031-5EMX：町名の頭の 2 文字が球磨郡湯前町の町名と同じで「外」にしていた）
 */
export function areaCheck(address: string, area: string[] = DEFAULT_AREA): AreaCheck {
  const a = placeNorm(address ?? "");
  if (!a) return { status: "unknown", cityMissing: false };
  const inArea = (c: PlaceCity) => area.some((n) => c.city === n || c.county === n || c.name === n || c.name.startsWith(n));
  const l = lookupAddress(a);
  if (l.cities.length) {
    // 郡を言わない町村の名前が、ほかの市の町名でもある（「錦町」＝球磨郡錦町・八代市錦町）：どちらかわからない
    const shortName = !l.town && l.cities.every((c) => c.county) && !/郡/.test(l.cityText);
    const also = shortName ? townCities(a.replace(/^(?:熊本県|福岡県)/, "")).filter((c) => !l.cities.includes(c)) : [];
    if (!also.length) return { status: l.cities.some(inArea) ? "in" : "out", cityMissing: false };
    return { status: [...l.cities, ...also].every(inArea) ? "in" : "unknown", cityMissing: true };
  }
  // 熊本県・福岡県（大牟田市）の外の都道府県
  const pref = a.match(/^(?:北海道|東京都|京都府|大阪府|[一-龯]{2,3}県)/)?.[0];
  if (pref && pref !== "熊本県" && pref !== "福岡県") return { status: "out", cityMissing: false };
  const rest = pref ? a.slice(pref.length) : a;
  if (pref === "福岡県" && !/^大牟田市/.test(rest)) return { status: "out", cityMissing: false };
  if (NEARBY_OUTSIDE.test(rest)) return { status: "out", cityMissing: false };
  // 郡まで言って町村を言わなかった（「菊池郡引水」）：郡で決まる
  const county = PLACE_CITIES.filter((c) => c.county && rest.startsWith(c.county));
  if (county.length) return { status: county.every(inArea) ? "in" : "out", cityMissing: false };
  const cities = townCities(rest);
  return { status: cities.length && cities.every(inArea) ? "in" : "unknown", cityMissing: true };
}

export function areaOf(address: string, area: string[] = DEFAULT_AREA): AreaStatus {
  return areaCheck(address, area).status;
}

/** 市町村名を伺ったときに、市町村名だけを答えた（「玉名市です」「熊本県菊池郡」）：その市町村名。ほかは "" */
export function cityPart(text: string): string {
  const s = placeNorm(text ?? "").replace(/(?:です|でした|になります|と申します)?[。.!！]*$/, "");
  if (!s) return "";
  const county = s.replace(/^熊本県/, "");
  if (PLACE_CITIES.some((c) => c.county && c.county === county)) return s;
  const l = lookupAddress(s);
  return l.status === "ok" && l.cities.length && !l.town && !l.head && !l.tail ? `${l.pref}${l.cityText}` : "";
}

/** 前のご住所（市町村郡なし）の頭に、あとから伺った市町村名をつなげる */
export function joinCity(city: string, address: string): string {
  const pref = address.match(/^(?:熊本県|福岡県)/)?.[0] ?? "";
  const rest = address.slice(pref.length);
  return `${city.startsWith(pref) ? "" : pref}${city}${rest}`;
}

/** エリアの外のときに、お客様に伝える一言（市区町村がわかれば、その名前を添える） */
export function outOfAreaNote(address: string): string {
  const l = lookupAddress((address ?? "").normalize("NFKC").replace(/\s+/g, ""));
  const where = l.cities[0]?.name ?? "";
  return `${where ? `${where}は` : "ご住所は"}当社の営業エリアの外ですが、ご相談はお受けしております。営業エリア外のため、別途、配送費がかかります（場所によります）。`;
}
