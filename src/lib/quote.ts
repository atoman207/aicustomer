// 数量つきの料金の質問（「6畳の表替えはいくら？」「襖4枚と障子5枚」）に、料金表の単価と注記（※）から合計の目安を計算して答える
//   ・単価×数量に、注記の条件を反映：半畳の掛け率・ヘリ代・古床処分なし・うす畳・防ダニ／殺菌乾燥・サッシ障子／玄関網戸の加算・網戸新調の採寸取付け費・諸経費（工事全体で一式）
//   ・会話の途中の訂正（「やっぱり8畳で」「古都にしたら？」「両面で」「襖はやめて」「あと障子5枚」）は、それまでのお客様の発言から条件を組み立て直して反映
//   ・金額や条件はすべて料金表から読み取る（Excel を更新すれば計算も変わる）。正式なお見積りは現地確認後であることを必ず添える
import type { PriceRow, PriceTable } from "./manual";
import { INCLUSION, PRICE_INTENT, WHY_PRICE, labelTokens, normPrice, questionWords, rowMatches, voiceClean, type AnswerStyle, type PriceAnswer } from "./price";
import type { ChatMessage } from "./types";

/** 天地袋：天袋・地袋の襖（料金は襖の表の「天・地袋」の列）。「襖4枚と天袋2枚」のように、ふつうの襖と別に数えられるように */
type Group = "畳" | "襖" | "天地袋" | "障子" | "網戸";
type Kind = "tatami" | "herinashi" | "heriari" | "oki" | "fusuma" | "fusumaNew" | "shoji" | "amido";
type Work = "表替え" | "新調" | "ウラ返し";
type Addon = "殺菌乾燥" | "マイトスタット" | "ダニシラズ";

const KINDS: { kind: Kind; group: Group; title: RegExp }[] = [
  { kind: "tatami", group: "畳", title: /^畳\(ヘリ付き\)$/ },
  { kind: "herinashi", group: "畳", title: /^ヘリ無し半畳/ },
  { kind: "heriari", group: "畳", title: /^ヘリ有り\s*1畳物/ },
  { kind: "oki", group: "畳", title: /置き畳/ },
  { kind: "fusuma", group: "襖", title: /^襖張替え/ },
  { kind: "fusumaNew", group: "襖", title: /^襖新調/ },
  { kind: "shoji", group: "障子", title: /^障子張替え/ },
  { kind: "amido", group: "網戸", title: /^網戸/ },
];
const TATAMI_KINDS: Kind[] = ["tatami", "herinashi", "heriari", "oki"];

interface Qty {
  /** 畳：1畳物の数（単位が「枚」なら枚数）。建具：枚数 */
  n: number;
  /** 半畳の枚数 */
  half: number;
  unit: "畳" | "枚";
}

interface Item {
  group: Group;
  /** 畳の表の種類（ヘリ無し・ヘリ有り1畳物・置き畳）。未指定は通常の畳 */
  kind?: Kind;
  /** 品名から表を決めた（ヘリ無しなどを明示していない） */
  inferredKind?: boolean;
  work?: Work;
  /** 畳床：3型・ボード・ワラ・床暖・置き畳床 */
  bed?: string;
  /** 品名（行ラベル）。空なら種類ごとの一覧 */
  rows: string[];
  pick?: "cheap" | "premium";
  side?: "片面" | "両面";
  /** 襖：中・天地袋・板戸・幅広・仏間 */
  part?: string;
  /** 障子・網戸：大・中・小・丈長・幅広・特大・雪見… */
  size?: string;
  /** 置き畳：ヘリ無し・ヘリ有り */
  okiHeri?: "ヘリ無し" | "ヘリ有り";
  qty?: Qty;
  heri?: { price: number; label: string };
  noDisposal?: boolean;
  thin?: boolean;
  oneMat?: boolean;
  addons: Addon[];
  sash?: boolean;
  entrance?: boolean;
}

type Patch = Partial<Omit<Item, "group" | "addons" | "rows" | "inferredKind">> & {
  rows?: string[];
  addAddons?: Addon[];
  removeAddons?: Addon[];
  /** 品名がどの表で見つかったか（畳の種類の切り替えに使う） */
  rowKind?: Kind;
};

// ---------------- 料金表から読み取る計算の条件 ----------------

interface TableRules {
  halfRate?: number;
  allHalfRate?: number;
  noDisposal?: number;
  thin?: { amount: number; col: RegExp };
  addons: Partial<Record<Addon, number>>;
  heriSeparate: boolean;
  oneMatRate?: number;
  sash?: number;
  entrance?: number;
  newFee?: number;
  oldDisposal?: number;
  repairFrom?: number;
  sizeGuide?: string;
  newIncludesDisposal: boolean;
}

interface Ctx {
  byKind: Map<Kind, PriceTable>;
  rules: Map<Kind, TableRules>;
  expenses?: number;
  revised: string;
  heriTable?: PriceTable;
  heriGrades: { label: string; price: number }[];
  heriDefault?: number;
  heriPopular: number[];
}

const amount = (s: string | undefined): number | undefined => {
  if (!s) return undefined;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const nk = (s: string) => s.normalize("NFKC");

function tableRules(t: PriceTable): TableRules {
  const notes = t.notes.map(nk);
  const all = [nk(t.title), nk(t.caption), ...notes].join("\n");
  const find = (re: RegExp) => amount(all.match(re)?.[1]);
  const thinNote = notes.find((n) => /うす畳/.test(n) && /\+\s*[\d,]+\s*円/.test(n));
  const thinAmt = thinNote ? amount(thinNote.match(/うす畳[^+]*\+\s*([\d,]+)\s*円/)?.[1]) : undefined;
  const half = all.match(/半畳\s*(\d)\s*掛け/);
  const allHalf = all.match(/全て半畳[^\d]*(\d)\s*掛け/);
  const oneMat = all.match(/一帖物の場合、?半帖の価格の\s*([\d.]+)\s*倍/);
  return {
    halfRate: half ? Number(half[1]) / 10 : undefined,
    allHalfRate: allHalf ? Number(allHalf[1]) / 10 : undefined,
    noDisposal: find(/古床処分無しの場合\s*[-－−ー]\s*([\d,]+)\s*円/),
    thin: thinAmt ? { amount: thinAmt, col: /表替え\s*うす畳/.test(thinNote ?? "") ? /^表替え$/ : /新調.*3型/ } : undefined,
    addons: {
      殺菌乾燥: find(/畳殺菌乾燥\s*([\d,]+)\s*円\/畳/),
      マイトスタット: find(/マイトスタット\s*([\d,]+)\s*円\/畳/),
      ダニシラズ: find(/ダニシラズ\s*([\d,]+)\s*円\/畳/),
    },
    heriSeparate: /縁別途|ヘリ代?.{0,4}別途/.test(all),
    oneMatRate: oneMat ? Number(oneMat[1]) : undefined,
    sash: find(/サッシ障子\s*\+\s*([\d,]+)/),
    entrance: find(/玄関・勝手\s*\+\s*([\d,]+)/),
    newFee: find(/新調は別途\s*採寸・取付け費\s*([\d,]+)\s*円/),
    oldDisposal: find(/古建具処分費\s*([\d,]+)\s*円\/本/),
    repairFrom: find(/下地補修[^\d]*([\d,]+)\s*円\s*[~～]/),
    sizeGuide: t.notes.find((n) => /^目安[:：]/.test(nk(n)))?.replace(/^目安[:：]\s*/, ""),
    newIncludesDisposal: /古床処分込/.test(all),
  };
}

function buildCtx(tables: PriceTable[]): Ctx {
  const byKind = new Map<Kind, PriceTable>();
  for (const t of tables) {
    const title = nk(t.title);
    const k = KINDS.find((x) => x.title.test(title));
    if (k && !byKind.has(k.kind)) byKind.set(k.kind, t);
  }
  const rules = new Map<Kind, TableRules>();
  byKind.forEach((t, k) => rules.set(k, tableRules(t)));
  const notes = tables.flatMap((t) => [...t.notes, t.caption, t.title]).map(nk);
  const expenses = amount(notes.map((n) => n.match(/諸経費\s*([\d,]+)\s*円/)?.[1]).find(Boolean));
  const date = notes.map((n) => n.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/)).find(Boolean);
  const heriTable = tables.find((t) => /^ヘリ$/.test(nk(t.title).trim()));
  const heriGrades = (heriTable?.rows ?? [])
    .map((r) => ({ label: r.label, price: amount(r.extra.find((v) => /^[\d,]+$/.test(v.trim()))) ?? 0 }))
    .filter((g) => g.price > 0);
  const heriGuide = nk((heriTable?.guides ?? []).map((g) => g.text).join(""));
  const popular = heriGuide.match(/よく選ばれるのは\s*([\d,]+)\s*円と\s*([\d,]+)\s*円/);
  const heriPopular = popular ? [amount(popular[1]), amount(popular[2])].filter((n): n is number => Boolean(n)) : [];
  const plain = amount(heriGuide.match(/無地は\s*([\d,]+)\s*円/)?.[1]);
  return {
    byKind,
    rules,
    expenses,
    revised: date ? `${date[1]}年${Number(date[2])}月${Number(date[3])}日` : "",
    heriTable,
    heriGrades,
    heriDefault: plain ?? (heriPopular.length ? Math.min(...heriPopular) : undefined),
    heriPopular,
  };
}

// ---------------- お客様の発言の読み取り ----------------

const KANJI: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const NUM = "(\\d+(?:\\.\\d+)?|[一二三四五六七八九十]+)";

function toNum(s: string): number {
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  let total = 0;
  let cur = 0;
  for (const ch of s) {
    if (ch === "十") {
      total += (cur || 1) * 10;
      cur = 0;
    } else if (KANJI[ch]) cur = KANJI[ch];
    else return NaN;
  }
  return total + cur;
}

