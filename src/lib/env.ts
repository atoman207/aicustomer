// 環境変数の集約。サーバー側専用（クライアントから import しないこと）
import { BRAND, LEGACY_COMPANY_NAMES, LEGACY_PHONES, LINKS } from "./brand";

function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : fallback;
}

export const env = {
  get openaiKey() {
    return str("OPENAI_API_KEY");
  },
  get hasOpenAI() {
    return this.openaiKey.length > 10;
  },
  /** 互換API／プロキシ／テスト用モックに差し替える場合のみ設定 */
  get openaiBaseUrl() {
    return str("OPENAI_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, "");
  },
  get chatModel() {
    return str("OPENAI_CHAT_MODEL", "gpt-4.1-mini");
  },
  get realtimeModel() {
    return str("OPENAI_REALTIME_MODEL", "gpt-realtime");
  },
  get realtimeVoice() {
    return str("OPENAI_REALTIME_VOICE", "marin");
  },
  get ttsModel() {
    return str("OPENAI_TTS_MODEL", "gpt-4o-mini-tts");
  },
  get ttsVoice() {
    return str("OPENAI_TTS_VOICE", "coral");
  },
  get embeddingModel() {
    return str("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small");
  },

  /** 会社名。旧デモ名（熊本たたみ工房）が環境変数に残っていても一畳屋を使う */
  get companyName() {
    const v = str("COMPANY_NAME", str("NEXT_PUBLIC_COMPANY_NAME", BRAND.name));
    return LEGACY_COMPANY_NAMES.includes(v) ? BRAND.name : v;
  },
  get companyPhone() {
    const v = str("COMPANY_PHONE", str("NEXT_PUBLIC_COMPANY_PHONE", BRAND.freeDial));
    return LEGACY_PHONES.includes(v) ? BRAND.freeDial : v;
  },
  get publicBaseUrl() {
    return str("PUBLIC_BASE_URL").replace(/\/$/, "");
  },

  // ナレッジ
  get gasWebhookUrl() {
    return str("GAS_WEBHOOK_URL");
  },
  get googleServiceAccountEmail() {
    return str("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  },
  get googlePrivateKey() {
    // Vercel などに貼り付けた鍵の「\n」（2文字）を改行に戻す
    return str("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  },
  get hasServiceAccount() {
    return this.googleServiceAccountEmail !== "" && this.googlePrivateKey.includes("PRIVATE KEY");
  },
  get knowledgeSheetId() {
    return str("KNOWLEDGE_SHEET_ID");
  },
  get knowledgeSheetName() {
    return str("KNOWLEDGE_SHEET_NAME", "ＡＩ相談ソース");
  },
  /** シート未接続時に使う顧客対応マニュアル（Excel）。リポジトリ内の相対パス */
  get manualXlsxPath() {
    return str("MANUAL_XLSX_PATH", "database/顧客対応マニュアル.xlsx");
  },
  get knowledgeCsvUrl() {
    return str("KNOWLEDGE_SHEET_CSV_URL");
  },
  get knowledgeCacheSeconds() {
    const n = Number(str("KNOWLEDGE_CACHE_SECONDS", "60"));
    return Number.isFinite(n) && n >= 5 ? n : 60;
  },

  // 受付記録
  get receptionSheetId() {
    return str("RECEPTION_SHEET_ID");
  },
  get receptionSheetName() {
    return str("RECEPTION_SHEET_NAME", "受付一覧");
  },

  // Twilio
  get twilioAccountSid() {
    return str("TWILIO_ACCOUNT_SID");
  },
  get twilioAuthToken() {
    return str("TWILIO_AUTH_TOKEN");
  },
  get twilioPhoneNumber() {
    return str("TWILIO_PHONE_NUMBER");
  },
  get twilioVoice() {
    return str("TWILIO_TTS_VOICE", "Polly.Mizuki");
  },
  get hasTwilio() {
    return this.twilioAccountSid !== "" && this.twilioAuthToken !== "";
  },
  get staffForwardNumber() {
    return str("STAFF_FORWARD_NUMBER");
  },

  // LINE
  get lineChannelSecret() {
    return str("LINE_CHANNEL_SECRET");
  },
  get lineChannelAccessToken() {
    return str("LINE_CHANNEL_ACCESS_TOKEN");
  },
  get hasLine() {
    return this.lineChannelSecret !== "" && this.lineChannelAccessToken !== "";
  },
  /** 見積受付後の LINE 引き継ぎ（友だち追加）の遷移先（未設定時は一畳屋の公式LINE 友だち追加ページ） */
  get lineAddFriendUrl() {
    return str("NEXT_PUBLIC_LINE_ADD_FRIEND_URL", LINKS.lineFriend);
  },

  // 管理画面
  get adminPassword() {
    return str("ADMIN_PASSWORD");
  },
  get adminProtected() {
    return this.adminPassword !== "";
  },
};
