// エラー履歴の型と表示名（ブラウザ・サーバーの両方から使う）

export type ErrorSource = "openai" | "realtime" | "line" | "sheet" | "phone" | "browser" | "other";

export interface ErrorLogItem {
  at: string;
  source: ErrorSource;
  /** どこで起きたか（「文字の相談の回答」など） */
  where: string;
  message: string;
  count?: number;
}

export const ERROR_SOURCE_LABEL: Record<ErrorSource, string> = {
  openai: "OpenAI",
  realtime: "音声（Realtime）",
  line: "LINE",
  sheet: "スプレッドシート",
  phone: "電話（Twilio）",
  browser: "お客様の画面",
  other: "その他",
};
