// 営業・売り込みのお問い合わせ（一畳屋に商品・サービスを売り込む・提案する内容）は、見積依頼として受け付けない
//   一畳屋様のご要望 2026-10-30「営業の問い合わせが無理に送信してきても受け付けなくしてほしい」
//   ・文字の相談の聞き取り：売り込みの会話では、お名前などを伺い始めない（お断りの文を返す）
//   ・見積依頼の受付（createEstimate。確認画面の送信・電話・LINE）：売り込みの内容は記録しない（管理画面のエラー履歴に残す）
//   判定は AI。売り込みらしい言葉があるときだけ確かめ、迷うときはお客様のご依頼として受け付ける（AI が使えない・失敗したときも）。
//   管理会社・法人のお客様の工事のご依頼（「弊社管理の物件の畳を替えたい」）はご依頼として受け付ける
import { env } from "./env";
import { logError } from "./errorlog";
import { chatCompletionJson } from "./openai";
import { truncate } from "./utils";

/** お客様へのお断りの文 */
export const SALES_DECLINE =
  "恐れ入りますが、こちらはお客様からの畳・襖・障子・網戸などのご相談とお見積りの受付窓口のため、営業・お取引のご案内はお受けしておりません。ご了承ください。";

/** 売り込みらしい言葉（これがあるときだけ AI で確かめる。お客様のご依頼のほとんどは AI を使わずにそのまま受け付ける） */
const SALES_HINT =
  /弊社|御社|貴社|当社の(?:サービス|商品|製品|システム)|ご提案|ご案内(?:させて|いたしたく|したく)|営業(?:の(?:ご|お)|活動|代行|電話|担当)|広告|掲載|集客|SEO|MEO|ホームページ制作|HP制作|サイト制作|ウェブ制作|web制作|制作会社|求人|人材|採用(?:支援|代行)|派遣|業務提携|提携|代理店|フランチャイズ|仕入れ|卸売|協業|コスト削減|経費削減|電気代|電力|光回線|リース|資金調達|融資|投資|事業承継|M&A|ご紹介させて|お役に立て|導入(?:事例|実績)|無料診断|資料(?:を)?(?:お送り|送付)|商談|アポイント|セミナー|お取引|取引先/i;

/** 売り込みらしい言葉があるか（AI で確かめる前の、軽い手がかり） */
export function salesHint(text: string): boolean {
  return SALES_HINT.test(text.normalize("NFKC"));
}

const SALES_PROMPT = `あなたは熊本の畳店「一畳屋」（畳・襖・障子・網戸から住まいのリフォームまでの施工店）の受付です。届いた相談・見積依頼の内容が、次のどちらかを判定してください。
- customer：一畳屋に工事・商品を頼みたい・相談したいお客様。個人だけでなく、法人・管理会社・不動産会社・大家・施設・学校・お寺などからの、畳・襖・障子・網戸・リフォームなどの工事のご依頼・ご相談・お見積りの依頼も customer。補助金やキャンペーンが使えるかのご質問も customer。
- sales：一畳屋に対して、商品・サービス・広告・集客・ホームページ・人材・求人・仕入れ・材料・提携・代理店・資金・電気やガスの切り替えなどを売り込む・提案する・営業する内容（営業のアポイントや商談の依頼、資料送付の申し出、協業・取引の申し入れなど）。
迷うとき・どちらとも言えないときは customer にしてください（お客様のご依頼を断らないため）。JSON で返してください。`;

const SALES_SCHEMA = {
  name: "sales_check",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { kind: { type: "string", enum: ["customer", "sales"] }, reason: { type: "string" } },
    required: ["kind", "reason"],
  },
};

/**
 * 売り込み（営業）のお問い合わせか。売り込みらしい言葉がなければ AI を使わずに false。
 * AI が使えない・失敗したときは false（お客様のご依頼を受け付けられないことがないように）
 */
export async function isSalesPitch(text: string): Promise<boolean> {
  const t = text.normalize("NFKC").trim();
  if (!t || !salesHint(t) || !env.hasOpenAI) return false;
  try {
    const r = await chatCompletionJson<{ kind: string; reason: string }>({
      model: env.intakeModel,
      reasoningEffort: "low",
      messages: [
        { role: "system", content: SALES_PROMPT },
        { role: "user", content: truncate(t, 3000) },
      ],
      jsonSchema: SALES_SCHEMA,
      temperature: 0,
      maxTokens: 400,
      timeoutMs: 15_000,
      purpose: "sales-check",
    });
    return r.kind === "sales";
  } catch (e) {
    await logError("openai", "営業のお問い合わせかの判定（判定できなかったので、お客様のご依頼として受け付けました）", e);
    return false;
  }
}

/** 見積依頼の受付で、売り込みの内容だったため記録しなかった */
export class SalesPitchError extends Error {
  constructor() {
    super(SALES_DECLINE);
    this.name = "SalesPitchError";
  }
}
