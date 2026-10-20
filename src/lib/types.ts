// 共通型定義

export type Channel = "web_text" | "web_voice" | "phone" | "line";

export const CHANNEL_LABEL: Record<Channel, string> = {
  web_text: "テキスト相談（HP）",
  web_voice: "音声相談（HP）",
  phone: "AI電話受付",
  line: "LINE",
};

/** ナレッジの出どころ（優先順：管理画面 → マニュアル → 会社情報 → ホームページ） */
export type KnowledgeOrigin = "manual" | "company" | "website" | "admin";

export interface KnowledgeEntry {
  id: string;
  category: string;
  title: string;
  content: string;
  keywords: string[];
  note?: string;
  origin?: KnowledgeOrigin;
  /** 会社情報の照合語（マニュアル／ホームページに含まれていなければ古い項目として使わない） */
  anchors?: string[];
  /** お客様の聞き方の例（近い質問にはこの項目をそのまま回答） */
  questions?: string[];
}

/** 顧客対応マニュアルの読込元 */
export type KnowledgeSource = "gas" | "sheets_api" | "csv" | "xlsx" | "local";

export interface KnowledgeStats {
  manualText: number;
  manualTables: number;
  company: number;
  companyStale: number;
  website: number;
  admin: number;
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
}

export interface SearchHit {
  entry: KnowledgeEntry;
  score: number;
}

export type EstimateStatus = "new" | "contacted" | "scheduled" | "closed";

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
  openai: { configured: boolean; model: string; realtimeModel: string; ok?: boolean; detail?: string };
  storage: StorageInfo;
  knowledge: { source: KnowledgeSource; label: string; entries: number; fetchedAt: string; warning?: string };
  reception: { sink: "gas" | "sheets_api" | "local"; label: string };
  twilio: { configured: boolean; number: string; webhookUrl: string };
  line: { configured: boolean; webhookUrl: string; addFriendUrl: string };
  admin: { protected: boolean };
}
