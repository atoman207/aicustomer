// 環境変数の集約。サーバー側専用（クライアントから import しないこと）
import { BRAND, LEGACY_COMPANY_NAMES, LEGACY_PHONES, LINKS } from "./brand";

const REALTIME_DEFAULT = "gpt-realtime-2.1";
/** 文字の相談の回答のモデルの既定と、以前の既定（.env・Vercel に残っていても新しい既定を使う） */
const ANSWER_DEFAULT = "gpt-6-astra";
const LEGACY_ANSWER_MODELS = ["gpt-4.1", "gpt-5.6-sol"];
/** 以前の既定（.env.example にあった値）。設定がこのままなら新しい既定を使う */
const LEGACY_REALTIME_MODELS = ["gpt-realtime"];

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
  /**
   * 文字の相談で、資料の全文を読んで答えるモデル。2026-10-23 の比較（NotebookLM と同じ水準の答え方を求める 32 問・
   * 別のモデルによる採点：正確さ・答えの十分さ・作り話・計算）で、正確さを保ったまま答えが最も十分だった
   * gpt-6-astra（OpenAI の最上位）を、考える深さ low で使う。以前の既定（gpt-4.1・gpt-5.6-sol）のままなら、新しい既定に置き換える
   */
  get answerModel() {
    const v = str("OPENAI_ANSWER_MODEL", ANSWER_DEFAULT);
    return LEGACY_ANSWER_MODELS.includes(v) ? ANSWER_DEFAULT : v;
  },
  /** 回答のモデルの考える深さ（gpt-6 系は low・medium・high。gpt-5 系は none も可）。以前の既定 none のままなら low */
  get answerReasoning() {
    const v = str("OPENAI_ANSWER_REASONING", "low");
    return v === "none" && /^gpt-6/.test(this.answerModel) ? "low" : v;
  },
  /**
   * 声の相談（search_knowledge）の回答のモデルと考える深さ。声は待ち時間が長いと会話が途切れて感じるので、
   * 2026-10-23 の比較（声の回答 15 問）で正確さ・十分さが最も高く、待ち時間も短かった gpt-6.1-sol（low）を使う
   */
  get voiceAnswerModel() {
    return str("OPENAI_VOICE_ANSWER_MODEL", "gpt-6.1-sol");
  },
  get voiceAnswerReasoning() {
    return str("OPENAI_VOICE_ANSWER_REASONING", "low");
  },
  /** 回答のモデルが混み合って使えない・一時的な障害のときに答え直すモデル（gpt-5.6-sol は比較でもほぼ同じ正確さ） */
  get answerFallbackModel() {
    return str("OPENAI_ANSWER_FALLBACK_MODEL", "gpt-5.6-sol");
  },
  /**
   * 声の相談のモデル。以前の既定（.env.example の gpt-realtime）のままなら新しい既定に置き換える
   * （聞き取り・数字や英字の認識・雑音や割り込みの扱いが改善された版。前のモデルに固定したいときは日付つきの名前を指定）
   */
  get realtimeModel() {
    const v = str("OPENAI_REALTIME_MODEL", REALTIME_DEFAULT);
    return LEGACY_REALTIME_MODELS.includes(v) ? REALTIME_DEFAULT : v;
  },
  /** 声の相談の文字起こし（画面に出る文字・見積の自動入力に使う）のモデル */
  get transcribeModel() {
    return str("OPENAI_TRANSCRIBE_MODEL", "gpt-transcribe");
  },
  /** 声の相談の話し終わりの判定：semantic（話の内容から判断・既定）／server（無音の長さで判断） */
  get realtimeTurn(): "semantic" | "server" {
    return str("OPENAI_REALTIME_TURN", "semantic") === "server" ? "server" : "semantic";
  },
  /**
   * 声の相談の AI の声。2026-10-22 に女性の声（marin・sage・coral・shimmer）を同じ文 × 6 回で比べ、
   * 声の高さ（20代の女性らしい明るさ）・聞き取りやすさ（文字起こしの誤り）・文の途中の途切れの少なさで最もよかった sage を既定にする
   */
  get realtimeVoice() {
    return str("OPENAI_REALTIME_VOICE", "sage");
  },
  /** 声の相談の話す速さ（1＝標準。sage は標準だと少しゆっくりなので、ふつうの会話の速さになる 1.1） */
  get realtimeSpeed() {
    const n = Number(str("OPENAI_REALTIME_SPEED", "1.1"));
    return Number.isFinite(n) ? Math.min(1.5, Math.max(0.25, n)) : 1.1;
  },
  /**
   * 声の相談のモデルが話す前に考える深さ（gpt-realtime-2 系だけ。minimal＝ほとんど考えずにすぐ話す・low・medium・high）。
   * 深くすると、話の途中・答える前の無言が長くなる（事実は search_knowledge の回答を話すので、深く考える必要がない）
   */
  get realtimeReasoning() {
    return str("OPENAI_REALTIME_REASONING", "minimal");
  },
  get ttsModel() {
    return str("OPENAI_TTS_MODEL", "gpt-4o-mini-tts");
  },
  /** 読み上げ（電話のシミュレーター・簡易音声モード）の声。声の相談と同じ sage */
  get ttsVoice() {
    return str("OPENAI_TTS_VOICE", "sage");
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
  /**
   * AI に渡す参考情報：full（既定）＝指定のスプレッドシートの全文（NotebookLM と同じく資料全体を読んで答える。料金の質問も）、
   * search＝質問に関係する部分だけ（トークンは少ないが、検索で見つからない内容は答えられない。料金は料金表から直接）
   * 回答の根拠は指定のスプレッドシートだけ（ホームページは使わない。一畳屋様のご要望 2026-10-22・10-23）
   */
  get answerContext(): "full" | "search" {
    return str("ANSWER_CONTEXT", "full") === "search" ? "search" : "full";
  },
  /**
   * 同じ質問には、前に AI が作った回答をそのまま使う（AI を使わないのでトークンがかからない）。0 で使わない。
   * 使うのは、AI に渡す内容（ルール・スプレッドシートの全文・数量の計算表）とお客様の質問（言い回しの違いはそろえる）が
   * まったく同じときだけ（learned.ts）。意味が近いだけの質問には使わない（「6枚」と「8枚」を取り違えないため）
   */
  get answerCache() {
    return str("ANSWER_CACHE", "1") !== "0";
  },
  /** 学習済みの回答を残す日数（過ぎたら自動的に消え、次に聞かれたときに AI が答え直す） */
  get answerCacheDays() {
    const n = Number(str("ANSWER_CACHE_DAYS", "30"));
    return Number.isFinite(n) && n > 0 ? Math.min(n, 365) : 30;
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
  /** 電話の読み上げの声（Amazon Polly の日本語のニューラル音声・女性。以前の Mizuki は標準音声で、機械的に聞こえる） */
  get twilioVoice() {
    return str("TWILIO_TTS_VOICE", "Polly.Kazuha-Neural");
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
