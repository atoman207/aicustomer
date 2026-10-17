// 管理画面の簡易認証（ADMIN_PASSWORD が設定されている場合のみ有効）
import crypto from "crypto";
import { cookies } from "next/headers";
import { env } from "./env";

export const ADMIN_COOKIE = "aic_admin";

export function adminToken(): string {
  return crypto.createHmac("sha256", "aicustomer-admin-cookie").update(env.adminPassword).digest("hex");
}

export function passwordMatches(input: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(env.adminPassword);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function isAdminAuthenticated(): Promise<boolean> {
  if (!env.adminProtected) return true;
  const store = await cookies();
  return store.get(ADMIN_COOKIE)?.value === adminToken();
}
