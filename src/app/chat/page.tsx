import type { Metadata } from "next";
import ChatConsole from "@/components/ChatConsole";
import PageHero from "@/components/PageHero";
import { serverBaseUrl } from "@/lib/server-url";
import { getIntegrationStatus } from "@/lib/status";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "文字でAI相談" };

export default async function ChatPage() {
  const [status, settings] = await Promise.all([getIntegrationStatus(await serverBaseUrl()), getSettings()]);
  return (
    <PageHero kicker="AI相談（文字）" ruby="もじでそうだん" title="文字でAI相談" badge={["24", "時間"]}>
      <ChatConsole
        mode={status.openai.configured ? "openai" : "demo"}
        company={settings.companyName}
        lineUrl={settings.lineAddFriendUrl}
        knowledgeLabel={status.knowledge.label}
      />
    </PageHero>
  );
}
