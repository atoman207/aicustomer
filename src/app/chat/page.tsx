import type { Metadata } from "next";
import ChatConsole from "@/components/ChatConsole";
import PageHero from "@/components/PageHero";
import { IMAGES } from "@/lib/images";
import { serverBaseUrl } from "@/lib/server-url";
import { getIntegrationStatus } from "@/lib/status";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "テキストAI相談" };

export default async function ChatPage() {
  const [status, settings] = await Promise.all([getIntegrationStatus(await serverBaseUrl()), getSettings()]);
  return (
    <div className="container-x py-8">
      <PageHero
        image={IMAGES.engawaGarden}
        eyebrow="① テキストAI相談"
        title="文字で気軽に、畳・襖・障子・網戸・リフォームのご相談"
        description="社内ナレッジ（スプレッドシートの指定シート）だけを根拠にお答えします。見積のご依頼は会話をAIが要約し、お客様に確認いただいてから担当者へ引き継ぎます。"
      />
      <ChatConsole
        mode={status.openai.configured ? "openai" : "demo"}
        company={settings.companyName}
        lineUrl={settings.lineAddFriendUrl}
        knowledgeLabel={status.knowledge.label}
      />
    </div>
  );
}
