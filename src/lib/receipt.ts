// 見積依頼の控え（お客様があとで確認できるように。一畳屋様のご要望 2026-10-30「送信ボタンを押した後に、相談内容をコピーまたは
// スクショを促す画面が出てほしい（後で確認ができない不安があるので）」）。確認画面の「内容をコピー」と、会話に残す文で使う
import { isJobChangeSummary } from "./job-change";
import type { EstimateRequest } from "./types";
import { formatJst } from "./utils";

export function receiptText(e: EstimateRequest): string {
  // ご依頼済みの件の変更・キャンセルのお問い合わせ（Ai system 236 行目）は、お見積りのご依頼の控えにしない
  const change = isJobChangeSummary(e.summary);
  return [
    change ? "【一畳屋 お問い合わせ（控え）】" : "【一畳屋 無料お見積りのご依頼（控え）】",
    `受付番号：${e.id}`,
    `受付日時：${formatJst(e.receivedAt)}`,
    `お名前：${e.name} 様`,
    `ご住所：${e.address}`,
    `お電話番号：${e.phone}`,
    `ご希望日時：${e.preferredDates.length ? e.preferredDates.join("／") : "（なし）"}`,
    `ご相談内容：${e.summary}`,
    change ? "※担当者より改めて折り返しご連絡いたします。" : "※担当者よりお電話し、伺う日程を決めさせていただきます。",
  ].join("\n");
}
