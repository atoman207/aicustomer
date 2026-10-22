// 株式会社一畳屋（https://ichijoya.co.jp/）のブランド情報・リンク・画像アセット
// サーバー／クライアント共用（Node 専用 API は使わない）

export const BRAND = {
  name: "一畳屋",
  legalName: "株式会社一畳屋",
  freeDial: "0120-158-108",
  freeDialTel: "0120158108",
  hours: "8:00 - 17:00",
  hoursNote: "土日の工事もOK！（3週間前までに要予約）",
  /** 電話ボタンに添える一言（営業時間外・土日は AI が電話を受け付ける） */
  phoneAiNote: "営業時間外・土日はAIが受付",
  copyright: "© ICHIJOYA. All Rights Reserved.",
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

/**
 * AI 相談のメニュー。相談の窓口は 1 つ（トップページの「AIに相談する」の画面。その中で文字でも声でも）なので、
 * 見出しも「AI相談」だけ（一畳屋様のご要望 2026-10-23：「文字で相談」「声で相談」は不要）。電話はふつうの電話ボタン
 */
export const AI_NAV = [{ href: "/#ai-consult", label: "AI相談", short: "AI相談", icon: "ai", action: "text" }] as const;

/** キービジュアルの写真（WebP 1x/2x + PNG フォールバック） */
export function photo(name: string) {
  const base = `${A}/kv/${name}`;
  return { webp: `${base}.webp 1x, ${base}@2x.webp 2x`, png: `${base}.png` };
}

/** 旧デモ用の名称・番号（環境変数や保存済み設定に残っていても一畳屋の値に置き換える） */
export const LEGACY_COMPANY_NAMES = ["熊本たたみ工房（デモ）", "熊本たたみ工房"];
export const LEGACY_PHONES = ["0120-000-000"];
