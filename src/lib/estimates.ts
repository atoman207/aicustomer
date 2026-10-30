// 見積依頼（受付情報）の作成とスプレッドシートへの記録
import { env } from "./env";
import { logError } from "./errorlog";
import {
  gasRequest,
  sheetsAppendRow,
  sheetsEnsureTab,
  sheetsInsertRowAtTop,
  sheetsReadHeader,
  sheetsReadRange,
  sheetsReadTabByName,
  sheetsSetDropdown,
  sheetsUpdateCell,
} from "./google";
import { SalesPitchError, isSalesPitch } from "./sales";
import { addEstimate, listEstimates, updateEstimate } from "./store";
import { CHANNEL_LABEL, ESTIMATE_STATUS_LABEL, RECEPTION_HEADER, type Channel, type EstimateRequest, type EstimateStatus, type ReceptionColumn } from "./types";
import { formatJst, isLikelyPhone, newId, normalizePhone, nowJstIso, truncate } from "./utils";

export interface EstimateInput {
  channel: Channel;
  name: string;
  address: string;
  phone: string;
  summary: string;
  preferredDates: string[];
  sessionId?: string;
  confirmedByCustomer?: boolean;
  autofill?: EstimateRequest["autofill"];
}

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

export type ReceptionSink = "gas" | "sheets_api" | "local";

/** 受付の記録先（サービスアカウントがあれば回答用と同じスプレッドシートの「受付一覧」タブ） */
export function receptionSink(): ReceptionSink {
  if (env.hasServiceAccount && env.receptionSheetId) return "sheets_api";
  if (env.gasWebhookUrl) return "gas";
  return "local";
}

export function receptionSinkLabel(sink: ReceptionSink): string {
  switch (sink) {
    case "gas":
      return `Googleスプレッドシート「${env.receptionSheetName}」（GAS連携）`;
    case "sheets_api":
      return `Googleスプレッドシート「${env.receptionSheetName}」（Sheets API）`;
    default:
      return "ローカル保存のみ（スプレッドシート未接続）";
  }
}

/** 受付一覧の 1 行（RECEPTION_HEADER の並び） */
export function estimateToRow(e: EstimateRequest): string[] {
  return [
    ESTIMATE_STATUS_LABEL[e.status],
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
  ];
}

/** 11 項目に整理する前（2026-10-28 まで）の見出し。整理前のままのシートも読み書きできるように */
const LEGACY_HEADER: Partial<Record<ReceptionColumn, string>> = { 対応状況: "ステータス", "相談内容（AI要約）": "相談内容（AI要約・お客様確認済み）" };

/** 見出し行 → 各欄の列の位置（0 始まり。見出しにない欄は -1。見出しのないシートは 11 項目の並びとみなす） */
function receptionColumns(head: string[]): Record<ReceptionColumn, number> {
  const names = head.map((c) => c.trim());
  const hasHeader = names.includes("受付番号");
  return Object.fromEntries(
    RECEPTION_HEADER.map((h, i) => {
      if (!hasHeader) return [h, i];
      const at = names.indexOf(h);
      const legacy = LEGACY_HEADER[h];
      return [h, at >= 0 ? at : legacy ? names.indexOf(legacy) : -1];
    }),
  ) as Record<ReceptionColumn, number>;
}

/**
 * 受付一覧のタブに 1 行記録する。値は見出しで列を探して入れる（担当者が列を足したり並べ替えたりしても正しい欄に入る）。
 * 新しい受付は見出しのすぐ下（いちばん上）に入れる（一畳屋様のご要望 2026-10-30「新しいものが上」）。
 * タブがなければ 11 項目の見出しで作る。「対応状況」の欄は「未連絡」「連絡済」のプルダウンにする（新しい行にも）
 */
