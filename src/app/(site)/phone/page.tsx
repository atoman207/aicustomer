import type { Metadata } from "next";
import PageHero from "@/components/PageHero";
import PhoneSimulator from "@/components/PhoneSimulator";
import { serverBaseUrl } from "@/lib/server-url";
import { getIntegrationStatus } from "@/lib/status";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
// お客様向けの窓口ではなく、AI 電話受付（フリーダイヤル）の動作をブラウザで確かめるスタッフ用のページ
export const metadata: Metadata = { title: "AI電話受付のテスト（スタッフ用）", robots: { index: false, follow: false } };

export default async function PhonePage() {
  const [status, settings] = await Promise.all([getIntegrationStatus(await serverBaseUrl()), getSettings()]);
  return (
    <PageHero kicker="スタッフ用｜AI電話受付のテスト" ruby="でんわうけつけ" title="AI電話受付" badge={["お試し", "用"]}>
      <p className="mb-5 rounded-xl border border-ichi-green/30 bg-white px-4 py-3 text-sm leading-relaxed text-sumi-700">
        お客様は、ふつうにフリーダイヤル <span className="font-bold">{settings.companyPhone}</span> へお電話いただくだけです（営業時間内はスタッフ、営業時間外・土日はAIが受付）。
        このページは、そのAI電話受付と同じ仕組みをブラウザで再現して確認するためのスタッフ用ページで、お客様向けのメニューには表示していません。
      </p>
      <PhoneSimulator companyPhone={settings.companyPhone} initialMode={status.openai.configured ? "openai" : "demo"} />
    </PageHero>
  );
}
