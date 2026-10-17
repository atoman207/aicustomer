// サーバーコンポーネント用：公開URLの推定
import { headers } from "next/headers";
import { env } from "./env";

export async function serverBaseUrl(): Promise<string> {
  if (env.publicBaseUrl) return env.publicBaseUrl;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
