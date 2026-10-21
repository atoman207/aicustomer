import type { Metadata } from "next";
import ChatConsole from "@/components/ChatConsole";
import PageHero from "@/components/PageHero";
import { serverBaseUrl } from "@/lib/server-url";
import { getIntegrationStatus } from "@/lib/status";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "文字でAI相談",
  description: "畳・襖・障子・網戸の料金の目安や工期、対応エリアなどに、一畳屋のAI相談員が24時間お答えします。無料お見積りのご依頼もこちらから。",
};

export default async function ChatPage() {
  const [status, settings] = await Promise.all([getIntegrationStatus(await serverBaseUrl()), getSettings()]);
  return (
    <PageHero
      compact
      kicker="AI相談（文字）"
      ruby="もじでそうだん"
      title="文字でAI相談"
      badge={["24", "時間"]}
      lead="料金の目安・工期・対応エリアなどに、その場でお答えします。ご相談・お見積りは無料です。"
    >
      <ChatConsole
        mode={status.openai.configured ? "openai" : "demo"}
        company={settings.companyName}
        lineUrl={settings.lineAddFriendUrl}
        knowledgeLabel={status.knowledge.label}
      />
    </PageHero>
  );
}
