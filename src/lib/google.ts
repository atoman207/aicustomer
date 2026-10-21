// Google Sheets API（サービスアカウント）および GAS Webアプリ連携（サーバー専用）
import crypto from "crypto";
import { env } from "./env";

interface TokenCache {
  token: string;
  expires: number;
}
const g = globalThis as unknown as { __googleToken?: TokenCache };

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function getGoogleAccessToken(): Promise<string> {
  if (!env.hasServiceAccount) throw new Error("Googleサービスアカウントが設定されていません");
  const now = Math.floor(Date.now() / 1000);
  if (g.__googleToken && g.__googleToken.expires > now + 60) return g.__googleToken.token;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: env.googleServiceAccountEmail,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), env.googlePrivateKey);
  const jwt = `${unsigned}.${b64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google認証エラー ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  g.__googleToken = { token: json.access_token, expires: now + json.expires_in };
  return json.access_token;
}

/** Sheets API のエラーを、管理画面で読める言葉にする（共有されていない・シートがない など） */
async function sheetsError(res: Response, what: string): Promise<Error> {
  const text = (await res.text()).slice(0, 300);
  if (res.status === 403) return new Error(`${what}：スプレッドシートを開く権限がありません。シートの「共有」に ${env.googleServiceAccountEmail} を追加してください（HTTP 403）`);
  if (res.status === 404) return new Error(`${what}：スプレッドシートが見つかりません（ID を確認してください。HTTP 404）`);
  return new Error(`${what}：HTTP ${res.status} ${text}`);
}

/** シート名を範囲に使うときの書き方（空白・記号を含む名前も使えるように） */
const quoteTab = (title: string) => `'${title.replace(/'/g, "''")}'`;

export async function sheetsGetValues(sheetId: string, range: string): Promise<string[][]> {
  const token = await getGoogleAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(
    range,
  )}?majorDimension=ROWS`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw await sheetsError(res, "スプレッドシートの読み取り");
  const json = (await res.json()) as { values?: unknown[][] };
  return (json.values ?? []).map((r) => r.map((c) => (c == null ? "" : String(c))));
}

export interface SheetTab {
  sheetId: number;
  title: string;
}

/** スプレッドシートのタブ（シート）の一覧 */
export async function sheetsListTabs(sheetId: string): Promise<{ title: string; tabs: SheetTab[] }> {
  const token = await getGoogleAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=properties.title,sheets.properties(sheetId,title)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw await sheetsError(res, "スプレッドシートの読み取り");
  const json = (await res.json()) as { properties?: { title?: string }; sheets?: { properties: SheetTab }[] };
  return { title: json.properties?.title ?? "", tabs: (json.sheets ?? []).map((s) => s.properties) };
}

/**
 * 1 つのタブの全セル（空行も位置を保つ）。タブは gid（URL の #gid=…）→ 名前 → 先頭のタブ の順で選ぶ
 */
export async function sheetsReadTab(sheetId: string, opts: { gid?: string; name?: string }): Promise<{ title: string; rows: string[][] }> {
  const { tabs } = await sheetsListTabs(sheetId);
  const byGid = opts.gid !== undefined && opts.gid !== "" ? tabs.find((t) => String(t.sheetId) === String(opts.gid)) : undefined;
  const tab = byGid ?? (opts.name ? tabs.find((t) => t.title === opts.name) : undefined) ?? tabs[0];
  if (!tab) throw new Error("スプレッドシートにシート（タブ）がありません");
  return { title: tab.title, rows: await sheetsGetValues(sheetId, `${quoteTab(tab.title)}!A1:BZ3000`) };
}

const ensured = globalThis as unknown as { __sheetTabs?: Set<string> };

/** タブがなければ作って見出し行を書く（受付一覧など。編集者として共有されている必要があります） */
export async function sheetsEnsureTab(sheetId: string, title: string, header: string[]): Promise<void> {
  const key = `${sheetId}|${title}`;
  ensured.__sheetTabs ??= new Set();
  if (ensured.__sheetTabs.has(key)) return;
  const { tabs } = await sheetsListTabs(sheetId);
  if (!tabs.some((t) => t.title === title)) {
    const token = await getGoogleAccessToken();
    const add = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!add.ok) throw await sheetsError(add, `シート「${title}」の作成`);
    const head = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(`${quoteTab(title)}!A1`)}?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: [header] }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!head.ok) throw await sheetsError(head, `シート「${title}」の見出し`);
  }
  ensured.__sheetTabs.add(key);
}

export async function sheetsAppendRow(sheetId: string, sheetName: string, row: (string | number)[], header?: string[]): Promise<void> {
  if (header) await sheetsEnsureTab(sheetId, sheetName, header);
  const token = await getGoogleAccessToken();
  const range = `${quoteTab(sheetName)}!A1`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(
    range,
  )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [row] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw await sheetsError(res, `シート「${sheetName}」への記録`);
}

/** GAS Webアプリ呼び出し。GET はクエリ、POST は JSON ボディ（text/plain で送るとCORS回避・GAS側は postData.contents で受信） */
export async function gasRequest<T>(payload: Record<string, unknown>, method: "GET" | "POST" = "POST", url?: string): Promise<T> {
  // url：管理画面で入力した Apps Script の URL（未指定は GAS_WEBHOOK_URL）
  const base = url || env.gasWebhookUrl;
  if (!base) throw new Error("GAS_WEBHOOK_URL が未設定です");
  let res: Response;
  if (method === "GET") {
    const u = new URL(base);
    Object.entries(payload).forEach(([k, v]) => u.searchParams.set(k, String(v)));
    res = await fetch(u.toString(), { redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } else {
    res = await fetch(base, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`GAS error ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`GASの応答がJSONではありません: ${text.slice(0, 120)}`);
  }
}
