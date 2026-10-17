import { getBaseUrl, json } from "@/lib/http";
import { getIntegrationStatus } from "@/lib/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const check = url.searchParams.get("check") === "1";
  const status = await getIntegrationStatus(getBaseUrl(req), check);
  return json({ ok: true, ...status });
}