async function recordToSheet(e: EstimateRequest): Promise<void> {
  const id = env.receptionSheetId;
  const name = env.receptionSheetName;
  await sheetsEnsureTab(id, name, [...RECEPTION_HEADER]);
  let head = await sheetsReadHeader(id, name);
  if (!head.some((c) => c.trim())) {
    // タブはあるが空（見出しが消された）：見出しから書き直す
    await sheetsAppendRow(id, name, [...RECEPTION_HEADER]);
    head = [...RECEPTION_HEADER];
  }
  const cols = receptionColumns(head);
  const values = estimateToRow(e);
  const row: string[] = [];
  RECEPTION_HEADER.forEach((h, i) => {
    if (cols[h] >= 0) row[cols[h]] = values[i];
  });
  await sheetsInsertRowAtTop(id, name, Array.from(row, (v) => v ?? ""));
  if (head[cols["対応状況"]]?.trim() === "対応状況") {
    // プルダウンを付けられなくても、受付の記録は済んでいる（理由は管理画面のエラー履歴に）
    await sheetsSetDropdown(id, name, cols["対応状況"], Object.values(ESTIMATE_STATUS_LABEL)).catch((err) =>
      logError("sheet", `受付一覧の「対応状況」のプルダウン（${e.id}）`, err),
    );
  }
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
  const e = (await listReceptions()).estimates.find((x) => x.id === id);
  if (!e) return "not_found";
  if (e.lineUserId) return e.lineUserId === userId ? "already" : "other";
  const link = { lineUserId: userId, lineLinkedAt: nowJstIso() };
  // ほかのサーバーで受け付けた（このサーバーにない）受付は、シートの内容で保存する
  if (!(await updateEstimate(id, link))) await addEstimate({ ...e, ...link });
  return "linked";
}

// ---------------- 同じご依頼を 2 件受け付けない ----------------
// 一畳屋様のご指摘 2026-10-30「送信ボタンは 1 回しか押してないのに同じものが 2 回受信されている（エクスペリア）」：
// 2 回押し・送信のあとに確認画面が開き直して、もう一度送信したなど。同じお客様（お名前とお電話番号が同じ）の受付が
// DUPLICATE_MS の間にもう一度届いたら、新しい受付にせず、前の受付（同じ受付番号）を返す

const DUPLICATE_MS = 30 * 60 * 1000;
const nameKey = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").replace(/(?:様|さま)$/, "");
const phoneKey = (s: string) => s.normalize("NFKC").replace(/\D/g, "");

const sameCustomer = (e: EstimateRequest, name: string, phone: string, since: number) =>
  Boolean(phone) && phoneKey(e.phone) === phone && nameKey(e.name) === name && Date.parse(e.receivedAt) >= since;

/** 少し前に受け付けた、同じお客様の受付（このサーバーの保存と、受付一覧のシートの上の行＝新しい受付から探す） */
async function recentDuplicate(name: string, phone: string): Promise<EstimateRequest | null> {
  const since = Date.now() - DUPLICATE_MS;
  const local = (await listEstimates()).find((e) => sameCustomer(e, name, phone, since));
  if (local || receptionSink() !== "sheets_api") return local ?? null;
  try {
    const rows = await sheetsReadRange(env.receptionSheetId, env.receptionSheetName, "A1:Z40");
    return parseReceptionRows(rows).items.find((x) => sameCustomer(x.estimate, name, phone, since))?.estimate ?? null;
  } catch (e) {
    // タブがまだない（最初の受付）なら重複もない。読めなかったときは、そのまま受け付ける（理由は管理画面のエラー履歴に）
    if (!/Unable to parse range/.test((e as Error).message)) await logError("sheet", "見積受付の重複の確認（受付一覧の読み取り）", e);
    return null;
  }
}

const inflight = globalThis as unknown as { __estimateInflight?: Map<string, Promise<EstimateRequest>> };

/**
 * 見積依頼を受け付ける。売り込み（営業）の内容は受け付けない（SalesPitchError）。同じお客様の受付が少し前にあれば、
 * その受付を返す（duplicate: true。同時に 2 回届いたときも 1 件だけ記録する）
 */
export async function createEstimate(input: EstimateInput): Promise<EstimateRequest & { duplicate?: boolean }> {
  const key = `${nameKey(input.name)}|${phoneKey(normalizePhone(input.phone))}`;
  const map = (inflight.__estimateInflight ??= new Map());
  const running = map.get(key);
  if (running) {
    const first = await running.catch(() => null);
    if (first) return { ...first, duplicate: true };
  }
  const p = (async () => {
    // 一畳屋様のご要望 2026-10-30「営業の問い合わせが無理に送信してきても受け付けなくしてほしい」（sales.ts）
    if (await isSalesPitch(`お名前：${input.name}\nご住所：${input.address}\nご相談内容：${input.summary}`)) {
      await logError("other", "営業のお問い合わせのため、見積依頼として受け付けませんでした", `${truncate(input.name, 40)}：${truncate(input.summary, 200)}`);
      throw new SalesPitchError();
    }
    const dup = await recentDuplicate(nameKey(input.name), phoneKey(normalizePhone(input.phone)));
    if (dup) return { ...dup, duplicate: true };
    return createEstimateRecord(input);
  })();
  map.set(key, p);
  try {
    return await p;
  } finally {
    if (map.get(key) === p) map.delete(key);
  }
}

