import { MessageSquareText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/PageHero";
import { PhoneCompact } from "@/components/PhoneButton";
import VoiceConsole from "@/components/VoiceConsole";
import { serverBaseUrl } from "@/lib/server-url";
import { getIntegrationStatus } from "@/lib/status";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "声でAI相談" };

export default async function VoicePage() {
  const [status, settings] = await Promise.all([getIntegrationStatus(await serverBaseUrl()), getSettings()]);
  return (
    <PageHero kicker="AI相談（声）" ruby="こえでそうだん" title="声でAI相談" badge={["話す", "だけ"]}>
      <VoiceConsole initialMode={status.openai.configured ? "openai" : "demo"} company={settings.companyName} lineUrl={settings.lineAddFriendUrl} />
      <div className="mt-6 grid gap-4 md:grid-cols-[1fr_300px]">
        <div className="card flex flex-col items-center justify-center gap-3 px-5 py-4 text-center sm:flex-row sm:text-left">
          <p className="flex-1 text-sm text-sumi-600">
            マイクが使えない・人前で声を出しにくいときは、同じAIに<span className="font-bold text-sumi-800">文字で</span>ご相談いただけます。
          </p>
          <Link href="/chat" className="btn-primary shrink-0">
            <MessageSquareText className="h-4 w-4" />
            文字で相談する
          </Link>
        </div>
        <PhoneCompact />
      </div>
    </PageHero>
  );
}
