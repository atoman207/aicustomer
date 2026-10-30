import type { Metadata } from "next";
import ConsultConsole from "@/components/ConsultConsole";
import ConsultBoundary from "@/components/consult/ConsultBoundary";
import PageHero from "@/components/PageHero";
import { serverBaseUrl } from "@/lib/server-url";
import { getIntegrationStatus } from "@/lib/status";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "AI相談",
  description: "畳・襖・障子・網戸の料金の目安や工期、対応エリアなどに、一畳屋のAI相談員が24時間お答えします。文字でも声でも、1つの画面でご相談いただけます。無料お見積りのご依頼もこちらから。",
};

// AI 相談のページ（文字・声を 1 つの画面で）。トップページにも同じ相談の画面があり、会話は共通
export default async function ChatPage() {
  const [status, settings] = await Promise.all([getIntegrationStatus(await serverBaseUrl()), getSettings()]);
  return (
    <PageHero
      compact
      kicker="AI相談"
      ruby="えーあいにそうだん"
      title="AIに相談"
      badge={["24", "時間"]}
      lead="文字でも声でも相談できます。"
    >
      <ConsultBoundary>
        <ConsultConsole
          mode={status.openai.configured ? "openai" : "demo"}
          company={settings.companyName}
          lineUrl={settings.lineAddFriendUrl}
          knowledgeLabel={status.knowledge.label}
        />
      </ConsultBoundary>
    </PageHero>
  );
}