/** 解析用に整える（区切りの記号は残す） */
function norm(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　]/g, "")
    .replace(/一畳屋/g, "〓")
    .replace(/たたみ/g, "畳")
    .replace(/帖/g, "畳")
    .replace(/ふすま/g, "襖")
    .replace(/しょうじ/g, "障子")
    .replace(/あみど|アミ戸|アミド/g, "網戸")
    .replace(/へり/g, "ヘリ")
    .replace(/(縁|ヘリ)(なし|無し|無)/g, "ヘリ無し")
    .replace(/(縁|ヘリ)(あり|有り|有|付き|付)/g, "ヘリ有り")
    .replace(/畳縁|縁(?!側)/g, "ヘリ")
    .replace(/張り替え|貼り替え|貼替え|はりかえ|張りかえ/g, "張替え")
    .replace(/おもてがえ|表がえ/g, "表替え")
    .replace(/うら返し|裏返し|うらがえし/g, "ウラ返し")
    .replace(/[×*]/g, "x")
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
}

const SPLIT = /[、,。!?\n]|(?:と|や)(?=\d|[一二三四五六七八九十]+[畳枚本]|襖|天袋|地袋|天地袋|障子|網戸|畳|表替え|新調|ウラ返し|半畳|[ァ-ヶ])|あと(?=\d|[一二三四五六七八九十]|襖|天袋|地袋|天地袋|障子|網戸|畳)|それと|それから|および|及び|\+/;
const TENCHI = /天地袋|天・地袋|天袋|地袋/g;
const TATAMI_WORD = /(?<![\d一二三四五六七八九十半.])畳(?!間)|表替え|畳替え|ウラ返し|琉球|置き畳|ヘリ無し|ヘリ有り|和紙畳|樹脂畳|カラー畳|ヘリ/;
const CANCEL = /^(?:半)?(?:間|の部屋|の和室|和室|分)?(?:の畳)?(?:じゃなく|じゃな|ではなく|ではな|でなく|でな|と言|って言|と書|と伝え|と申し|は間違|は誤|から(?=[^、。]*?(?:に|へ)(?:変更|変え|して|なり|しま|お願い)))/;
const NEW_WORK = /新調|新しく|新品|作り替え|作りかえ|作り直|丸ごと/;
const ADDITIVE = /追加|増やし|足して|プラスで|もう(?:\d|[一二三四五六七八九十])|あと(?:\d|[一二三四五六七八九十]|襖|天袋|地袋|障子|網戸|畳)|(?:襖|天袋|地袋|障子|網戸|畳|表替え|置き畳)も|も(?:お願い|追加|見積|計算|入れ|含め|一緒|あり|ある|あわせ|合わせ|いくら|頼|やり|したい|して)|合わせて|あわせて|一緒に/;
const QTY_ADD = /追加|増やし|足して|もう(?:\d|[一二三四五六七八九十])|あと(?:\d|[一二三四五六七八九十])|(?:畳|枚|部屋)も(?:あり|ある)/;
/** 見積の続きとして扱わない質問（工期・違い・おすすめなど） */
const QUOTE_OTHER = /違い|特徴|とは|どんな|おすすめ|オススメ|何日|日数|工期|いつ|期間|仕上が|納期|強度|破れ|選び方|メリット|デメリット|何年|年数|耐用|寿命|長持ち|タイミング|替え時|時期|人気|選ばれ|効果|効き目|安全|ブヨブヨ|サンプル|見本|何枚/;
const TOTAL_ASK = /全部で|合計|総額|トータル|まとめて|合わせて|あわせて|全部(?:の|を)?(?:いくら|料金|金額|見積)/;
const QUOTE_ASK = /合計|総額|トータル|全部で|概算|見積(?:もり)?(?:額|金額)|いくらに/;
const UNIT_ASK = /あたり|当たり|単価|1枚(?:の|で)?(?:値段|料金|いくら)/;
const CHEAP_PICK = /一番安い|いちばん安い|最安|最も安い|一番お手頃|いちばんお手頃/;
const PREMIUM_PICK = /一番高い|いちばん高い|最高級|最も高い|一番良い|いちばん良い|一番いい|いちばんいい/;

interface Hit {
  group: Group;
  index: number;
}

function groupHits(c: string): Hit[] {
  const hits: Hit[] = [];
  for (const [g, re] of [
    ["襖", /襖/g],
    ["障子", /障子/g],
    ["網戸", /網戸/g],
  ] as const) {
    for (const m of c.matchAll(re)) hits.push({ group: g, index: m.index ?? 0 });
  }
  for (const m of c.matchAll(new RegExp(TATAMI_WORD.source, "g"))) hits.push({ group: "畳", index: m.index ?? 0 });
  // 天袋・地袋（「天袋の襖」「襖の天袋」の「襖」は天袋のこと）
  const tenchi = [...c.matchAll(TENCHI)].map((m) => ({ group: "天地袋" as const, index: m.index ?? 0 }));
  const own = (h: Hit) => h.group === "襖" && (/(?:天|地)袋の?$/.test(c.slice(0, h.index)) || /^襖の?(?:天地袋|天・地袋|天袋|地袋)/.test(c.slice(h.index)));
  return [...hits.filter((h) => !own(h)), ...tenchi].sort((a, b) => a.index - b.index);
}

/** 「6畳」「4畳半」「6畳の部屋が2つ」など（訂正で取り消された数量は除く） */
function matsIn(c: string): Qty | null {
  let n = 0;
  let half = 0;
  let found = false;
  for (const m of c.matchAll(new RegExp(`${NUM}畳(半)?`, "g"))) {
    const at = m.index ?? 0;
    const after = c.slice(at + m[0].length);
    const before = c.slice(0, at);
    if (/^(?:あたり|当たり|につき|物|もの|タイプ)/.test(after)) continue;
    if (CANCEL.test(after)) continue;
    let v = toNum(m[1]);
    if (!Number.isFinite(v) || v <= 0 || v > 200) continue;
    let h = m[2] ? 1 : 0;
    if (!Number.isInteger(v)) {
      h += Math.round((v - Math.floor(v)) * 2);
      v = Math.floor(v);
    }
    const mul = after.match(new RegExp(`^(?:間|の部屋|の和室|和室|の間)?(?:が|を|x)?${NUM}(?:部屋|間(?!口)|つ)`));
    const pre = before.match(new RegExp(`${NUM}部屋(?:とも|共|全部|それぞれ|分)?(?:の|が|は|を)?$`));
    const k = mul ? toNum(mul[1]) : pre ? toNum(pre[1]) : 1;
    const times = Number.isFinite(k) && k > 0 && k < 20 ? k : 1;
    n += v * times;
    half += h * times;
    found = true;
  }
  return found ? { n, half, unit: "畳" } : null;
}

interface PieceHit {
  count: number;
  half: boolean;
  index: number;
}

function piecesIn(c: string): PieceHit[] {
  const out: PieceHit[] = [];
  for (const m of c.matchAll(new RegExp(`${NUM}(?:枚|本|か所|箇所|ヶ所|カ所|ヵ所|個)`, "g"))) {
    const at = m.index ?? 0;
    const after = c.slice(at + m[0].length);
    if (/^(?:あたり|当たり|につき|柄|目)/.test(after) || CANCEL.test(after)) continue;
    const v = toNum(m[1]);
    if (!Number.isFinite(v) || v <= 0 || v > 300 || !Number.isInteger(v)) continue;
    const half = /半畳(?:の畳)?(?:を|が|は|x)?$/.test(c.slice(0, at)) || /^の半畳/.test(after);
    out.push({ count: v, half, index: at });
  }
  return out;
}

function kindTable(ctx: Ctx, k: Kind | undefined): PriceTable | undefined {
  return k ? ctx.byKind.get(k) : undefined;
}

const allTokens = (label: string) =>
  nk(label)
    .split(/[／/・\s()（）【】「」〃,、.[\]]+/)
    .map(normPrice)
    .filter((x) => x.length >= 2);

/**
 * 文中に出てくる品名（行）。「一畳屋」は品名として明示されたときだけ。
 * 同じ語で複数の品名に当たるときは、ほかの語（国産・中国産など）も当たるものを選ぶ（「国産の目積」→ 目積（国産））
 */
