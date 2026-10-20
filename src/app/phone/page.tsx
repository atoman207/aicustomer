import type { Metadata } from "next";
import PageHero from "@/components/PageHero";
import PhoneSimulator from "@/components/PhoneSimulator";
import { serverBaseUrl } from "@/lib/server-url";
import { getIntegrationStatus } from "@/lib/status";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI電話受付" };

export default async function PhonePage() {
  const [status, settings] = await Promise.all([getIntegrationStatus(await serverBaseUrl()), getSettings()]);
  return (
    <PageHero kicker="③ AI電話受付（フリーダイヤル）" ruby="でんわうけつけ" title="AI電話受付" badge={["休日も", "OK"]}>
      <PhoneSimulator companyPhone={settings.companyPhone} initialMode={status.openai.configured ? "openai" : "demo"} />
    </PageHero>
  );
}
