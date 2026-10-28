// 受付を LINE で各店舗・営業担当に引き継ぐときの文（管理画面の「LINE共有」）。
// スプレッドシートの「LINE共有」メニュー（gas/LineShare.gs の lineShareText）も同じ文を作る。変えるときは両方を直す
import type { EstimateRequest } from "./types";

export type LineShareRecord = Pick<EstimateRequest, "id" | "name" | "address" | "phone" | "summary" | "preferredDates">;

const EMPTY = "（未入力）";

export function lineShareText(e: LineShareRecord): string {
  const v = (s: string | undefined) => (s ?? "").trim() || EMPTY;
  const name = (e.name ?? "").trim();
  const dates = (e.preferredDates ?? []).map((d) => (d ?? "").trim()).filter(Boolean);
  return [
    `【見積依頼】受付番号：${v(e.id)}`,
    `お名前：${name ? (/様$/.test(name) ? name : `${name} 様`) : EMPTY}`,
    `ご住所：${v(e.address)}`,
    `電話番号：${v(e.phone)}`,
    `ご相談内容：${v(e.summary)}`,
    dates.length ? ["訪問希望日：", ...dates.map((d, i) => `・第${i + 1}希望 ${d}`)].join("\n") : `訪問希望日：${EMPTY}`,
  ].join("\n");
}

/** スマホの LINE で、この文を入れた状態で送り先を選ぶ画面を開く URL（パソコン版の LINE では使えない） */
export function lineShareUrl(text: string): string {
  return `https://line.me/R/share?text=${encodeURIComponent(text)}`;
}