function rowsIn(t: PriceTable, c: string, raw: string): PriceRow[] {
  const nq = normPrice(c.replace(/〓/g, ""));
  const words = questionWords(nq);
  const tableTokens = [...new Set(t.rows.flatMap((r) => allTokens(r.label)))];
  // 「国産」は「中国産」の一部としては数えない
  const appears = (x: string) => nq.includes(x) && !tableTokens.some((y) => y !== x && y.includes(x) && nq.includes(y));
  const strip = (tok: string) => tok.replace(/^(網戸|障子|襖|畳)/, "");
  const scored = t.rows
    .map((r) => {
      let matched: string[] = [];
      if (/一畳屋/.test(r.label)) {
        if (/「一畳屋」|一畳屋(?:の畳表|という|グレード|ランク|で)/.test(raw) && /〓/.test(c)) matched = ["一畳屋"];
      } else {
        // 当たった語（「アミド18メッシュ」の「18メッシュ」のように、商品名を除いた部分で当たったときはその部分）
        matched = labelTokens(r.label)
          .map((tok) => (appears(tok) ? tok : strip(tok).length >= 3 && appears(strip(tok)) ? strip(tok) : rowMatches({ ...r, label: tok }, nq, words) ? tok : ""))
          .filter(Boolean);
        // 「雅」のような 1 文字の品名
        const first = nk(r.label).split(/[(（\s/／]/)[0];
        if (first.length === 1 && /[一-鿿]/.test(first) && new RegExp(`(^|[^一-鿿])${first}(?=で|に|の|を|は|だと|なら|も|$)`).test(c)) matched.push(first);
      }
      const all = allTokens(r.label);
      const hits = Math.max(matched.length, all.filter(appears).length);
      return { r, matched, hits, ratio: hits / Math.max(1, all.length) };
    })
    .filter((s) => s.matched.length);
  const keep = new Set<PriceRow>();
  const byTok = new Map<string, typeof scored>();
  for (const s of scored) for (const m of s.matched) byTok.set(m, [...(byTok.get(m) ?? []), s]);
  byTok.forEach((list) => {
    const best = Math.max(...list.map((s) => s.hits));
    const top = list.filter((s) => s.hits === best);
    const bestRatio = Math.max(...top.map((s) => s.ratio));
    for (const s of top) if (s.ratio === bestRatio) keep.add(s.r);
  });
  const seen = new Set<string>();
  return t.rows.filter((r) => keep.has(r) && (seen.has(r.label) ? false : (seen.add(r.label), true)));
}

/** 畳の品名がどの表にあるか（通常の畳 → ヘリ無し → ヘリ有り1畳物 → 置き畳 の順） */
function tatamiRows(ctx: Ctx, c: string, raw: string, prefer?: Kind): { kind: Kind; rows: string[] } | null {
  const order: Kind[] = prefer ? [prefer, ...TATAMI_KINDS.filter((k) => k !== prefer)] : ["tatami", "herinashi", "heriari", "oki"];
  for (const k of order) {
    const t = kindTable(ctx, k);
    if (!t) continue;
    const rows = rowsIn(t, c, raw).filter((r) => !/^ウラ返し$/.test(r.label));
    if (rows.length) return { kind: k, rows: rows.map((r) => r.label) };
  }
  return null;
}

function fittingKind(group: Group, work?: Work): Kind {
  if (group === "襖" || group === "天地袋") return work === "新調" ? "fusumaNew" : "fusuma";
  if (group === "障子") return "shoji";
  return "amido";
}

/** 1 つの文（区切り）から、その商品についての指定を読み取る */
function clausePatch(ctx: Ctx, c: string, raw: string, group: Group | null, current?: Item): Patch {
  const p: Patch = {};
  // 作業
  if (/ウラ返し/.test(c)) p.work = "ウラ返し";
  else if (NEW_WORK.test(c) || (group === "畳" && /交換/.test(c))) p.work = "新調";
  else if (/表替え|畳替え|表を替え|張替え/.test(c)) p.work = "表替え";
  // 畳床
  if (/本ワラ|ワラ|わら|藁/.test(c)) p.bed = "ワラ";
  else if (/ボード/.test(c)) p.bed = "ボード";
  else if (/床暖/.test(c)) p.bed = "床暖";
  else if (/置き畳床/.test(c)) p.bed = "置き畳床";
  else if (/建材|3型/.test(c)) p.bed = "3型";
  if (p.bed && !p.work) p.work = "新調";
  if (/(?:一|1)畳(?:タイプ|物|もの|サイズ)|長方形/.test(c)) p.oneMat = true;
  if (/半畳タイプ|正方形/.test(c)) p.oneMat = false;

  if (group === "畳" || group === null) {
    // 置き畳の「ヘリ無し／ヘリ有り」は列の指定（同じ発言のどこかに「置き畳」があれば置き畳）
    const oki = /置き畳|ユニット畳/.test(norm(raw)) || (current?.kind === "oki" && !/琉球|表替え|新調/.test(c));
    if (oki) p.kind = "oki";
    else if (/琉球/.test(c) || /ヘリ無し/.test(c)) p.kind = "herinashi";
    else if (/和紙畳|樹脂畳|カラー畳|1畳物|一畳物/.test(c)) p.kind = "heriari";
    else if (/ヘリ有り/.test(c) && current?.kind === "herinashi") p.kind = "tatami";
    if (/ヘリ無し/.test(c)) p.okiHeri = "ヘリ無し";
    else if (/ヘリ有り/.test(c)) p.okiHeri = "ヘリ有り";
    const found = tatamiRows(ctx, c, raw, p.kind ?? current?.kind);
    if (found && (group === "畳" || !current || current.group === "畳")) {
      p.rows = found.rows;
      p.rowKind = found.kind;
    }
    // ヘリ代のグレード（金額・品名・無地）
    if (/ヘリ(?!無し|有り)/.test(c)) {
      const yenMatch = c.match(/ヘリ(?:代)?(?:は|を|が|の)?[^、。]*?(\d[\d,]*)円/);
      const heriYen = amount(yenMatch?.[1]);
      const byPrice = heriYen ? ctx.heriGrades.find((g) => g.price === heriYen) : undefined;
      const byName = ctx.heriTable ? rowsIn(ctx.heriTable, c, raw)[0] : undefined;
      if (byPrice) p.heri = { price: byPrice.price, label: `${byPrice.price.toLocaleString("ja-JP")}円のグレード` };
      else if (byName) {
        const g = ctx.heriGrades.find((x) => x.label === byName.label);
        if (g) p.heri = { price: g.price, label: `${nk(g.label).split(/[\s【]/)[0]}・${g.price.toLocaleString("ja-JP")}円のグレード` };
      } else if (/無地/.test(c) && ctx.heriDefault) p.heri = { price: ctx.heriDefault, label: `無地・${ctx.heriDefault.toLocaleString("ja-JP")}円のグレード` };
      else if (/(?:一番|いちばん|最も)?安い/.test(c) && ctx.heriGrades.length) {
        const g = ctx.heriGrades.reduce((a, b) => (b.price < a.price ? b : a));
        p.heri = { price: g.price, label: `${g.price.toLocaleString("ja-JP")}円のグレード` };
      }
    }
    if (/処分(?:は|を)?(?:なし|無し|不要|いらない|要らない|しない|結構|自分で|こちらで|不用)|処分無し/.test(c)) p.noDisposal = true;
    else if (/処分(?:は|を|も)?(?:お願い|して(?:ほしい|欲しい|ください)|必要|あり)/.test(c)) p.noDisposal = false;
    if (/(?:うす畳|薄畳|薄い畳|うすい畳)(?:は|じゃ|では)?(?:なく|ない|やめ|いらない|不要)/.test(c)) p.thin = false;
    else if (/うす畳|薄畳|薄い畳|うすい畳/.test(c)) p.thin = true;
    const add: Addon[] = [];
    const remove: Addon[] = [];
    const addon = (re: RegExp, a: Addon) => {
      const m = c.match(re);
      if (!m) return;
      const rest = c.slice((m.index ?? 0) + m[0].length);
      if (/^(?:は|も|を)?(?:なし|無し|不要|いらない|要らない|やめ|結構|外|抜|なく)/.test(rest)) remove.push(a);
      else add.push(a);
    };
    addon(/殺菌乾燥|殺菌/, "殺菌乾燥");
    addon(/マイトスタット|防ダニシート|防ダニ|ダニ対策/, "マイトスタット");
    addon(/ダニシラズ/, "ダニシラズ");
    if (add.length) p.addAddons = add;
    if (remove.length) p.removeAddons = remove;
  }
  if (group && group !== "畳") {
    const k = fittingKind(group, p.work ?? current?.work);
    const t = kindTable(ctx, k);
    if (t) {
      const rows = rowsIn(t, c, raw).filter((r) => !/セット|枠交換/.test(r.label) || /セット|4枚柄|枠/.test(c));
      if (rows.length) p.rows = rows.map((r) => r.label);
    }
  }
  if (group === "天地袋") p.part = "天・地袋";
  else if (group === "襖" || group === null) {
    if (/両面/.test(c)) p.side = "両面";
    else if (/片面/.test(c)) p.side = "片面";
    if (/仏間/.test(c)) p.part = "仏間";
    else if (/幅広/.test(c) && group === "襖") p.part = "幅広";
    else if (/板戸|戸襖/.test(c)) p.part = "板戸";
    else if (/天袋|地袋|天地袋|天・地袋/.test(c)) p.part = "天・地袋";
    else if (/中襖|小襖/.test(c)) p.part = "中";
  }
  if (group === "障子" || group === "網戸" || group === null) {
    const yuki = /雪見/.test(c);
    let size: string | undefined;
    if (/丈長|背が高い|背の高い/.test(c)) size = "丈長";
    else if (/幅広|幅が広い/.test(c)) size = "幅広";
    else if (/特大/.test(c)) size = "特大";
    else {
      const m = c.match(
        /(?:サイズ|大きさ)(?:は|が|:)?(大|中|小)(?!さ)|(大|中|小)サイズ|^(大|中|小)(?=で|だと|なら|は|の場合|にし|を|$)|(大|中|小)の(?:障子|網戸|もの|やつ|ほう)|(?:^|の)(大|中|小)(?:を|で|が|x)(?=\d|[一二三四五六七八九十])|(大き|小さ)(?:い|め)|(中くらい)/,
      );
      if (m) {
        const v = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
        size = v ?? (m[6] === "大き" ? "大" : m[6] === "小さ" ? "小" : m[7] ? "中" : undefined);
      }
    }
    if (yuki) size = size && size !== "大" && size !== "中" && size !== "小" ? `雪見${size}` : "雪見";
    if (size) p.size = size;
    if (/サッシ(?:じゃ|では)(?:ない|なく)|木の障子|木製/.test(c)) p.sash = false;
    else if (/サッシ/.test(c)) p.sash = true;
    if (/玄関|勝手口|勝手/.test(c)) p.entrance = true;
  }
  if (CHEAP_PICK.test(c) && !/ヘリ/.test(c)) p.pick = "cheap";
  else if (PREMIUM_PICK.test(c) && !/ヘリ/.test(c)) p.pick = "premium";
  return p;
}

interface Parsed {
  patches: Map<Group, Patch>;
  qtys: Map<Group, Qty>;
  implicit: Patch | null;
  implicitQty: Qty | null;
  /** 数量（枚）だけで商品が決まらないもの */
  implicitPieces: number | null;
  removed: Group[];
  only: Group | null;
  additive: boolean;
  qtyAdd: boolean;
  total: boolean;
}

const EMPTY_KEYS = new Set(["rowKind"]);
function isEmptyPatch(p: Patch | null): boolean {
  return !p || Object.entries(p).every(([k, v]) => EMPTY_KEYS.has(k) || v === undefined || (Array.isArray(v) && v.length === 0));
}

function mergePatch(a: Patch, b: Patch): Patch {
  const rows = [...(a.rows ?? []), ...(b.rows ?? [])];
  const out: Patch = { ...a, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) };
  if (rows.length) out.rows = [...new Set(rows)];
  // 同じ発言に「表替え」と「新調」の両方 → 比べたい（作業は指定なし扱い）
  if (a.work && b.work && a.work !== b.work) out.work = undefined;
  out.addAddons = [...new Set([...(a.addAddons ?? []), ...(b.addAddons ?? [])])];
  out.removeAddons = [...new Set([...(a.removeAddons ?? []), ...(b.removeAddons ?? [])])];
  return out;
}

