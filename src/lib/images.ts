// サイトで使用する画像（すべて日本の風景・住まい）。クレジットはフッターと README に表示
export interface SiteImage {
  src: string;
  alt: string;
  title: string;
  credit: string;
  license: string;
  source: "Wikimedia Commons" | "Unsplash";
}

export const IMAGES = {
  hero: {
    src: "/images/hero-washitsu.jpg",
    alt: "障子越しの光が差し込む和室と庭（鳥取県・石谷家住宅）",
    title: "石谷家住宅の和室",
    credit: "663highland",
    license: "CC BY 2.5",
    source: "Wikimedia Commons",
  },
  tatami: {
    src: "/images/tatami-workshop.jpg",
    alt: "畳の製作・修理作業（い草と畳縫い機）",
    title: "畳の修理作業",
    credit: "Rosewoman",
    license: "CC BY 2.0",
    source: "Wikimedia Commons",
  },
  fusuma: {
    src: "/images/fusuma-entokuin.jpg",
    alt: "金碧の襖絵が並ぶ座敷（京都・圓徳院）",
    title: "圓徳院の襖絵",
    credit: "663highland",
    license: "CC BY 2.5",
    source: "Wikimedia Commons",
  },
  shoji: {
    src: "/images/shoji-yukimi.jpg",
    alt: "雪見障子から望む雪の庭",
    title: "雪見障子",
    credit: "Tamaki Sono",
    license: "CC BY 2.0",
    source: "Wikimedia Commons",
  },
  amido: {
    src: "/images/engawa-house.jpg",
    alt: "縁側と障子のある日本家屋の外観",
    title: "縁側のある日本家屋",
    credit: "Emzett85",
    license: "CC BY-SA 3.0",
    source: "Wikimedia Commons",
  },
  reform: {
    src: "/images/reform-washitsu.jpg",
    alt: "床の間と庭を望む和室（奈良県・高木家住宅）",
    title: "高木家住宅の和室",
    credit: "ignis",
    license: "CC BY-SA 3.0",
    source: "Wikimedia Commons",
  },
  kumamoto: {
    src: "/images/kumamoto-castle.jpg",
    alt: "熊本城の天守と石垣",
    title: "熊本城",
    credit: "663highland",
    license: "CC BY 2.5",
    source: "Wikimedia Commons",
  },
  washitsuLight: {
    src: "/images/washitsu-light.jpg",
    alt: "障子から柔らかな光が差す和室",
    title: "和室の内装",
    credit: "TANAKA Juuyoh（田中十洋）",
    license: "CC BY 2.0",
    source: "Wikimedia Commons",
  },
  shojiDoors: {
    src: "/images/shoji-miura.jpg",
    alt: "障子と縁側（福岡市・旧三浦家住宅）",
    title: "旧三浦家住宅の障子",
    credit: "LLAAYY",
    license: "CC BY 4.0",
    source: "Wikimedia Commons",
  },
  engawaGarden: {
    src: "/images/engawa-garden.jpg",
    alt: "縁側から眺める日本庭園（奥国家住宅）",
    title: "縁側と庭",
    credit: "Reggaeman",
    license: "CC BY-SA 3.0",
    source: "Wikimedia Commons",
  },
  shojiRoom: {
    src: "/images/shoji-tokike.jpg",
    alt: "障子と押入れのある和室（土岐家住宅）",
    title: "土岐家住宅の和室",
    credit: "妖精書士",
    license: "CC0",
    source: "Wikimedia Commons",
  },
  fusumaDragon: {
    src: "/images/fusuma-kotsuji.jpg",
    alt: "龍の水墨画が描かれた襖",
    title: "龍の襖絵",
    credit: "Asturio Cantabrio",
    license: "CC BY-SA 4.0",
    source: "Wikimedia Commons",
  },
  kyotoStreet: {
    src: "/images/kyoto-street.jpg",
    alt: "京都・八坂の塔へ続く石畳の坂道",
    title: "京都 八坂の塔",
    credit: "Unsplash 投稿者",
    license: "Unsplash License",
    source: "Unsplash",
  },
  fujiSakura: {
    src: "/images/fuji-sakura.jpg",
    alt: "桜越しに望む富士山",
    title: "富士山と桜",
    credit: "Unsplash 投稿者",
    license: "Unsplash License",
    source: "Unsplash",
  },
  hakoneTorii: {
    src: "/images/hakone-torii.jpg",
    alt: "杉木立の参道に立つ朱塗りの鳥居（箱根）",
    title: "箱根の鳥居",
    credit: "Unsplash 投稿者",
    license: "Unsplash License",
    source: "Unsplash",
  },
  tokyoAlley: {
    src: "/images/tokyo-alley.jpg",
    alt: "提灯が灯る東京の路地（思い出横丁）",
    title: "東京の路地",
    credit: "Unsplash 投稿者",
    license: "Unsplash License",
    source: "Unsplash",
  },
  meguroSakura: {
    src: "/images/meguro-sakura.jpg",
    alt: "目黒川の桜並木",
    title: "目黒川の桜",
    credit: "Unsplash 投稿者",
    license: "Unsplash License",
    source: "Unsplash",
  },
  chureitoFuji: {
    src: "/images/chureito-fuji.jpg",
    alt: "五重塔と富士山（新倉山浅間公園）",
    title: "忠霊塔と富士山",
    credit: "Unsplash 投稿者",
    license: "Unsplash License",
    source: "Unsplash",
  },
  kyotoPagoda: {
    src: "/images/kyoto-pagoda.jpg",
    alt: "秋の京都・清水寺の三重塔",
    title: "京都の三重塔",
    credit: "Unsplash 投稿者",
    license: "Unsplash License",
    source: "Unsplash",
  },
  kimonoShrine: {
    src: "/images/kimono-shrine.jpg",
    alt: "着物姿で手水舎に立つ参拝者",
    title: "神社と着物",
    credit: "Unsplash 投稿者",
    license: "Unsplash License",
    source: "Unsplash",
  },
  fushimiInari: {
    src: "/images/fushimi-inari.jpg",
    alt: "伏見稲荷大社の千本鳥居",
    title: "千本鳥居",
    credit: "Unsplash 投稿者",
    license: "Unsplash License",
    source: "Unsplash",
  },
  kyotoDusk: {
    src: "/images/kyoto-dusk.jpg",
    alt: "夕暮れの京都の街並みと塔",
    title: "夕暮れの京都",
    credit: "Unsplash 投稿者",
    license: "Unsplash License",
    source: "Unsplash",
  },
} as const satisfies Record<string, SiteImage>;

export type ImageKey = keyof typeof IMAGES;

export const IMAGE_CREDITS: (SiteImage & { key: ImageKey })[] = (Object.keys(IMAGES) as ImageKey[]).map((key) => ({
  key,
  ...IMAGES[key],
}));
