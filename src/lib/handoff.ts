// 会話が続かないときの見分け方と、受付一覧の「要確認」の印（電話・声の相談で共通。ブラウザでも使うので、サーバーの機能は読み込まない）
// 一畳屋様のご意見（2026-11-02「修正点など」9 行目）：
//   「電話ではテキストの確認ができないため名前や住所など間違った情報が送られるおそれあり。さらに会話が成立しない時点で電話から離脱の可能性が高い」
//   → 聞き直しが続いた・「通じない」とおっしゃった・人と話したいとおっしゃったら、切らずに次の手（電話：折り返しの受付／声の相談：文字の入力）へ。
//     声で聞き取った項目は、受付一覧の相談内容の頭に「要確認」と書き、日程の打ち合わせのお電話で確かめていただく
import { FIELD_LABEL, type IntakeField } from "./intake";
import type { Channel } from "./types";

/** AI がお客様の声を聞き取れずに聞き直している */
export const AI_REASK =
  /((聞き取れ|聞きとれ|ききとれ)(ませんでした|ず|なかった|ません)|(聞き取り|ききとり)にく|(聞こえ|きこえ)(ませんでした|にく|づら)|(もう一度|もういちど|再度)[、,]?\s*(ゆっくり[、,]?\s*)?(お話し|おはなし|おっしゃ|お聞かせ|おきかせ|お願い|おねがい|言って|お伝え)|お声が(遠|小さ|届))/;

/** お客様が、話が通じないとおっしゃった */
export const CUSTOMER_STUCK =
  /(通じ(ない|てない|ていない|ません|ん[。！!]?$)|話になら|伝わら(ない|ん)|わかって(くれない|もらえない)|(何回|何度|なんかい|なんど)(も)?(言って|言った|言い|いって|いった)|さっきから(言って|言った|いって))/;

/** お客様が、人（担当者）と話したいとおっしゃった */
export const ASKS_PERSON =
  /(人間|(人|ひと)(と|に)(話|代わ|かわ|替わ)|担当(者|の方|の人)?(さん)?(と|に|へ)(話|代わ|かわ|替わ|つな|繋)|オペレーター|スタッフ(の方|さん)?(と|に)(話|代わ|かわ|つな)|社員(の方|さん)?(と|に)(話|代わ|かわ))/;

/**
 * お客様が、折り返してほしいとおっしゃった（相談の段階だけで使う。見積の聞き取りの途中の「この番号に折り返してください」は、
 * お電話番号のお答えなので、聞き取りを続ける）
 */
export const ASKS_CALLBACK =
  /((折り返し|おりかえし)(の)?(お)?(電話|連絡)?(を)?(ください|下さい|ほしい|欲しい|お願い|して|もらえ|いただけ)|(折り返して|おりかえして)(ください|下さい|ほしい|欲しい|もらえ|いただけ))/;

/** ご提案（折り返しましょうか）への「はい」（「大丈夫です」「いいです」は、お断りのことも多いので数えない） */
export const AGREES = /^(はい|ええ|うん|お願い|おねがい|そうして|それでお願い|折り返し|おりかえし|頼みます|たのみます)/;

/** 聞き直しが何回続いたら、次の手にするか（電話：折り返しのご提案。声の相談：文字の入力のご案内） */
export const REASK_LIMIT = 2;

/** AI の発言（古い順）の最後から数えて、聞き直しが何回続いているか */
export function reaskStreak(aiTexts: string[]): number {
  let n = 0;
  for (let i = aiTexts.length - 1; i >= 0; i--) {
    if (!AI_REASK.test(aiTexts[i].normalize("NFKC"))) break;
    n += 1;
  }
  return n;
}

/** 受付一覧の相談内容の頭に付ける「要確認」の印（声で聞き取り、お客様が画面で確かめていない項目） */
export function checkNote(fields: readonly string[] | undefined, channel: Channel): string {
  const keys = (["name", "address", "phone", "dates"] as IntakeField[]).filter((f) => fields?.includes(f));
  if (!keys.length) return "";
  const how = channel === "phone" ? "AI電話の聞き取り" : "声の聞き取り";
  return `【要確認：${keys.map((f) => FIELD_LABEL[f]).join("・")}（${how}）】`;
}

/** 相談内容に「要確認」の印を付ける（同じ印は二重に付けない） */
export function withCheckNote(summary: string, fields: readonly string[] | undefined, channel: Channel): string {
  const note = checkNote(fields, channel);
  const body = summary.trim();
  if (!note || body.startsWith("【要確認：")) return body;
  return `${note}${body}`;
}