function addQty(a: Qty | null | undefined, b: Qty): Qty {
  if (!a) return b;
  if (a.unit !== b.unit) return b;
  return { n: a.n + b.n, half: a.half + b.half, unit: a.unit };
}

function parseMessage(ctx: Ctx, raw: string, state: State): Parsed {
  const text = norm(raw);
  const parsed: Parsed = {
    patches: new Map(),
    qtys: new Map(),
    implicit: null,
    implicitQty: null,
    implicitPieces: null,
    removed: [],
    only: null,
    additive: ADDITIVE.test(text),
    qtyAdd: QTY_ADD.test(text),
    total: TOTAL_ASK.test(text),
  };
  const allHits = groupHits(text);
  const fittingsInText = allHits.some((h) => h.group !== "畳");
  const tatamiSignal = allHits.some((h) => h.group === "畳");

  // 取りやめ（「襖はやめて」）・「〜だけ」
  for (const h of allHits) {
    const rest = text.slice(h.index).replace(/^(?:襖|天地袋|天・地袋|天袋|地袋|障子|網戸|畳|表替え|畳替え|ウラ返し)/, "");
    if (/^(?:の(?:張替え|表替え|新調|分|方|ほう))?(?:は|も)?(?:やめ|なし|無し|いらない|要らない|不要|キャンセル|結構|取りやめ|外し|除い|抜い|なくて)/.test(rest)) parsed.removed.push(h.group);
    if (/^(?:の(?:張替え|表替え|新調))?(?:だけ|のみ)/.test(rest)) parsed.only = h.group;
  }

  // 文（「。」「?」「!」・改行）ごとに区切りを作る。数量は、同じ文の中は足し（「6畳と8畳」）、別の文なら言い直し・訂正として
  // 後の文の数量にする（「いや、8畳でした。8畳だといくら？」は 8畳。「あと」「も」などの追加のときだけ足す）
  const clauses = text.split(/[。!?\n]+/).flatMap((s, si) => s.split(SPLIT).filter((c) => c && c.trim()).map((c) => ({ c, si })));
  let prevGroup: Group | null = null;
  const pending: { c: string; si: number; pieces: PieceHit[]; mats: Qty | null }[] = [];
  const qtyBySentence = new Map<Group, Map<number, Qty>>();
  const assign = (g: Group, c: string, si: number, pieces: PieceHit[], mats: Qty | null) => {
    const current = state.items.get(g);
    const patch = clausePatch(ctx, c, raw, g, current);
    parsed.patches.set(g, mergePatch(parsed.patches.get(g) ?? {}, patch));
    let q: Qty | null = null;
    const pieceSum = pieces.filter((p) => !p.half).reduce((s, p) => s + p.count, 0);
    const halfSum = pieces.filter((p) => p.half).reduce((s, p) => s + p.count, 0);
    if (g === "畳") {
      if (pieceSum || halfSum) q = { n: pieceSum, half: halfSum, unit: pieceSum ? "枚" : "畳" };
      else if (mats) q = mats;
    } else if (pieceSum) q = { n: pieceSum, half: 0, unit: "枚" };
    if (!q) return;
    const bySentence = qtyBySentence.get(g) ?? new Map<number, Qty>();
    bySentence.set(si, addQty(bySentence.get(si), q));
    qtyBySentence.set(g, bySentence);
  };

  for (const { c, si } of clauses) {
    const hits = groupHits(c);
    const pieces = piecesIn(c);
    // 建具の話で、畳の作業の言葉がないときの「6畳」はお部屋の広さ
    const mats = fittingsInText && !tatamiSignal ? null : matsIn(c);
    const groups = [...new Set(hits.map((h) => h.group))];
    if (groups.length === 0) {
      // 品名だけ（「古都で」「しずかの両面」）→ 相談中の商品の表から探す
      const focusGroups = state.focus.length ? state.focus : [...state.items.keys()];
      let g: Group | null = null;
      for (const fg of [...focusGroups].reverse()) {
        const item = state.items.get(fg);
        const t = fg === "畳" ? null : kindTable(ctx, fittingKind(fg, item?.work));
        const hasRow = fg === "畳" ? tatamiRows(ctx, c, raw, item?.kind) : t ? rowsIn(t, c, raw).length > 0 : false;
        if (hasRow) {
          g = fg;
          break;
        }
      }
      if (!g && (mats || tatamiRows(ctx, c, raw))) g = "畳";
      if (!g && prevGroup) g = prevGroup;
      if (g) {
        assign(g, c, si, pieces, mats);
        prevGroup = g;
      } else pending.push({ c, si, pieces, mats });
      continue;
    }
    if (groups.length === 1) {
      assign(groups[0], c, si, pieces, mats);
      prevGroup = groups[0];
      continue;
    }
    // 1 つの区切りに複数の商品：数量は直前（なければ直後）の商品へ
    for (const g of groups) {
      const own = pieces.filter((p) => {
        const before = hits.filter((h) => h.index < p.index).pop();
        const after = hits.find((h) => h.index > p.index);
        return (before ?? after)?.group === g;
      });
      assign(g, c, si, own, g === "畳" ? mats : null);
    }
    prevGroup = groups[groups.length - 1];
  }

  // 商品の言葉がない区切り（「8畳で」「両面で」「4枚」）
  const implicitBySentence = new Map<number, { qty: Qty | null; pieces: number }>();
  for (const { c, si, pieces, mats } of pending) {
    const g = prevGroup ?? allHits[0]?.group ?? null;
    if (g) {
      assign(g, c, si, pieces, mats);
      continue;
    }
    parsed.implicit = mergePatch(parsed.implicit ?? {}, clausePatch(ctx, c, raw, null, undefined));
    const cur = implicitBySentence.get(si) ?? { qty: null, pieces: 0 };
    if (mats) cur.qty = addQty(cur.qty, mats);
    const n = pieces.reduce((s, p) => s + p.count, 0);
    const halfN = pieces.filter((p) => p.half).reduce((s, p) => s + p.count, 0);
    if (halfN) cur.qty = addQty(cur.qty, { n: 0, half: halfN, unit: "畳" });
    else if (n) cur.pieces += n;
    implicitBySentence.set(si, cur);
  }
  if (isEmptyPatch(parsed.implicit)) parsed.implicit = null;
  // 文ごとの数量をまとめる（追加のときは足す・それ以外は最後の文の数量）
  const add = parsed.additive || parsed.qtyAdd;
  for (const [g, bySentence] of qtyBySentence) {
    const list = [...bySentence.entries()].sort((a, b) => a[0] - b[0]).map(([, q]) => q);
    parsed.qtys.set(g, add ? list.reduce((a, b) => addQty(a, b)) : list[list.length - 1]);
  }
  const implicit = [...implicitBySentence.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  const qtys = implicit.map((v) => v.qty).filter((q): q is Qty => Boolean(q));
  if (qtys.length) parsed.implicitQty = add ? qtys.reduce((a, b) => addQty(a, b)) : qtys[qtys.length - 1];
  const pieceCounts = implicit.map((v) => v.pieces).filter((n) => n > 0);
  if (pieceCounts.length) parsed.implicitPieces = add ? pieceCounts.reduce((a, b) => a + b, 0) : pieceCounts[pieceCounts.length - 1];
  // 天袋・地袋を別に数えるのは、同じ発言に襖の枚数があるとき（「襖4枚と天袋2枚」）・追加のとき（「天袋も2枚」）。
  // それ以外（「天袋2枚だと？」「天袋の張替えは？」）は、相談中の襖の種類の指定
  const tp = parsed.patches.get("天地袋");
  const tq = parsed.qtys.get("天地袋");
  if ((tp || tq) && !parsed.qtys.has("襖") && !parsed.additive && !state.items.has("天地袋")) {
    parsed.patches.set("襖", mergePatch(parsed.patches.get("襖") ?? {}, { ...(tp ?? {}), part: "天・地袋" }));
    if (tq) parsed.qtys.set("襖", tq);
    parsed.patches.delete("天地袋");
    parsed.qtys.delete("天地袋");
    parsed.removed = parsed.removed.map((g) => (g === "天地袋" ? "襖" : g));
    if (parsed.only === "天地袋") parsed.only = "襖";
  }
  return parsed;
}

// ---------------- 会話から見積の条件を組み立てる ----------------

interface State {
  items: Map<Group, Item>;
  focus: Group[];
  /** 直前の発言が見積の計算・料金の質問だったか（「8畳だと？」のような続きはこのときだけ見積として扱う） */
  lastQuote: boolean;
  lastPrice: boolean;
}

function applyPatch(ctx: Ctx, item: Item, p: Patch, qty: Qty | null, additive: boolean, qtyAdd: boolean): void {
  if (p.kind && p.kind !== item.kind) {
    item.kind = p.kind;
    item.inferredKind = false;
    const t = kindTable(ctx, p.kind);
    item.rows = t ? item.rows.filter((l) => t.rows.some((r) => r.label === l)) : [];
  }
  if (p.rowKind && item.group === "畳" && p.rowKind !== (item.kind ?? "tatami") && !p.kind) {
    // 品名が今の表にない（「清流で」など）→ その品名のある表に切り替える
    item.kind = p.rowKind;
    item.inferredKind = true;
  }
  if (p.rows?.length) item.rows = additive && !qty ? [...new Set([...item.rows, ...p.rows])] : p.rows;
  if (p.pick) {
    item.pick = p.pick;
    if (!p.rows?.length) item.rows = [];
  } else if (p.rows?.length) item.pick = undefined;
  if (p.work) {
    if (item.group === "網戸" && p.work !== item.work) item.rows = mapAmidoRows(ctx, item.rows, p.work === "新調");
    item.work = p.work;
  } else if (Object.prototype.hasOwnProperty.call(p, "work")) item.work = undefined;
  if (p.bed) item.bed = p.bed;
  if (p.work && p.work !== "新調") item.bed = undefined;
  for (const k of ["side", "part", "size", "okiHeri", "heri", "noDisposal", "thin", "oneMat", "sash", "entrance"] as const) {
    if (p[k] !== undefined) (item as unknown as Record<string, unknown>)[k] = p[k];
  }
  if (item.group === "天地袋") item.part = "天・地袋";
  else if (p.side && !p.part && item.part && /中|天・地袋/.test(item.part)) item.part = undefined;
  if (p.addAddons?.length) item.addons = [...new Set([...item.addons, ...p.addAddons])];
  if (p.removeAddons?.length) item.addons = item.addons.filter((a) => !p.removeAddons?.includes(a));
  if (qty) item.qty = qtyAdd && item.qty ? addQty(item.qty, qty) : qty;
}

/** 網戸の張替え ↔ 新調 を切り替えたときに、同じ網の行に読み替える */
function mapAmidoRows(ctx: Ctx, rows: string[], toNew: boolean): string[] {
  const t = ctx.byKind.get("amido");
  if (!t || !rows.length) return rows;
  const keys = ["ステンレス", "18メッシュ", "24メッシュ", "ガラスネット", "銀黒", "ペットディフェンス"];
  const mapped = rows
    .map((l) => {
      const key = keys.find((k) => nk(l).includes(k));
      if (!key) return null;
      return t.rows.find((r) => /新調/.test(r.label) === toNew && nk(r.label).includes(key) && (key !== "18メッシュ" || !/ステン/.test(r.label)))?.label ?? null;
    })
    .filter((l): l is string => Boolean(l));
  return [...new Set(mapped)];
}

function newItem(group: Group): Item {
  return { group, rows: [], addons: [], ...(group === "天地袋" ? { part: "天・地袋" } : {}) };
}

function hasInfo(p: Parsed): boolean {
  return p.patches.size > 0 || p.qtys.size > 0 || Boolean(p.implicit) || Boolean(p.implicitQty) || Boolean(p.implicitPieces) || p.removed.length > 0 || Boolean(p.only);
}

function step(ctx: Ctx, state: State, raw: string): { parsed: Parsed; priceAsk: boolean } {
  const parsed = parseMessage(ctx, raw, state);
  const text = norm(raw);
  const priceAsk = (PRICE_INTENT.test(text) || QUOTE_ASK.test(text)) && !UNIT_ASK.test(text);

  for (const g of parsed.removed) {
    state.items.delete(g);
    state.focus = state.focus.filter((f) => f !== g);
    parsed.patches.delete(g);
    parsed.qtys.delete(g);
  }
  const explicit = [...new Set([...parsed.patches.keys(), ...parsed.qtys.keys()])];
  for (const g of explicit) {
    const item = state.items.get(g) ?? newItem(g);
    applyPatch(ctx, item, parsed.patches.get(g) ?? {}, parsed.qtys.get(g) ?? null, parsed.additive, parsed.qtyAdd);
    state.items.set(g, item);
  }
  if (explicit.length) {
    const fresh = explicit.filter((g) => !state.focus.includes(g));
    if (parsed.additive || parsed.total) state.focus = [...new Set([...state.focus, ...explicit])];
    else if (fresh.length) state.focus = explicit;
  }
  // 商品の言葉がない指定 → 相談中の商品へ
  if (parsed.implicit || parsed.implicitQty || parsed.implicitPieces) {
    const p = parsed.implicit ?? {};
    const focusItems = (state.focus.length ? state.focus : [...state.items.keys()]).map((g) => state.items.get(g)).filter((i): i is Item => Boolean(i));
    const accepts = (i: Item) => {
      if (parsed.implicitQty) return i.group === "畳";
      if (p.rows?.length) return p.rowKind ? i.group === "畳" : true;
      if (p.side || p.part) return i.group === "襖";
      if (p.size || p.sash !== undefined || p.entrance) return i.group === "障子" || i.group === "網戸";
      if (p.heri || p.noDisposal !== undefined || p.thin !== undefined || p.addAddons?.length || p.bed || p.kind) return i.group === "畳";
      return true;
    };
    let target = [...focusItems].reverse().find(accepts);
    if (!target && (parsed.implicitQty || p.rowKind)) {
      target = newItem("畳");
      state.items.set("畳", target);
      state.focus = ["畳"];
    }
    if (target) {
      const qty = parsed.implicitQty ?? (parsed.implicitPieces ? { n: parsed.implicitPieces, half: 0, unit: "枚" as const } : null);
      applyPatch(ctx, target, p, qty, parsed.additive, parsed.qtyAdd);
      if (!state.focus.includes(target.group)) state.focus = [...state.focus, target.group];
    }
  }
  if (parsed.only && state.items.has(parsed.only)) state.focus = [parsed.only];
  if (parsed.total && !explicit.length) state.focus = [...state.items.keys()].filter((g) => state.items.get(g)?.qty);
  return { parsed, priceAsk };
}

// ---------------- 計算 ----------------

interface Part {
  label: string;
  amount: number;
  /** 「16,500円×6畳」 */
  calc?: string;
}

interface Calc {
  total: number;
  parts: Part[];
  /** ヘリのグレードが決まっていない（スプレッドシートに標準のグレードがない）：ヘリ代は幅で案内 */
  heriOpen?: { pieces: number; min: number; max: number };
}

/** ヘリ代を含めた合計の幅（ヘリのグレードが決まっていれば 1 つの金額） */
function withHeri(c: Calc): [number, number] {
  const o = c.heriOpen;
  return o ? [c.total + o.min * o.pieces, c.total + o.max * o.pieces] : [c.total, c.total];
}

const yen = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(Math.round(n)).toLocaleString("ja-JP")}円`;
const price = (v: string | undefined) => (v && /^[\d,]+$/.test(v.trim()) ? Number(v.replace(/,/g, "")) : undefined);

function resolveKind(item: Item): Kind {
  if (item.group === "畳") return item.kind ?? "tatami";
  return fittingKind(item.group, item.work);
}

/** 計算に使う列（未指定なら比べられるように 2 列） */
function resolveCols(t: PriceTable, kind: Kind, item: Item): { cols: number[]; defaulted?: string; unavailable?: string } {
  const idx = (re: RegExp) => t.columns.findIndex((c) => re.test(nk(c)));
  if (kind === "tatami" || kind === "herinashi" || kind === "heriari") {
    const omote = idx(/^表替え$/);
    const bedRe = item.bed === "ワラ" ? /ワラ/ : item.bed === "ボード" ? /ボード/ : item.bed === "床暖" ? /床暖/ : item.bed === "置き畳床" ? /置き畳床/ : /3型/;
    let shin = idx(new RegExp(`新調.*${bedRe.source}`));
    if (shin < 0 && item.bed) return { cols: [], unavailable: `${t.title}の料金表に、ご指定の畳床（${item.bed}）の新調の料金がありません` };
    if (shin < 0) shin = idx(/新調/);
    if (item.work === "表替え" || item.work === "ウラ返し") return omote >= 0 ? { cols: [omote] } : { cols: [], unavailable: "表替えの料金が料金表にありません" };
    if (item.work === "新調") return shin >= 0 ? { cols: [shin] } : { cols: [], unavailable: "新調の料金が料金表にありません" };
    return { cols: [omote, shin].filter((i) => i >= 0) };
  }
  if (kind === "oki") {
    if (item.okiHeri) return { cols: [idx(new RegExp(`^${item.okiHeri}$`))].filter((i) => i >= 0) };
    return { cols: t.columns.map((_, i) => i) };
  }
  if (kind === "fusuma" || kind === "fusumaNew") {
    const side = item.side;
    let label: string | null = null;
    if (item.part === "仏間") label = "仏間";
    else if (item.part === "幅広") label = side === "両面" ? "幅広両面" : "幅広片面";
    else if (item.part === "板戸") label = side === "両面" ? "板戸両面" : "板片";
    else if (item.part === "天・地袋") label = "天・地袋";
    else if (item.part === "中") label = "中";
    else if (side) label = side;
    if (label) {
      const i = t.columns.findIndex((c) => nk(c) === nk(label as string));
      return i >= 0 ? { cols: [i] } : { cols: [], unavailable: `${label}の${kind === "fusumaNew" ? "新調" : "張替え"}の料金が料金表にありません` };
    }
    return { cols: [idx(/^片面$/), idx(/^両面$/)].filter((i) => i >= 0) };
  }
  // 障子・網戸：大きさ（未指定は「大」で計算）
  const size = item.size ?? "大";
  const i = t.columns.findIndex((c) => nk(c) === size);
  if (i < 0) return { cols: [], unavailable: `${size}の大きさの料金が料金表にありません` };
  return { cols: [i], defaulted: item.size ? undefined : "大" };
}

/** 表示用：NFKC で半角になったかっこ・コロンを全角に戻す */
function disp(s: string): string {
  return s.replace(/\(/g, "（").replace(/\)/g, "）").replace(/:/g, "：").replace(/~/g, "〜");
}

function rowName(label: string): string {
  // ②などの丸数字は NFKC で数字にしない
  return disp(label.replace(/[^①-⑳]+/g, (m) => m.normalize("NFKC")))
    .replace(/\s*※\s*/g, "・")
    .replace(/\s+/g, " ")
    .trim();
}

function shortName(label: string): string {
  const n = rowName(label);
  return n.split(/[\s（・]/)[0] || n;
}

/** 見出しに添える列（「（畳床：本ワラ）」「（両面）」「（中）」）。表替えや未指定は空 */
function colDetail(r: { t: PriceTable; cols: number[] }): string {
  if (r.cols.length !== 1) return "";
  const c = disp(nk(r.t.columns[r.cols[0]]));
  if (/^表替え$/.test(c)) return "";
  if (/^新調/.test(c)) return c.replace(/^新調/, "");
  return `（${c}）`;
}

function qtyLabel(kind: Kind, item: Item): string {
  const q = item.qty as Qty;
  if (kind === "herinashi" || kind === "oki") {
    if (item.oneMat && kind === "herinashi") return `一畳物${q.n + q.half}枚`;
    const pieces = (q.unit === "畳" ? q.n * 2 : q.n) + q.half;
    return q.unit === "畳" && q.n ? `${q.n}畳${q.half === 1 ? "半" : q.half ? `＋半畳${q.half}枚` : ""}（半畳${pieces}枚）` : `半畳${pieces}枚`;
  }
  if (kind === "tatami" || kind === "heriari") {
    if (q.unit === "枚") return `${q.n ? `${q.n}枚` : ""}${q.half ? `${q.n ? "＋" : ""}半畳${q.half}枚` : ""}`;
    if (!q.n) return `半畳${q.half}枚`;
    return `${q.n}畳${q.half === 1 ? "半" : q.half ? `＋半畳${q.half}枚` : ""}`;
  }
  return `${q.n}枚`;
}

function compute(ctx: Ctx, kind: Kind, item: Item, t: PriceTable, row: PriceRow, ci: number): Calc | null {
  const p = price(row.values[ci]);
  if (!p) return null;
  const rules = ctx.rules.get(kind);
  const q = item.qty as Qty;
  const parts: Part[] = [];
  let heriOpen: Calc["heriOpen"];
  const colName = disp(nk(t.columns[ci]));
  const name = rowName(row.label);
  if (kind === "tatami" || kind === "heriari") {
    const full = q.n;
    const half = q.half;
    const pieces = full + half;
    const unitWord = half ? "枚" : "畳";
    if (full) parts.push({ label: `${name}（${colName}）`, amount: p * full, calc: `${yen(p)}×${full}${q.unit === "枚" ? "枚" : "畳"}` });
    if (half) {
      const rate = full === 0 ? (rules?.allHalfRate ?? rules?.halfRate) : rules?.halfRate;
      if (!rate) return null;
      const hp = Math.round(p * rate);
      parts.push({ label: `${name}（${colName}）半畳・${Math.round(rate * 10)}掛け`, amount: hp * half, calc: `${yen(hp)}×${half}枚` });
    }
    if (kind === "tatami" && rules?.heriSeparate) {
      const heri = item.heri ?? (ctx.heriDefault ? { price: ctx.heriDefault, label: `${ctx.heriDefault.toLocaleString("ja-JP")}円のグレード` } : null);
      if (heri) parts.push({ label: `ヘリ代（${heri.label}）`, amount: heri.price * pieces, calc: `${yen(heri.price)}×${pieces}${unitWord}` });
      else if (ctx.heriGrades.length) {
        const prices = ctx.heriGrades.map((g) => g.price);
        heriOpen = { pieces, min: Math.min(...prices), max: Math.max(...prices) };
      }
    }
    if (item.noDisposal && /新調/.test(colName) && rules?.noDisposal) {
      const d = rules.noDisposal;
      const amt = d * full + Math.round(d / 2) * half;
      parts.push({ label: "古い畳の処分なし", amount: -amt, calc: `${yen(-d)}×${full}畳${half ? `＋${yen(-Math.round(d / 2))}×半畳${half}枚` : ""}` });
    }
    if (item.thin && rules?.thin && rules.thin.col.test(colName)) parts.push({ label: "うす畳", amount: rules.thin.amount * pieces, calc: `${yen(rules.thin.amount)}×${pieces}${unitWord}` });
    for (const a of item.addons) {
      const v = rules?.addons[a];
      if (!v || (a === "殺菌乾燥" && !/表替え/.test(colName))) continue;
      parts.push({ label: a === "マイトスタット" ? "マイトスタット（防ダニ）" : a === "殺菌乾燥" ? "畳の殺菌乾燥" : a, amount: v * pieces, calc: `${yen(v)}×${pieces}${unitWord}` });
    }
  } else if (kind === "herinashi" || kind === "oki") {
    const pieces = (q.unit === "畳" ? q.n * 2 : q.n) + q.half;
    if (item.oneMat && kind === "herinashi") {
      if (!rules?.oneMatRate) return null;
      const one = Math.round(p * rules.oneMatRate);
      const count = q.n + q.half;
      parts.push({ label: `${name}（${colName}）一畳物・半帖の${rules.oneMatRate}倍`, amount: one * count, calc: `${yen(one)}×${count}枚` });
    } else parts.push({ label: `${name}（${colName}）`, amount: p * pieces, calc: `${yen(p)}×半畳${pieces}枚` });
    if (item.thin && rules?.thin && rules.thin.col.test(colName)) parts.push({ label: "うす畳", amount: rules.thin.amount * pieces, calc: `${yen(rules.thin.amount)}×${pieces}枚` });
  } else {
    const n = q.n;
    parts.push({ label: `${name}（${colName}）`, amount: p * n, calc: `${yen(p)}×${n}枚` });
    if (kind === "shoji" && item.sash && rules?.sash) parts.push({ label: "サッシ障子の加算", amount: rules.sash * n, calc: `${yen(rules.sash)}×${n}枚` });
    if (kind === "amido" && item.entrance && rules?.entrance) parts.push({ label: "玄関・勝手口の加算", amount: rules.entrance * n, calc: `${yen(rules.entrance)}×${n}枚` });
    if (kind === "amido" && /新調/.test(row.label) && rules?.newFee) parts.push({ label: "採寸・取付け費", amount: rules.newFee });
  }
  return { total: parts.reduce((s, x) => s + x.amount, 0), parts, heriOpen };
}

/** 一覧に出す品名（料金のあるもの。案内文で名前が挙がるものは必ず含める） */
function listRows(t: PriceTable, kind: Kind, item: Item, cols: number[]): PriceRow[] {
  let rows = t.rows.filter((r) => cols.some((i) => price(r.values[i])) && !/セット|枠交換|ウラ返し/.test(r.label));
  if (kind === "amido") rows = rows.filter((r) => /新調/.test(r.label) === (item.work === "新調"));
  const seen = new Set<string>();
  rows = rows.filter((r) => (seen.has(nk(r.label)) ? false : (seen.add(nk(r.label)), true)));
  if (item.pick) {
    const v = (r: PriceRow) => price(r.values[cols[0]]) ?? price(r.values[cols[1] ?? cols[0]]) ?? 0;
    const sorted = [...rows].sort((a, b) => v(a) - v(b));
    return [item.pick === "cheap" ? sorted[0] : sorted[sorted.length - 1]].filter(Boolean);
  }
  const max = kind === "tatami" ? 10 : 8;
  if (rows.length <= max) return rows;
  const guide = normPrice((t.guides ?? []).map((g) => g.text).join(""));
  const must = rows.filter((r) => labelTokens(r.label).some((tok) => guide.includes(tok)));
  const fill = rows.filter((r) => !must.includes(r)).slice(0, Math.max(0, max - must.length));
  const keep = new Set([...must, ...fill]);
  return rows.filter((r) => keep.has(r));
}

function itemTitle(kind: Kind, item: Item): string {
  const w = item.work === "ウラ返し" ? "裏返し" : item.work;
  if (item.group === "天地袋") return kind === "fusumaNew" ? "天袋・地袋の襖の新調" : "天袋・地袋の襖の張替え";
  switch (kind) {
    case "tatami":
      return w ? `畳の${w}` : "畳（表替え・新調）";
    case "herinashi":
      return w ? `ヘリ無し畳の${w}` : "ヘリ無し畳（表替え・新調）";
    case "heriari":
      return w ? `ヘリ有り畳（1畳物）の${w}` : "ヘリ有り畳（1畳物）";
    case "oki":
      return "置き畳";
    case "fusuma":
      return "襖の張替え";
    case "fusumaNew":
      return "襖の新調";
    case "shoji":
      return "障子の張替え";
    default:
      return item.work === "新調" ? "網戸の新調" : "網戸の張替え";
  }
}

function material(kind: Kind): string {
  return kind.startsWith("fusuma") ? "襖紙" : kind === "shoji" ? "障子紙" : kind === "amido" ? "網" : "畳表";
}

function colShort(t: PriceTable, ci: number): string {
  const c = nk(t.columns[ci]);
  if (/^新調/.test(c)) return "新調";
  return disp(c);
}

interface Resolved {
  item: Item;
  kind: Kind;
  t: PriceTable;
  cols: number[];
  rows: PriceRow[];
  listing: boolean;
  defaulted?: string;
  /** 指定された品名のうち、料金を計算できないもの（時価など） */
  missing: string[];
}

function resolve(ctx: Ctx, item: Item): Resolved | { unavailable: string } | null {
  if (!item.qty) return null;
  const kind = resolveKind(item);
  if (item.group === "障子" && item.work === "新調") return { unavailable: "障子の新調は料金表にないため、現地を見てからのお見積りになります" };
  if (kind === "fusumaNew" && item.part === "板戸") {
    const g = (ctx.byKind.get("fusumaNew")?.guides ?? []).map((x) => x.text).find((x) => /戸襖|板戸/.test(x));
    return { unavailable: g ? g.replace(/^※/, "") : "戸襖（板戸）の新調は、現場を見てからのお見積りになります" };
  }
  if (item.work === "ウラ返し" && kind !== "tatami") return { unavailable: "裏返しの料金は通常の畳（ヘリ付き）の料金表にのみあります" };
  const t = ctx.byKind.get(kind);
  if (!t) return null;
  const { cols, defaulted, unavailable } = resolveCols(t, kind, item);
  if (unavailable) return { unavailable };
  if (!cols.length) return null;
  const q = item.qty;
  const isTatamiLike = kind === "tatami" || kind === "heriari" || kind === "herinashi" || kind === "oki";
  if (!isTatamiLike && q.unit !== "枚") return null;
  if (isTatamiLike && q.n + q.half <= 0) return null;
  let rows: PriceRow[];
  let listing = false;
  const missing: string[] = [];
  if (item.work === "ウラ返し") rows = t.rows.filter((r) => /ウラ返し/.test(r.label));
  else if (item.rows.length) {
    rows = item.rows.map((l) => t.rows.find((r) => r.label === l)).filter((r): r is PriceRow => Boolean(r));
    for (const r of rows) if (!cols.some((i) => price(r.values[i]))) missing.push(r.label);
    rows = rows.filter((r) => cols.some((i) => price(r.values[i])));
    if (!rows.length && !missing.length) {
      listing = true;
      rows = listRows(t, kind, item, cols);
    }
  } else {
    listing = !item.pick;
    rows = listRows(t, kind, item, cols);
  }
  return { item, kind, t, cols, rows, listing, defaulted, missing };
}

// ---------------- 回答文 ----------------

interface Built {
  reply: string;
  tableIds: string[];
  rows: number;
}

function footerNotes(ctx: Ctx, rs: Resolved[], question: string): string[] {
  const notes: string[] = [];
  const nq = normPrice(question);
  for (const r of rs) {
    const rules = ctx.rules.get(r.kind);
    const q = r.item.qty as Qty;
    if (r.kind === "tatami" && rules?.heriSeparate && !r.item.heri && ctx.heriDefault) {
      const alt = ctx.heriPopular.filter((v) => v > (ctx.heriDefault ?? 0));
      const pieces = q.n + q.half;
      notes.push(
        `※ヘリ代は、よく選ばれる${yen(ctx.heriDefault)}のグレード（無地）で計算しています。${alt.length ? `${yen(alt[0])}のグレードなら＋${yen((alt[0] - ctx.heriDefault) * pieces)}です。` : ""}`,
      );
    }
    if (r.kind === "tatami" && rules?.heriSeparate && !r.item.heri && !ctx.heriDefault && ctx.heriGrades.length) {
      const sorted = [...ctx.heriGrades].sort((a, b) => a.price - b.price);
      const ex = sorted[Math.floor(sorted.length / 2)];
      notes.push(`※ヘリ代はグレード（1畳あたり${yen(sorted[0].price)}〜${yen(sorted[sorted.length - 1].price)}）によって変わります。ヘリのグレードを教えていただければ、合計を1つの金額で計算します（例：「ヘリは${ex.price.toLocaleString("ja-JP")}円ので」）。`);
    }
    if ((r.kind === "tatami" || r.kind === "heriari") && q.half && rules?.halfRate)
      notes.push(`※半畳は料金表のとおり${Math.round((q.n ? rules.halfRate : (rules.allHalfRate ?? rules.halfRate)) * 10)}掛けで計算しています${r.kind === "tatami" ? "（ヘリ代は掛けません）" : ""}。`);
    const colNames = r.cols.map((i) => nk(r.t.columns[i]));
    if ((r.kind === "tatami" || r.kind === "heriari") && !r.listing && rules?.newIncludesDisposal && colNames.some((c) => /新調/.test(c)) && !r.item.noDisposal)
      notes.push(`※新調の料金には古い畳の処分費が含まれています${rules.noDisposal ? `（処分が不要なら1畳あたり${yen(rules.noDisposal)}引き）` : ""}。`);
    if (r.defaulted && rules?.sizeGuide) notes.push(`※大きさは「大」で計算しています。大きさの目安：${rules.sizeGuide.replace(/\//g, "／")}`);
    else if (r.defaulted) notes.push("※大きさは「大」で計算しています。");
    if (r.kind === "shoji" && !r.item.sash && rules?.sash) notes.push(`※サッシ障子は1枚あたり＋${yen(rules.sash)}です。`);
    if (r.kind === "amido" && !r.item.entrance && rules?.entrance) notes.push(`※玄関・勝手口の網戸は1枚あたり＋${yen(rules.entrance)}です。`);
    if (r.kind === "fusumaNew" && rules?.oldDisposal) notes.push(`※古い襖の処分が必要な場合は、1本${yen(rules.oldDisposal)}かかります（${q.n}本で${yen(rules.oldDisposal * q.n)}）。`);
    if (r.kind === "fusuma" && rules?.repairFrom) notes.push(`※破れがひどい場合の下地補修（1枚${yen(rules.repairFrom)}〜）など、襖の状態によって追加がかかる場合があります。`);
    if (r.kind === "herinashi" && r.item.inferredKind)
      notes.push("※ご指定の畳表は、ヘリ無し畳（半畳）の料金で計算しています。ヘリ有りをご希望の場合はお知らせください。");
    for (const m of r.missing) {
      const v = r.cols.map((i) => r.t.rows.find((x) => x.label === m)?.values[i]).find((x) => x && x.trim());
      notes.push(`※${rowName(m)}は${v && /時価/.test(v) ? "時価のため" : "料金表に金額がないため"}、お見積りでご案内します。`);
    }
    if (r.listing) {
      for (const g of r.t.guides ?? []) {
        if (g.when) {
          try {
            if (!new RegExp(g.when).test(nq)) continue;
          } catch {
            continue;
          }
        }
        notes.push(g.text.startsWith("※") ? g.text : `※${g.text}`);
      }
    }
  }
  return [...new Set(notes)];
}

