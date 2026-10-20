// 株式会社一畳屋（https://ichijoya.co.jp/）のブランド情報・リンク・画像アセット
// サーバー／クライアント共用（Node 専用 API は使わない）

export const BRAND = {
  name: "一畳屋",
  legalName: "株式会社一畳屋",
  freeDial: "0120-158-108",
  freeDialTel: "0120158108",
  hours: "8:00 - 17:00",
  hoursNote: "土日の工事もOK！（3週間前までに要予約）",
  copyright: "© ICHIJOYA.All Rights Reserved.",
} as const;

export const LINKS = {
  /** 見積受付後の「LINEでも連絡を受け取る」（友だち追加） */
  lineFriend: "https://page.line.me/402irbdq",
} as const;

const A = "/ichijoya";

export const ASSETS = {
  logoColor: `${A}/logo-color.svg`,
  logoWhite: `${A}/logo-w.svg`,
  hyakunen: `${A}/100c.svg`,
  fukidashiFree: `${A}/fukidashi-free.svg`,
  freeDial: `${A}/t-red-freedial.svg`,
  uketsuke: `${A}/uketsuke-number.svg`,
  triggerLabel: `${A}/trigger-label.svg`,
  og: `${A}/og-img.png`,
  favicon: `${A}/favicon.png`,
  appleTouch: `${A}/apple-touch-icon.png`,
} as const;

/** 3つの相談窓口のメニュー */
export const AI_NAV = [
  { href: "/", label: "AI相談トップ", short: "トップ" },
  { href: "/chat", label: "文字で相談", short: "文字" },
  { href: "/voice", label: "声で相談", short: "声" },
  { href: "/phone", label: "AI電話受付", short: "電話" },
] as const;

/** キービジュアルの写真（WebP 1x/2x + PNG フォールバック） */
export function photo(name: string) {
  const base = `${A}/kv/${name}`;
  return { webp: `${base}.webp 1x, ${base}@2x.webp 2x`, png: `${base}.png` };
}

/** 旧デモ用の名称・番号（環境変数や保存済み設定に残っていても一畳屋の値に置き換える） */
export const LEGACY_COMPANY_NAMES = ["熊本たたみ工房（デモ）", "熊本たたみ工房"];
export const LEGACY_PHONES = ["0120-000-000"];
