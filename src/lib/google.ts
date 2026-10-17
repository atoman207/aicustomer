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

export async function sheetsGetValues(sheetId: string, range: string): Promise<string[][]> {
  const token = await getGoogleAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(
    range,
  )}?majorDimension=ROWS`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Sheets API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { values?: string[][] };
  return json.values ?? [];
}

export async function sheetsAppendRow(sheetId: string, sheetName: string, row: (string | number)[]): Promise<void> {
  const token = await getGoogleAccessToken();
  const range = `${sheetName}!A1`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(
    range,
  )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [row] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Sheets append error ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** GAS Webアプリ呼び出し。GET はクエリ、POST は JSON ボディ（text/plain で送るとCORS回避・GAS側は postData.contents で受信） */
export async function gasRequest<T>(payload: Record<string, unknown>, method: "GET" | "POST" = "POST"): Promise<T> {
  const base = env.gasWebhookUrl;
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
