import type { Metadata } from "next";
import PageHero from "@/components/PageHero";
import PhoneSimulator from "@/components/PhoneSimulator";
import { IMAGES } from "@/lib/images";
import { serverBaseUrl } from "@/lib/server-url";
import { getIntegrationStatus } from "@/lib/status";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI電話受付" };

export default async function PhonePage() {
  const [status, settings] = await Promise.all([getIntegrationStatus(await serverBaseUrl()), getSettings()]);
  return (
    <div className="container-x py-8">
      <PageHero
        image={IMAGES.shojiDoors}
        eyebrow="③ AI電話受付（0120番号）"
        title="休日・営業時間外の電話を、AIが取りこぼさず受付"
        description="既存のNTT 0120番号はそのまま。着信→AIが自然な音声で応対→見積希望時は氏名・住所・電話・相談内容・希望日（第1〜第3）を取得→要約を復唱してお客様確認→スプレッドシートに登録→スタッフが後日折り返して日程確定。"
      />
      <PhoneSimulator companyPhone={settings.companyPhone} initialMode={status.openai.configured ? "openai" : "demo"} />
      <section className="mt-8 grid gap-4 text-sm text-sumi-600 md:grid-cols-4">
        <div className="card p-4">
          <p className="font-semibold text-sumi-800">AI／人間の切替</p>
          <p className="mt-1 text-xs leading-relaxed">管理画面のラジオボタンで「常時AI」「営業時間外のみAI」「常にスタッフ」を切替。営業時間と休業日も専門知識なしで設定できます。</p>
        </div>
        <div className="card p-4">
          <p className="font-semibold text-sumi-800">0120番号の継続利用</p>
          <p className="mt-1 text-xs leading-relaxed">0120番号の転送先に Twilio 番号を設定するだけ。番号変更の案内は不要で、通話はこのシステムの Webhook で処理されます。</p>
        </div>
        <div className="card p-4">
          <p className="font-semibold text-sumi-800">会話履歴・受付内容</p>
          <p className="mt-1 text-xs leading-relaxed">すべての通話の文字起こしと受付内容を管理画面で確認。受付はテキスト・音声・LINEと同じシートに一元管理されます。</p>
        </div>
        <div className="card p-4">
          <p className="font-semibold text-sumi-800">日程はAIが確定しない</p>
          <p className="mt-1 text-xs leading-relaxed">AIは希望日を第3希望まで伺い、復唱確認して記録するまで。日程の確定はスタッフが折り返して行います。</p>
        </div>
      </section>
    </div>
  );
}
