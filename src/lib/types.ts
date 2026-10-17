// 共通型定義

export type Channel = "web_text" | "web_voice" | "phone" | "line";

export const CHANNEL_LABEL: Record<Channel, string> = {
  web_text: "テキスト相談（HP）",
  web_voice: "音声相談（HP）",
  phone: "AI電話受付",
  line: "LINE",
};

export interface KnowledgeEntry {
  id: string;
  category: string;
  title: string;
  content: string;
  keywords: string[];
  note?: string;
}

export type KnowledgeSource = "gas" | "sheets_api" | "csv" | "local";

export interface KnowledgeSnapshot {
  entries: KnowledgeEntry[];
  source: KnowledgeSource;
  sourceLabel: string;
  fetchedAt: string;
  sheetName?: string;
  warning?: string;
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
  openTime: string; // "09:00"
  closeTime: string; // "18:00"
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
}

export interface IntegrationStatus {
  openai: { configured: boolean; model: string; realtimeModel: string; ok?: boolean; detail?: string };
  knowledge: { source: KnowledgeSource; label: string; entries: number; fetchedAt: string; warning?: string };
  reception: { sink: "gas" | "sheets_api" | "local"; label: string };
  twilio: { configured: boolean; number: string; webhookUrl: string };
  line: { configured: boolean; webhookUrl: string; addFriendUrl: string };
  admin: { protected: boolean };
}