async function createEstimateRecord(input: EstimateInput): Promise<EstimateRequest> {
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
    syncedTo: ["local"],
    ...(input.autofill ? { autofill: input.autofill } : {}),
  };
  await addEstimate(record);

  const sink = receptionSink();
  if (sink === "local") return record;
  try {
    if (sink === "gas") {
      await gasRequest({
        action: "reception",
        sheet: env.receptionSheetName,
        header: [...RECEPTION_HEADER],
        row: estimateToRow(record),
        statusOptions: Object.values(ESTIMATE_STATUS_LABEL),
        record,
      });
      record.syncedTo.push("gas");
    } else {
      // 「受付一覧」タブがなければ作って見出しを書く（編集者として共有されている必要があります）
      await recordToSheet(record);
      record.syncedTo.push("sheets_api");
    }
  } catch (e) {
    record.syncError = (e as Error).message;
    await logError("sheet", `見積受付のスプレッドシート連携（${record.id}）`, e);
  }
  await updateEstimate(record.id, { syncedTo: record.syncedTo, syncError: record.syncError });
  return record;
}

// ---------------- 受付一覧のシートを正にする ----------------
// Vercel などサーバーレスでは、サーバー内の保存（Redis なし）は再起動で消え、ほかのサーバーからも見えない。
// スプレッドシートに記録しているときは、管理画面の受付一覧と対応状況をシートから読み書きする
// （担当者がシートで直した内容・対応状況もそのまま管理画面に出る）

const RECEPTION_ID = /^EST-\d{8}-[A-Z0-9]{4}$/;
const CHANNEL_BY_LABEL = new Map(Object.entries(CHANNEL_LABEL).map(([k, v]) => [v, k as Channel]));

/** 対応状況の欄 →「未連絡」「連絡済」（整理前の「新規」は未連絡、「連絡済み」「日程確定」「完了」は連絡済として読む） */
function statusFromLabel(label: string): EstimateStatus {
  const s = label.trim();
  return !s || /^(未|新規)/.test(s) ? "new" : "contacted";
}

/** 「2026/10/22 14:05」（受付日時の欄）→ ISO（+09:00） */
function receivedAtFromCell(cell: string): string {
  const m = cell.normalize("NFKC").match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return "";
  const p = (s: string | undefined) => (s ?? "0").padStart(2, "0");
  return `${m[1]}-${p(m[2])}-${p(m[3])}T${p(m[4])}:${p(m[5])}:${p(m[6])}+09:00`;
}

interface SheetReceptions {
  /** 列の位置（見出し行で探す。担当者が列を足しても読める。見出しにない欄は -1） */
  cols: Record<ReceptionColumn, number>;
  items: { row: number; estimate: EstimateRequest }[];
}

export function parseReceptionRows(rows: string[][]): SheetReceptions {
  const head = rows[0] ?? [];
  const hasHeader = head.some((c) => c.trim() === "受付番号");
  const cols = receptionColumns(head);
  const items: SheetReceptions["items"] = [];
  rows.forEach((r, row) => {
    if (hasHeader && row === 0) return;
    const cell = (h: ReceptionColumn) => (cols[h] >= 0 ? (r[cols[h]] ?? "") : "").toString().trim();
    const id = cell("受付番号").normalize("NFKC").toUpperCase();
    if (!RECEPTION_ID.test(id)) return;
    const channel = CHANNEL_BY_LABEL.get(cell("受付経路")) ?? "web_text";
    items.push({
      row,
      estimate: {
        id,
        receivedAt: receivedAtFromCell(cell("受付日時")),
        channel,
        name: cell("氏名"),
        address: cell("住所"),
        phone: cell("電話番号"),
        summary: cell("相談内容（AI要約）"),
        preferredDates: [cell("第1希望"), cell("第2希望"), cell("第3希望")].filter(Boolean),
        status: statusFromLabel(cell("対応状況")),
        // 受付は、お客様が確認画面で送信したもの・電話で口頭確認したものだけ（シートには記録しない）
        confirmedByCustomer: true,
        syncedTo: ["sheets_api"],
      },
    });
  });
  return { cols, items };
}

