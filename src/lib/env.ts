// 環境変数の集約。サーバー側専用（クライアントから import しないこと）
import { BRAND, LEGACY_COMPANY_NAMES, LEGACY_PHONES, LINKS } from "./brand";

const REALTIME_DEFAULT = "gpt-realtime-2.1";
/** 文字の相談の回答のモデルの既定と、以前の既定（.env・Vercel に残っていても新しい既定を使う） */
const ANSWER_DEFAULT = "gpt-6-astra";
const LEGACY_ANSWER_MODELS = ["gpt-4.1", "gpt-5.6-sol"];
/** 以前の既定（.env.example にあった値）。設定がこのままなら新しい既定を使う */
const LEGACY_REALTIME_MODELS = ["gpt-realtime"];
const CHAT_DEFAULT = "gpt-6.1-terra";
const LEGACY_CHAT_MODELS = ["gpt-4.1-mini", "gpt-4o-mini"];

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
  /**
   * そのほかの AI の処理（電話・LINE の受付の補助・接続の確認など）のモデル。以前の既定（gpt-4.1-mini）のままなら、
   * 新しい既定（gpt-6.1-terra：2026-10 時点の新しい中位のモデル・速く安い）を使う
   */
  get chatModel() {
    const v = str("OPENAI_CHAT_MODEL", CHAT_DEFAULT);
    return LEGACY_CHAT_MODELS.includes(v) ? CHAT_DEFAULT : v;
  },
  /**
   * 見積依頼の聞き取り（会話からお名前・ご住所・お電話番号・ご希望日・ご相談内容の要約を読み取る）のモデルと考える深さ。
   * 声の相談の長い会話・聞き違い・訂正・復唱から正しく読み取れるように、新しいモデルを使う（intake-eval で比較）
   */
  get intakeModel() {
    return str("OPENAI_INTAKE_MODEL", "gpt-6.1-terra");
  },
  get intakeReasoning() {
    return str("OPENAI_INTAKE_REASONING", "low");
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
   * 声の相談の仕組み：live（既定）＝GPT-Live（gpt-live-1。ChatGPT の音声会話と同じ、聞きながら話せるモデル）／
   * realtime＝Realtime API（gpt-realtime-2.1）。2026-10-27 の試験（50〜70代の方の話し方で一畳屋様の例の会話を通す）で、
   * GPT-Live は聞き取り（お名前・ご住所・お電話番号）・訂正・金額・間の取り方がより自然で正確だった
   */
  get voiceEngine(): "live" | "realtime" {
    return str("OPENAI_VOICE_ENGINE", "live") === "realtime" ? "realtime" : "live";
  },
  get liveModel() {
    return str("OPENAI_LIVE_MODEL", "gpt-live-1");
  },
  /** GPT-Live の声（harema＝日本語の女性の声・自然な録音から作られた声） */
  get liveVoice() {
    return str("OPENAI_LIVE_VOICE", "harema");
  },
  /** GPT-Live の委任先のモデル（事実は search_knowledge＝文字の相談と同じ資料の全文から答える AI に任せるので、速さを優先） */
  get liveBackendModel() {
    return str("OPENAI_LIVE_BACKEND_MODEL", "gpt-6.1-terra");
  },
  get liveBackendReasoning() {
    return str("OPENAI_LIVE_BACKEND_REASONING", "low");
  },
  /**
   * 声の相談のモデル（OPENAI_VOICE_ENGINE=realtime のとき・GPT-Live につながらないときの代わり）。
   * 以前の既定（.env.example の gpt-realtime）のままなら新しい既定に置き換える
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
  /** 声の相談の文字起こしに、熊本の地名の手がかりを渡すか（0 で渡さない。places.ts） */
  get transcribeHint() {
    return str("OPENAI_TRANSCRIBE_HINT", "1") !== "0";
  },
  /** 声の相談の話し終わりの判定：semantic（話の内容から判断・既定）／server（無音の長さで判断） */
  get realtimeTurn(): "semantic" | "server" {
    return str("OPENAI_REALTIME_TURN", "semantic") === "server" ? "server" : "semantic";
  },
  /**
   * 話し終わりの判定をどれだけ急ぐか（semantic のとき。low＝お客様が話し終わるまで長めに待つ・既定）。
   * 一畳屋様のお客様は 50 代以上の方が多く、「えーっと」「あのー」と考えながら話す途中で AI が話し始めないように（2026-10-26）
   */
  get realtimeEagerness(): "low" | "medium" | "high" | "auto" {
    const v = str("OPENAI_REALTIME_EAGERNESS", "low");
    return v === "medium" || v === "high" || v === "auto" ? v : "low";
  },
  /**
   * 声の相談の AI の声。2026-10-22 に女性の声（marin・sage・coral・shimmer）を同じ文 × 6 回で比べ、
   * 声の高さ（20代の女性らしい明るさ）・聞き取りやすさ（文字起こしの誤り）・文の途中の途切れの少なさで最もよかった sage を既定にする
   */
  get realtimeVoice() {
    return str("OPENAI_REALTIME_VOICE", "sage");
  },
  /**
   * 声の相談の話す速さ（1＝標準・既定）。50 代以上のお客様が聞き取りやすく、金額も聞き違えにくい標準の速さ
   * （以前の既定 1.1 は、ふつうの会話より少し速い）
   */
  get realtimeSpeed() {
    const n = Number(str("OPENAI_REALTIME_SPEED", "1"));
    return Number.isFinite(n) ? Math.min(1.5, Math.max(0.25, n)) : 1;
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
  /** 意味の近さの検索（ANSWER_CONTEXT=search のときだけ使う）。いちばん新しい・精度の高い text-embedding-3-large */
  get embeddingModel() {
    return str("OPENAI_EMBEDDING_MODEL", "text-embedding-3-large");
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
  /**
   * 一畳屋のスタッフが AI の応対への修正点・要望を書くタブ（回答用と同じスプレッドシート）。
   * 書いた内容は資料と同じく約 1 分で AI の指示に反映する。「off」で使わない
   */
  get staffNotesTab() {
    const v = str("STAFF_NOTES_TAB", "修正点など");
    return v.toLowerCase() === "off" ? "" : v;
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
