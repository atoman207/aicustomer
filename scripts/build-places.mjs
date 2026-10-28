// 熊本県の全市町村と大牟田市の町名（大字・町）と読み方の一覧 → database/places.json
//   声の相談のご住所の聞き取りで、町名の漢字を確かめるために使う（一畳屋様のご要望 2026-10-28：
//   「玉名市岱明町（たいめいまち）→ 玉名市大名町 と聞き取ってしまう。熊本県と大牟田市の町名の漢字と読み方を学習させて」）
//
//   出典：
//     ・アドレス・ベース・レジストリ（デジタル庁）を加工した Geolonia の住所データ japanese-addresses-v2（CC BY 4.0）
//     ・日本郵便の郵便番号データ（utf_ken_all.csv。https://www.post.japanpost.jp/service/search/zipcode/download/utf-zip.html）
//
//   使い方：node scripts/build-places.mjs [utf_ken_all.csv のパス]
//     （郵便番号データは任意。ダウンロードして展開した utf_ken_all.csv を渡すと、両方の町名を合わせる）
import { readFileSync, writeFileSync } from "fs";

const API = "https://japanese-addresses-v2.geoloniamaps.com/api/ja";
const OUT = new URL("../database/places.json", import.meta.url);
const kenAll = process.argv[2];

const hira = (s) => (s ?? "").normalize("NFKC").replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
// 同じ町名の書き方の違い（「龍ヶ岳町」「龍ケ岳町」）は 1 つにする
const same = (s) => s.normalize("NFKC").replace(/[ヶヵケ]/g, "ケ");
const has = (towns, town) => [...towns.keys()].some((t) => same(t) === same(town));
const get = async (path) => {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${API}/${path.split("/").map(encodeURIComponent).join("/")}.json`);
    if (res.ok) return (await res.json()).data;
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw new Error(`fetch failed: ${path}`);
};

const targets = [
  ...(await get("熊本県")).map((c) => ({ pref: "熊本県", ...c })),
  ...(await get("福岡県")).filter((c) => c.city === "大牟田市").map((c) => ({ pref: "福岡県", ...c })),
];

const cities = [];
for (const c of targets) {
  const name = `${c.county ?? ""}${c.city}${c.ward ?? ""}`;
  const towns = new Map();
  for (const t of await get(`${c.pref}/${name}`)) {
    if (!t.oaza_cho || !t.oaza_cho_k) continue;
    const town = t.oaza_cho.replace(/^大字/, "");
    const kana = hira(t.oaza_cho_k).replace(/^おおあざ/, "");
    if (!has(towns, town)) towns.set(town, kana);
  }
  cities.push({ pref: c.pref, name, county: c.county ?? "", city: c.city, ward: c.ward ?? "", kana: hira(`${c.county_k ?? ""}${c.city_k}${c.ward_k ?? ""}`), towns });
}

// 郵便番号データの町名（町域）も合わせる（どちらかにしかない町名を補う）
let fromPost = 0;
if (kenAll) {
  for (const line of readFileSync(kenAll, "utf8").split(/\r?\n/)) {
    const f = line.split(",").map((x) => x.replace(/^"|"$/g, ""));
    if (f.length < 9) continue;
    const [, , , , cityK, townK, pref, cityName, townName] = f;
    if (pref !== "熊本県" && !(pref === "福岡県" && cityName === "大牟田市")) continue;
    if (/以下に掲載がない場合|の次に番地がくる場合/.test(townName)) continue;
    const c = cities.find((x) => x.pref === pref && x.name === cityName);
    if (!c) continue;
    const town = townName.replace(/（.*$/, "").replace(/一円$/, "").replace(/^大字/, "").trim();
    const kana = hira(townK.replace(/（.*$/, "")).replace(/いちえん$/, "").replace(/^おおあざ/, "");
    if (!town || !kana || has(c.towns, town)) continue;
    c.towns.set(town, kana);
    fromPost++;
  }
}

const json = {
  source:
    "アドレス・ベース・レジストリ（デジタル庁）を加工した Geolonia japanese-addresses-v2（CC BY 4.0）" + (kenAll ? "・日本郵便 郵便番号データ" : ""),
  builtAt: new Date().toISOString().slice(0, 10),
  cities: cities.map((c) => ({ pref: c.pref, name: c.name, county: c.county, city: c.city, ward: c.ward, kana: c.kana, towns: [...c.towns.entries()].sort((a, b) => a[1].localeCompare(b[1], "ja")) })),
};
writeFileSync(OUT, `${JSON.stringify(json)}\n`);
const total = json.cities.reduce((n, c) => n + c.towns.length, 0);
console.log(`places.json: ${json.cities.length} 市区町村・${total} 町名（郵便番号データから ${fromPost}）・${Math.round(JSON.stringify(json).length / 1024)} KB`);
