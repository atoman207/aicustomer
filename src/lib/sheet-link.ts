// 回答の情報源にする Googleスプレッドシート（顧客対応マニュアルの 1 シート）の URL を、読み取り先に変換する
//   ・Apps Script のウェブアプリ（…/exec）… おすすめ。シートを公開せずに読み取れる（gas/Code.gs）
//   ・シートの共有リンク（「リンクを知っている全員」が閲覧可。タブを開いた URL の #gid=… で 1 シートを指定）
//   ・「ウェブに公開」した URL（CSV・HTML のどちらでも）
//   ブラウザ・サーバーの両方から使う（入力欄の確認にも使う）

/** csv：CSV で読む URL（sheetId・gid があれば、サービスアカウントで非公開のまま読む） */
export type SheetLink = { kind: "gas"; url: string } | { kind: "csv"; url: string; sheetId?: string; gid?: string } | { kind: "invalid"; reason: string };

export function parseSheetLink(input: string): SheetLink | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { kind: "invalid", reason: "URL の形式ではありません（https:// から始まる URL を貼ってください）" };
  }
  if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return { kind: "invalid", reason: "https:// の URL を貼ってください" };
  if (u.hostname === "script.google.com") {
    if (/\/macros\/s\/[^/]+\/exec$/.test(u.pathname)) return { kind: "gas", url: `${u.origin}${u.pathname}` };
    return { kind: "invalid", reason: "Apps Script は「デプロイ › ウェブアプリ」で発行した …/exec で終わる URL を貼ってください" };
  }
  if (u.hostname === "docs.google.com" && u.pathname.startsWith("/spreadsheets/")) {
    const gid = (u.hash.match(/gid=(\d+)/) ?? u.search.match(/gid=(\d+)/))?.[1];
    // 「ウェブに公開」した URL（/d/e/2PACX-…/pubhtml・/pub?output=csv）
    const pub = u.pathname.match(/^\/spreadsheets\/d\/e\/([^/]+)\//);
    if (pub) {
      const q = new URLSearchParams({ output: "csv" });
      if (gid) {
        q.set("gid", gid);
        q.set("single", "true");
      }
      return { kind: "csv", url: `https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub?${q.toString()}` };
    }
    const id = u.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/)?.[1];
    if (!id) return { kind: "invalid", reason: "スプレッドシートの URL を読み取れませんでした" };
    if (!gid) return { kind: "invalid", reason: "回答に使うシート（タブ）を開いた状態の URL を貼ってください（URL の最後に「#gid=数字」が付きます）" };
    return { kind: "csv", url: `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`, sheetId: id, gid };
  }
  // そのほかの CSV の URL
  return { kind: "csv", url: s };
}

/** 管理画面に表示する接続方法の名前 */
export function sheetLinkLabel(link: SheetLink | null): string {
  if (!link) return "未設定";
  if (link.kind === "gas") return "Apps Script（非公開のまま読み取り）";
  if (link.kind === "csv") return "共有リンク／ウェブに公開（CSV）";
  return "URL を確認してください";
}
