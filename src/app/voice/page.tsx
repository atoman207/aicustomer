import type { Metadata } from "next";
import PageHero from "@/components/PageHero";
import VoiceConsole from "@/components/VoiceConsole";
import { serverBaseUrl } from "@/lib/server-url";
import { getIntegrationStatus } from "@/lib/status";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "声でAI相談" };

export default async function VoicePage() {
  const [status, settings] = await Promise.all([getIntegrationStatus(await serverBaseUrl()), getSettings()]);
  return (
    <PageHero kicker="② 音声AI相談" ruby="こえでそうだん" title="声でAI相談" badge={["話す", "だけ"]}>
      <VoiceConsole initialMode={status.openai.configured ? "openai" : "demo"} company={settings.companyName} lineUrl={settings.lineAddFriendUrl} />
    </PageHero>
  );
}