function closing(ctx: Ctx): string {
  return `※料金表${ctx.revised ? `（${ctx.revised}改定）` : ""}の単価から計算した目安（税込）です。正式なお見積りは、担当者が現地を確認してから無料で提出します。`;
}

function expensesLine(ctx: Ctx): Part | null {
  return ctx.expenses ? { label: "諸経費（工事全体で一式）", amount: ctx.expenses } : null;
}

function buildText(ctx: Ctx, rs: Resolved[], unavailable: string[], question: string): string {
  const exp = expensesLine(ctx);
  const lines: string[] = [];
  const single = rs.length === 1;
  if (single) {
    const r = rs[0];
    const title = `${itemTitle(r.kind, r.item)}${colDetail(r)}・${qtyLabel(r.kind, r.item)}`;
    const calcs = r.rows.map((row) => ({ row, per: r.cols.map((ci) => compute(ctx, r.kind, r.item, r.t, row, ci)) }));
    if (!r.listing && r.rows.length === 1 && r.cols.length === 1 && calcs[0].per[0]) {
      const c = calcs[0].per[0] as Calc;
      lines.push(`【お見積りの目安】${title}`);
      for (const p of [...c.parts, ...(exp ? [exp] : [])]) lines.push(`・${p.label}：${p.calc ? `${p.calc}＝` : ""}${yen(p.amount)}`);
      const o = c.heriOpen;
      if (o) {
        lines.push(`・ヘリ代（グレードにより1畳あたり${yen(o.min)}〜${yen(o.max)}）：${yen(o.min * o.pieces)}〜${yen(o.max * o.pieces)}`);
        const [lo, hi] = withHeri(c);
        lines.push(`合計の目安：${yen(lo + (exp?.amount ?? 0))}〜${yen(hi + (exp?.amount ?? 0))}（税込・ヘリのグレードによる）`);
      } else lines.push(`合計の目安：${yen(c.total + (exp?.amount ?? 0))}（税込）`);
    } else {
      const multiCol = r.cols.length > 1;
      const open = calcs.map((x) => x.per.find((c) => c?.heriOpen)?.heriOpen).find(Boolean);
      lines.push(`【お見積りの目安】${title}${r.listing ? `（${material(r.kind)}の種類別${open ? "・ヘリ代別" : ""}）` : open ? "（ヘリ代別）" : ""}`);
      const totals: number[] = [];
      for (const { row, per } of calcs) {
        const vals = per.map((c, i) => (c ? { col: colShort(r.t, r.cols[i]), total: c.total + (exp?.amount ?? 0) } : null));
        const ok = vals.filter((v): v is { col: string; total: number } => Boolean(v));
        if (!ok.length) continue;
        totals.push(...ok.map((v) => v.total));
        const unit = !multiCol ? price(row.values[r.cols[0]]) : undefined;
        const unitWord = r.kind === "tatami" || r.kind === "heriari" ? "1畳" : r.kind === "herinashi" || r.kind === "oki" ? "半畳1枚" : "1枚";
        lines.push(
          multiCol
            ? `・${rowName(row.label)}：${vals.map((v, i) => (v ? `${v.col} ${yen(v.total)}` : `${colShort(r.t, r.cols[i])} —`)).join("／")}`
            : `・${rowName(row.label)}${unit ? `（${unitWord} ${yen(unit)}）` : ""}：${yen(ok[0].total)}`,
        );
      }
      if (open) {
        // ヘリ代は別に幅で案内し、合計の幅にはヘリ代も含める
        lines.push(`・ヘリ代：${qtyLabel(r.kind, r.item)}で${yen(open.min * open.pieces)}〜${yen(open.max * open.pieces)}（1畳あたり${yen(open.min)}〜${yen(open.max)}・グレードによる）`);
        if (totals.length) lines.push(`合計の目安：${yen(Math.min(...totals) + open.min * open.pieces)}〜${yen(Math.max(...totals) + open.max * open.pieces)}（税込・ヘリ代を含む）`);
      } else if (totals.length > 1) lines.push(`合計の目安：${yen(Math.min(...totals))}〜${yen(Math.max(...totals))}（税込）`);
      else if (totals.length === 1) lines.push(`合計の目安：${yen(totals[0])}（税込）`);
      // 計算のしかた
      const sample = calcs.find((x) => x.per.some(Boolean));
      const c0 = sample?.per.find(Boolean);
      if (c0) {
        const extras = c0.parts.slice(1).filter((p) => !/半畳/.test(p.label));
        const head = material(r.kind);
        const q = r.item.qty as Qty;
        const qtyWord = r.kind === "herinashi" || r.kind === "oki" ? `半畳${(q.unit === "畳" ? q.n * 2 : q.n) + q.half}枚` : qtyLabel(r.kind, r.item);
        lines.push(
          `※計算：${head}の単価×${qtyWord}${extras.map((p) => `＋${p.label.replace(/（.*$/, "")}${p.calc ? p.calc : yen(p.amount)}`).join("")}${exp ? `＋諸経費${yen(exp.amount)}` : ""}${c0.heriOpen ? "（一覧の金額はヘリ代を含みません）" : ""}`,
        );
      }
      if (r.listing) {
        const shown = new Set(r.rows.map((x) => nk(x.label)));
        const rest = r.t.rows.filter(
          (x) => !shown.has(nk(x.label)) && r.cols.some((i) => price(x.values[i])) && !/セット|枠交換|ウラ返し/.test(x.label) && (r.kind !== "amido" || /新調/.test(x.label) === (r.item.work === "新調")),
        );
        if (rest.length) lines.push(`（このほか、${[...new Set(rest.map((x) => shortName(x.label)))].slice(0, 6).join("・")}なども計算できます）`);
      }
    }
  } else {
    lines.push(`【お見積りの目安】${rs.map((r) => `${itemTitle(r.kind, r.item)}${colDetail(r)} ${qtyLabel(r.kind, r.item)}`).join("＋")}`);
    let min = 0;
    let max = 0;
    let exact = true;
    for (const r of rs) {
      const all = r.rows.flatMap((row) => r.cols.map((ci) => ({ row, ci, c: compute(ctx, r.kind, r.item, r.t, row, ci) }))).filter((x) => x.c);
      if (!all.length) continue;
      const head = `${itemTitle(r.kind, r.item)} ${qtyLabel(r.kind, r.item)}`;
      if (all.length === 1) {
        const { row, ci, c } = all[0];
        const calc = c as Calc;
        const o = calc.heriOpen;
        const pieces = calc.parts.map((p) => `${p.label.replace(/（.*$/, "")}${yen(p.amount)}`);
        if (o) pieces.push(`ヘリ代${yen(o.min * o.pieces)}〜${yen(o.max * o.pieces)}`);
        const detail = pieces.length > 1 ? `（${pieces.join("＋")}）` : "";
        const [lo, hi] = withHeri(calc);
        lines.push(`・${head}（${rowName(row.label)}・${colShort(r.t, ci)}）：${lo === hi ? yen(lo) : `${yen(lo)}〜${yen(hi)}`}${detail}`);
        min += lo;
        max += hi;
        if (lo !== hi) exact = false;
      } else {
        exact = false;
        const los = all.map((x) => withHeri(x.c as Calc)[0]);
        const his = all.map((x) => withHeri(x.c as Calc)[1]);
        const heriWord = all.some((x) => x.c?.heriOpen) ? "・ヘリ" : "";
        lines.push(`・${head}：${yen(Math.min(...los))}〜${yen(Math.max(...his))}（種類${r.cols.length > 1 ? "・" + r.cols.map((i) => colShort(r.t, i)).join("/") : ""}${heriWord}による）`);
        min += Math.min(...los);
        max += Math.max(...his);
      }
    }
    if (exp) {
      lines.push(`・${exp.label}：${yen(exp.amount)}`);
      min += exp.amount;
      max += exp.amount;
    }
    lines.push(exact ? `合計の目安：${yen(min)}（税込）` : `合計の目安：${yen(min)}〜${yen(max)}（税込）`);
    if (!exact) lines.push("※種類（畳表・襖紙など）や片面／両面を教えていただければ、合計を1つの金額で計算します。");
  }
  lines.push(...footerNotes(ctx, rs, question));
  for (const u of unavailable) lines.push(`※${u}。`);
  lines.push(closing(ctx));
  return lines.join("\n");
}

