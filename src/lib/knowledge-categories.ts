// 管理画面で情報を追加するときの分類（プルダウン）。ブラウザ・サーバーの両方から使う
export const SOURCE_CATEGORIES = [
  { value: "auto", label: "自動で分類（おまかせ）", entry: "" },
  { value: "company", label: "会社情報（会社概要・理念・店舗・営業時間）", entry: "会社情報" },
  { value: "price_manual", label: "料金表・顧客対応マニュアル（Excel を差し替え）", entry: "料金" },
  { value: "price", label: "料金（追加の料金表・料金の案内）", entry: "料金" },
  { value: "product", label: "商品・サービス（畳・襖・障子・網戸・リフォーム）", entry: "商品・サービス" },
  { value: "faq", label: "よくある質問", entry: "よくある質問" },
  { value: "work", label: "工期・施工の流れ・お見積り", entry: "工期・施工" },
  { value: "campaign", label: "キャンペーン・お知らせ", entry: "キャンペーン・お知らせ" },
  { value: "other", label: "その他", entry: "その他" },
] as const;

export type SourceCategory = (typeof SOURCE_CATEGORIES)[number]["value"];

/** AI が自動で分類するときの候補 */
export const ENTRY_CATEGORIES = ["会社情報", "料金", "商品・サービス", "よくある質問", "工期・施工", "お見積り・お問い合わせ", "キャンペーン・お知らせ", "その他"];

export function categoryOf(value: string) {
  return SOURCE_CATEGORIES.find((c) => c.value === value) ?? SOURCE_CATEGORIES[0];
}

/** アップロードできるファイル（拡張子） */
export const UPLOAD_ACCEPT = ".xlsx,.xlsm,.csv,.tsv,.txt,.md,.json,.html,.htm,.docx,.pptx,.pdf,.png,.jpg,.jpeg,.webp";

/** 1 ファイルの上限（Vercel のリクエスト上限 4.5MB に収まるように） */
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
