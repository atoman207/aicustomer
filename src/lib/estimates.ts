// 見積依頼（受付情報）の作成とスプレッドシートへの記録
import { env } from "./env";
import { gasRequest, sheetsAppendRow } from "./google";
import { addEstimate, listEstimates, updateEstimate } from "./store";
import { supabaseStateCached } from "./supabase";
import { CHANNEL_LABEL, type Channel, type EstimateRequest } from "./types";
import { formatJst, isLikelyPhone, newId, normalizePhone, nowJstIso } from "./utils";

export interface EstimateInput {
  channel: Channel;
  name: string;
  address: string;
  phone: string;
  summary: string;
  preferredDates: string[];
  sessionId?: string;
  confirmedByCustomer?: boolean;
}

export const RECEPTION_HEADER = [
  "受付日時",
  "受付経路",
  "氏名",
  "住所",
  "電話番号",
  "相談内容（AI要約・お客様確認済み）",
  "第1希望",
  "第2希望",
  "第3希望",
  "受付番号",
  "確認状況",
  "ステータス",
];

export function validateEstimateInput(input: Partial<EstimateInput>): string[] {
  const errors: string[] = [];
  if (!input.name?.trim()) errors.push("お名前を入力してください");
  if (!input.address?.trim()) errors.push("ご住所を入力してください");
  if (!input.phone?.trim()) errors.push("お電話番号を入力してください");
  else if (!isLikelyPhone(input.phone)) errors.push("お電話番号は市外局番から10〜11桁で入力してください");
  if (!input.summary?.trim()) errors.push("ご相談内容を入力してください");
  const dates = (input.preferredDates ?? []).filter((d) => d && d.trim());
  if (dates.length === 0) errors.push("見積希望日を1つ以上入力してください");
  return errors;
}

export type ReceptionSink = "gas" | "sheets_api" | "supabase" | "local";

export function receptionSink(): ReceptionSink {
  if (env.gasWebhookUrl) return "gas";
  if (env.hasServiceAccount && env.receptionSheetId) return "sheets_api";
  if (supabaseStateCached()?.ready) return "supabase";
  return "local";
}

export function receptionSinkLabel(sink: ReceptionSink): string {
  switch (sink) {
    case "gas":
      return `Googleスプレッドシート「${env.receptionSheetName}」（GAS連携）`;
    case "sheets_api":
      return `Googleスプレッドシート「${env.receptionSheetName}」（Sheets API）`;
    case "supabase":
      return "Supabase（データベースの estimates テーブル。スプレッドシートは未接続）";
    default:
      return "ローカル保存のみ（スプレッドシート未接続）";
  }
}

export function estimateToRow(e: EstimateRequest): string[] {
  return [
    formatJst(e.receivedAt),
    CHANNEL_LABEL[e.channel],
    e.name,
    e.address,
    e.phone,
    e.summary,
    e.preferredDates[0] ?? "",
    e.preferredDates[1] ?? "",
    e.preferredDates[2] ?? "",
    e.id,
    e.confirmedByCustomer ? "お客様確認済み" : "未確認",
    "新規",
  ];
}

/** 受付番号（例：EST-20261019-AB12）を文中から取り出す */
export function findReceptionId(text: string): string | null {
  const m = text.normalize("NFKC").toUpperCase().match(/EST-\d{8}-[A-Z0-9]{4}/);
  return m ? m[0] : null;
}

/**
 * 受付後の LINE 引き継ぎ：お客様が LINE で受付番号を送ると、その受付に LINE のユーザーを紐づける。
 * 別の LINE アカウントに紐づいている受付は上書きしない。
 */
export async function linkEstimateToLine(id: string, userId: string): Promise<"linked" | "already" | "other" | "not_found"> {
  const e = (await listEstimates()).find((x) => x.id === id);
  if (!e) return "not_found";
  if (e.lineUserId) return e.lineUserId === userId ? "already" : "other";
  await updateEstimate(id, { lineUserId: userId, lineLinkedAt: nowJstIso() });
  return "linked";
}

export async function createEstimate(input: EstimateInput): Promise<EstimateRequest> {
  const phone = normalizePhone(input.phone);
  const record: EstimateRequest = {
    id: newId("EST"),
    receivedAt: nowJstIso(),
    channel: input.channel,
    name: input.name.trim(),
    address: input.address.trim(),
    phone: isLikelyPhone(phone) ? phone : input.phone.trim(),
    summary: input.summary.trim(),
    preferredDates: input.preferredDates
      .map((d) => d.trim())
      .filter(Boolean)
      .slice(0, 3),
    status: "new",
    confirmedByCustomer: input.confirmedByCustomer ?? true,
    sessionId: input.sessionId,
    syncedTo: [supabaseStateCached()?.ready ? "supabase" : "local"],
  };
  await addEstimate(record);

  const sink = receptionSink();
  if (sink === "local" || sink === "supabase") return record;
  try {
    if (sink === "gas") {
      await gasRequest({
        action: "reception",
        sheet: env.receptionSheetName,
        header: RECEPTION_HEADER,
        row: estimateToRow(record),
        record,
      });
      record.syncedTo.push("gas");
    } else {
      await sheetsAppendRow(env.receptionSheetId, env.receptionSheetName, estimateToRow(record));
      record.syncedTo.push("sheets_api");
    }
  } catch (e) {
    record.syncError = (e as Error).message;
  }
  await updateEstimate(record.id, { syncedTo: record.syncedTo, syncError: record.syncError });
  return record;
}