function buildVoice(ctx: Ctx, rs: Resolved[], unavailable: string[]): string {
  const exp = ctx.expenses ?? 0;
  const out: string[] = [];
  if (rs.length === 1) {
    const r = rs[0];
    const title = `${qtyLabel(r.kind, r.item).replace(/（.*）/, "")}の${itemTitle(r.kind, r.item)}`;
    const calcs = r.rows.flatMap((row) => r.cols.map((ci) => ({ row, ci, c: compute(ctx, r.kind, r.item, r.t, row, ci) }))).filter((x) => x.c);
    if (calcs.length === 1) {
      const c = calcs[0].c as Calc;
      const name = rowName(calcs[0].row.label);
      // 「やすらぎが99,000円」ではなく「畳表が99,000円」と話す
      const spoken = (p: Part) => (p.label.startsWith(name) ? (/半畳/.test(p.label) ? "半畳の分" : material(r.kind)) : p.label.replace(/（.*$/, ""));
      const parts = c.parts.map((p) => `${spoken(p)}が${yen(p.amount)}`).join("、");
      const o = c.heriOpen;
      if (o) {
        out.push(`${rowName(calcs[0].row.label)}で、${title}をされる場合、${parts}${exp ? `、諸経費が${yen(exp)}` : ""}で、ヘリ代をのぞいた合計は${yen(c.total + exp)}です。`);
        out.push(`ヘリ代はグレードによって、${yen(o.min * o.pieces)}から${yen(o.max * o.pieces)}かかります。`);
      } else out.push(`${rowName(calcs[0].row.label)}で、${title}をされる場合、${parts}${exp ? `、諸経費が${yen(exp)}` : ""}で、合計の目安は${yen(c.total + exp)}です。`);
    } else if (calcs.length > 1) {
      const quoted = (r.t.guides ?? []).flatMap((g) => [...g.text.matchAll(/「([^」]+)」/g)].map((m) => m[1]));
      const pickRows = calcs.filter((x) => quoted.some((qn) => nk(x.row.label).includes(nk(qn)))).slice(0, 2);
      // スプレッドシートに「おすすめ」などの案内がある品名だけを例に挙げ、ほかは幅で伝える
      const named = pickRows.map((x) => `${shortName(x.row.label)}${r.cols.length > 1 ? `の${colShort(r.t, x.ci)}` : ""}で${yen((x.c as Calc).total + exp)}`);
      const ts = calcs.map((x) => (x.c as Calc).total + exp);
      const word = calcs.some((x) => x.c?.heriOpen) ? "ヘリ代をのぞいた合計の目安" : "合計の目安";
      out.push(
        named.length
          ? `${title}の${word}は、${named.join("、")}です。種類によって${yen(Math.min(...ts))}から${yen(Math.max(...ts))}まであります。`
          : `${title}の${word}は、${material(r.kind)}の種類によって${yen(Math.min(...ts))}から${yen(Math.max(...ts))}です。`,
      );
      const o = calcs.find((x) => x.c?.heriOpen)?.c?.heriOpen;
      if (o) out.push(`ヘリ代は別に、グレードによって${yen(o.min * o.pieces)}から${yen(o.max * o.pieces)}かかります。`);
      else if (r.kind === "tatami" && ctx.heriDefault) out.push(`ヘリ代は${yen(ctx.heriDefault)}のグレードで計算しています。`);
    }
  } else {
    let min = exp;
    let max = exp;
    const names: string[] = [];
    for (const r of rs) {
      const cs = r.rows.flatMap((row) => r.cols.map((ci) => compute(ctx, r.kind, r.item, r.t, row, ci))).filter((c): c is Calc => Boolean(c));
      if (!cs.length) continue;
      min += Math.min(...cs.map((c) => withHeri(c)[0]));
      max += Math.max(...cs.map((c) => withHeri(c)[1]));
      names.push(`${itemTitle(r.kind, r.item)}${qtyLabel(r.kind, r.item).replace(/（.*）/, "")}`);
    }
    out.push(`${names.join("と")}で、諸経費を含めた合計の目安は${min === max ? `${yen(min)}です。` : `${yen(min)}から${yen(max)}です。種類を教えていただければ、1つの金額で計算します。`}`);
  }
  for (const u of unavailable) out.push(`${u}。`);
  out.push("正式なお見積りは、担当者が現地を見てから無料でお出しします。");
  return voiceClean(out.join(""));
}

