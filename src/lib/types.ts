// 共通型定義

export type Channel = "web_text" | "web_voice" | "phone" | "line";

export const CHANNEL_LABEL: Record<Channel, string> = {
  web_text: "テキスト相談（HP）",
  web_voice: "音声相談（HP）",
  phone: "AI電話受付",
  line: "LINE",
};

/** ナレッジの出どころ（manual＝Googleスプレッドシート・website＝ホームページ） */
export type KnowledgeOrigin = "manual" | "website";

export interface KnowledgeEntry {
  id: string;
  category: string;
  title: string;
  content: string;
  keywords: string[];
  note?: string;
  origin?: KnowledgeOrigin;
  /** お客様の聞き方の例 */
  questions?: string[];
  /** 話題（畳・襖・障子・網戸・店舗・会社・工期）。スプレッドシートとホームページで同じ話題ならスプレッドシートを正にする */
  topics?: string[];
}

/** 顧客対応マニュアルの読込元 */
export type KnowledgeSource = "gas" | "sheets_api" | "csv" | "json" | "local";

export interface KnowledgeStats {
  manualText: number;
  manualTables: number;
  website: number;
  excluded: number;
}

export interface KnowledgeSnapshot {
  entries: KnowledgeEntry[];
  /** 料金表（顧客対応マニュアルの表を構造化したもの。料金の質問はここから直接回答） */
  tables: import("./manual").PriceTable[];
  source: KnowledgeSource;
  sourceLabel: string;
  fetchedAt: string;
  sheetName?: string;
  warning?: string;
  /** 全ナレッジの版（内容のハッシュ）。学習済み回答の有効性の判定に使う */
  version: string;
  stats: KnowledgeStats;
  stale: { id: string; title: string; missing: string[] }[];
  excludedLines: string[];
  websiteFetchedAt?: string;
  websiteOrigin: "bundled" | "relearned";
  /** ホームページの内容を回答に使っているか（既定は使わない＝スプレッドシートだけ） */
  websiteUsed: boolean;
  /** Googleスプレッドシートの接続状況（connected＝今回シートから読めた） */
  sheet?: { configured: boolean; connected: boolean; via: "gas" | "csv" | "env" | null; url: string };
}

export interface SearchHit {
  entry: KnowledgeEntry;
  score: number;
}

export type EstimateStatus = "new" | "contacted" | "scheduled" | "closed";

/** 対応状況（管理画面と、受付一覧のシートの「ステータス」の欄で同じ言葉を使う） */
export const ESTIMATE_STATUS_LABEL: Record<EstimateStatus, string> = { new: "新規", contacted: "連絡済み", scheduled: "日程確定", closed: "完了" };

export interface EstimateRequest {
  id: string;
  receivedAt: string;
  channel: Channel;
  name: string;
  address: string;
  phone: string;
  summary: string;
  preferredDates: string[]; // 第1〜第3希望（自由書式）
  status: EstimateStatus;
  confirmedByCustomer: boolean;
  sessionId?: string;
  syncedTo: string[]; // "local" | "gas" | "sheets_api"
  syncError?: string;
  lineUserId?: string; // 受付後にお客様が LINE で受付番号を送ると連携される
  lineLinkedAt?: string;
  /** HP の確認画面：AI が会話から入力した項目と、お客様が修正した項目（name / address / phone / dates / summary） */
  autofill?: { filled: string[]; edited: string[] };
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  at?: string;
}

export interface ConversationLog {
  id: string;
  channel: Channel;
  startedAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  estimateId?: string;
  meta?: Record<string, string>;
}

export type PhoneMode = "ai_always" | "ai_off_hours" | "human_always";

export interface PhoneSettings {
  mode: PhoneMode;
  businessDays: number[]; // 0=日 ... 6=土
  openTime: string; // "08:00"
  closeTime: string; // "17:00"
  holidays: string[]; // "YYYY-MM-DD"
  forwardNumber: string;
}

export interface AppSettings {
  companyName: string;
  companyPhone: string;
  lineAddFriendUrl: string;
  /** 回答の情報源にする Googleスプレッドシートの URL（Apps Script・共有リンク・ウェブに公開。空なら環境変数） */
  knowledgeSheetUrl: string;
  greeting: string;
  phone: PhoneSettings;
  updatedAt: string;
  rev?: number; // 設定の版（既定値の移行に使用）
}

export interface IntakeDraft {
  name?: string;
  address?: string;
  phone?: string;
  dates: string[];
  summary?: string;
}

export type AgentStage = "consult" | "collecting" | "confirming" | "completed";

export interface AgentSession {
  id: string;
  channel: Channel;
  stage: AgentStage;
  draft: IntakeDraft;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  estimateId?: string;
  emptyTurns: number;
  fallbackStep?: string; // デモモード用の状態
  meta?: Record<string, string>;
}

export interface AgentTurnResult {
  reply: string;
  stage: AgentStage;
  draft: IntakeDraft;
  done: boolean; // 通話/会話を終了してよい
  estimate?: EstimateRequest;
  /** HP の声の相談：項目がそろったので画面に確認画面を表示する */
  formReady?: boolean;
  mode: "openai" | "demo";
  sources?: SearchHit[];
  /** 回答の出どころ（local / cache は OpenAI を使わずに回答） */
  answeredBy?: "local" | "cache" | "openai" | "notfound" | "smalltalk" | "demo";
}

export interface StorageInfo {
  backend: "redis" | "file" | "memory";
  persistent: boolean;
  label: string;
  detail?: string;
}

export interface IntegrationStatus {
  openai: { configured: boolean; model: string; answerModel: string; voiceAnswerModel: string; answerContext: "full" | "search"; realtimeModel: string; realtimeVoice: string; realtimeSpeed: number; ok?: boolean; detail?: string };
  storage: StorageInfo;
  knowledge: { source: KnowledgeSource; label: string; entries: number; fetchedAt: string; warning?: string };
  reception: { sink: "gas" | "sheets_api" | "local"; label: string };
  sheet: { configured: boolean; serviceAccount: string; sheetId: string };
  twilio: { configured: boolean; number: string; webhookUrl: string };
  line: { configured: boolean; webhookUrl: string; addFriendUrl: string };
  admin: { protected: boolean };
}