export interface ReceptionList {
  estimates: EstimateRequest[];
  /** 受付一覧のシートから読んだか */
  fromSheet: boolean;
  /** シートを読めなかった理由（このサーバーに保存した分だけを表示している） */
  sheetError?: string;
}

/** 管理画面の受付一覧：シート（正）＋このサーバーにだけある受付（シートへの記録に失敗したもの） */
export async function listReceptions(): Promise<ReceptionList> {
  const local = await listEstimates();
  if (receptionSink() !== "sheets_api") return { estimates: local, fromSheet: false };
  let rows: string[][] | null;
  try {
    rows = await sheetsReadTabByName(env.receptionSheetId, env.receptionSheetName);
  } catch (e) {
    return { estimates: local, fromSheet: false, sheetError: (e as Error).message };
  }
  const byId = new Map(local.map((e) => [e.id, e]));
  const fromSheet = (rows ? parseReceptionRows(rows).items : []).map(({ estimate: s }) => {
    const l = byId.get(s.id);
    byId.delete(s.id);
    // シートにある欄はシートの値（担当者の修正を含む）、シートにない情報（会話の ID・LINE・自動入力の項目など）はサーバーの値
    return l ? { ...l, ...s, receivedAt: l.receivedAt || s.receivedAt, syncedTo: l.syncedTo } : s;
  });
  // 新しい順。受付日時が同じ（同じ分・同じ秒）ならシートの並び（上ほど新しい）のまま
  const estimates = [...fromSheet, ...byId.values()].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0));
  return { estimates, fromSheet: true };
}

/**
 * 対応状況を変える（シートに記録しているときは、シートの「対応状況」の欄も書き換える）。
 * 新しい受付はいちばん上の行に入るので、読んでから書くまでの間に受付が届くと行が 1 つずれる：書いたあとに、その行の
 * 受付番号を確かめ、ずれていたら書いた欄を元に戻して書き直す
 */
export async function setEstimateStatus(id: string, status: EstimateStatus): Promise<EstimateRequest | null> {
  const local = await updateEstimate(id, { status });
  if (receptionSink() !== "sheets_api") return local;
  const sid = env.receptionSheetId;
  const tab = env.receptionSheetName;
  for (let attempt = 0; attempt < 3; attempt++) {
    const rows = await sheetsReadTabByName(sid, tab);
    const sheet = rows ? parseReceptionRows(rows) : null;
    const hit = sheet?.items.find((x) => x.estimate.id === id);
    if (!rows || !sheet || !hit) return local; // シートへの記録に失敗した受付：サーバーの保存だけ
    const col = sheet.cols["対応状況"];
    const idCol = sheet.cols["受付番号"];
    if (col < 0) throw new Error(`シート「${tab}」に「対応状況」の欄（見出し）がありません`);
    await sheetsUpdateCell(sid, tab, hit.row, col, ESTIMATE_STATUS_LABEL[status]);
    const now = idCol >= 0 ? ((await sheetsReadRange(sid, tab, `${hit.row + 1}:${hit.row + 1}`))[0] ?? []) : [];
    const there = (now[idCol] ?? "").toString().normalize("NFKC").trim().toUpperCase();
    if (idCol < 0 || there === id) return local ? { ...local, status } : { ...hit.estimate, status };
    // ずれていた：書いてしまった行（ほかの受付）の対応状況を、読んだときの値（新しく届いた受付なら「未連絡」）に戻す
    const before = sheet.items.find((x) => x.estimate.id === there);
    const restore = before ? (rows[before.row]?.[col] ?? "") : ESTIMATE_STATUS_LABEL.new;
    await sheetsUpdateCell(sid, tab, hit.row, col, restore.toString());
  }
  throw new Error(`シート「${tab}」の対応状況を書き換えられませんでした（受付が続けて届いたため）。もう一度お試しください`);
}
