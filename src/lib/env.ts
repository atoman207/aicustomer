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

  // ナレッジ（AI の回答の情報源：Googleスプレッドシート）
  get gasWebhookUrl() {
    return str("GAS_WEBHOOK_URL");
  },
  get googleServiceAccountEmail() {
    return str("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  },
  get googlePrivateKey() {
    // Vercel などに貼り付けた鍵の書き方の違いを吸収する：
    //   ・.env からそのまま貼ったときの前後の " や '（Vercel では値の一部になってしまう）
    //   ・「\n」（2文字）での改行、Windows の改行（\r\n）
    return str("GOOGLE_PRIVATE_KEY")
      .replace(/^(["'])([\s\S]*)\1$/, "$2")
      .replace(/\\r\\n|\\n/g, "\n")
      .replace(/\r\n?/g, "\n")
      .trim()
      .concat("\n");
  },
  get hasServiceAccount() {
    return this.googleServiceAccountEmail !== "" && this.googlePrivateKey.includes("PRIVATE KEY");
  },
  /** スプレッドシートの ID（URL を貼ってもよい） */
  get knowledgeSheetId() {
    const v = str("KNOWLEDGE_SHEET_ID");
    return v.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1] ?? v;
  },
  /** 回答に使うタブの gid（URL の #gid=…）。未設定ならタブ名（KNOWLEDGE_SHEET_NAME）→ 先頭のタブ */
  get knowledgeSheetGid() {
    return str("KNOWLEDGE_SHEET_GID", str("KNOWLEDGE_SHEET_ID").match(/gid=(\d+)/)?.[1] ?? "");
  },
  get knowledgeSheetName() {
    return str("KNOWLEDGE_SHEET_NAME", "ＡＩ相談ソース");
  },
  get knowledgeCsvUrl() {
    return str("KNOWLEDGE_SHEET_CSV_URL");
  },
  get knowledgeCacheSeconds() {
    const n = Number(str("KNOWLEDGE_CACHE_SECONDS", "60"));
    return Number.isFinite(n) && n >= 5 ? n : 60;
  },

  // 受付記録（未設定なら回答用と同じスプレッドシートの「受付一覧」タブ）
  get receptionSheetId() {
    const v = str("RECEPTION_SHEET_ID", this.hasServiceAccount ? this.knowledgeSheetId : "");
    return v.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1] ?? v;
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