function build(ctx: Ctx, state: State, question: string, style: AnswerStyle): Built | null {
  const focus = state.focus.map((g) => state.items.get(g)).filter((i): i is Item => Boolean(i));
  const resolved: Resolved[] = [];
  const unavailable: string[] = [];
  for (const item of focus) {
    if (!item.qty) {
      unavailable.push(`${itemTitle(resolveKind(item), item).replace(/（.*）/, "")}の${item.group === "畳" ? "畳数" : "枚数"}を教えていただければ、合わせて計算します`);
      continue;
    }
    const r = resolve(ctx, item);
    if (!r) continue;
    if ("unavailable" in r) unavailable.push(r.unavailable);
    else if (r.rows.length || r.missing.length) resolved.push(r);
  }
  const computable = resolved.filter((r) => r.rows.some((row) => r.cols.some((ci) => compute(ctx, r.kind, r.item, r.t, row, ci))));
  if (!computable.length) {
    if (!resolved.length) return null;
    // 指定の品名が時価などで計算できない
    const notes = footerNotes(ctx, resolved, question).filter((n) => /お見積りでご案内/.test(n));
    if (!notes.length) return null;
    const text = [...notes, closing(ctx)].join("\n");
    return { reply: style === "voice" ? voiceClean(text) : text, tableIds: resolved.map((r) => r.t.id), rows: 0 };
  }
  const reply = style === "voice" ? buildVoice(ctx, computable, unavailable) : buildText(ctx, computable, unavailable, question);
  const ids = computable.map((r) => r.t.id);
  if (computable.some((r) => r.kind === "tatami") && ctx.heriTable) ids.push(ctx.heriTable.id);
  return { reply, tableIds: [...new Set(ids)], rows: computable.reduce((s, r) => s + r.rows.length, 0) };
}

