// 「○○町は来てもらえますか？」に、顧客対応マニュアルの営業範囲から直接答える（OpenAI を使わない）
//   営業範囲は「熊本市・菊池郡・…」のように市と郡で書かれているため、郡に属する町村は下の対応表で判定する

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
