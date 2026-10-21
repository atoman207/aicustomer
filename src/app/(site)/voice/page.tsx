import { ChevronRight, MessageSquareText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/PageHero";
import { PhoneCompact } from "@/components/PhoneButton";
import VoiceConsole from "@/components/VoiceConsole";
import { serverBaseUrl } from "@/lib/server-url";
import { getIntegrationStatus } from "@/lib/status";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "声でAI相談",
  description: "マイクに話しかけるだけで、一畳屋のAI相談員が畳・襖・障子・網戸のご相談に24時間お答えします。通話料はかかりません。",
};

export default async function VoicePage() {
  const [status, settings] = await Promise.all([getIntegrationStatus(await serverBaseUrl()), getSettings()]);
  return (
    <PageHero
      compact
      kicker="AI相談（声）"
      ruby="こえでそうだん"
      title="声でAI相談"
      badge={["話す", "だけ"]}
      lead="電話のように話しかけるだけで、AIがお答えします。通話料はかかりません。"
    >
      <VoiceConsole initialMode={status.openai.configured ? "openai" : "demo"} company={settings.companyName} lineUrl={settings.lineAddFriendUrl} />
      <div className="mt-5 grid gap-4 md:grid-cols-[1fr_300px]">
        <div className="card flex flex-col items-center justify-center gap-3 rounded-2xl px-5 py-4 text-center sm:flex-row sm:text-left">
          <span className="hidden h-10 w-10 shrink-0 place-items-center rounded-full bg-ichi-cream text-ichi-green sm:grid">
            <MessageSquareText className="h-5 w-5" />
          </span>
          <p className="flex-1 text-sm leading-relaxed text-sumi-600">
            マイクが使えない・人前で声を出しにくいときは、同じAIに<span className="font-bold text-sumi-800">文字で</span>ご相談いただけます（ここまでの会話も引き継ぎます）。
          </p>
          <Link href="/chat" className="btn-primary shrink-0">
            <MessageSquareText className="h-4 w-4" />
            文字で相談する
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        <PhoneCompact />
      </div>
    </PageHero>
  );
}