/**
 * 数量つきの料金の質問・見積の条件の訂正なら、料金表から合計の目安を計算した回答を返す。
 * それ以外（数量がない・料金の質問ではない・計算できない商品）は null。
 */
export function answerQuote(question: string, history: ChatMessage[], tables: PriceTable[], style: AnswerStyle = "text"): PriceAnswer | null {
  const ctx = buildCtx(tables);
  if (!ctx.byKind.size) return null;
  const said = [...history.filter((m) => m.role === "user").map((m) => m.content), question].slice(-12);
  const state: State = { items: new Map(), focus: [], lastQuote: false, lastPrice: false };
  let result: { quote: boolean; priceAsk: boolean } = { quote: false, priceAsk: false };
  for (let i = 0; i < said.length; i++) {
    const msg = said[i];
    const text = norm(msg);
    const prevQuote = state.lastQuote;
    const prevPrice = state.lastPrice;
    const { parsed, priceAsk } = step(ctx, state, msg);
    const other = (QUOTE_OTHER.test(text) && !priceAsk) || INCLUSION.test(text) || WHY_PRICE.test(text) || (UNIT_ASK.test(text) && !QUOTE_ASK.test(text));
    const complete = state.focus.some((g) => state.items.get(g)?.qty);
    const info = hasInfo(parsed);
    const quote = !other && complete && ((priceAsk && info) || (priceAsk && prevQuote) || ((prevQuote || prevPrice) && info));
    state.lastQuote = quote;
    // 料金の話が続いているか（「襖の張替えはいくら？」→「両面は？」→「4枚だと？」）
    state.lastPrice = !other && (priceAsk || quote || (prevPrice && info));
    if (i === said.length - 1) result = { quote, priceAsk };
  }
  if (!result.quote) return null;
  const built = build(ctx, state, question, style);
  const qtys = state.focus.map((g) => state.items.get(g)?.qty).filter((q): q is Qty => Boolean(q));
  const single = qtys.length > 0 && qtys.every((q) => q.n === 1 && q.half === 0);
  return built ? { reply: built.reply, tableIds: built.tableIds, rows: built.rows, single } : null;
}
