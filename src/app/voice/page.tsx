import type { Metadata } from "next";
import PageHero from "@/components/PageHero";
import VoiceConsole from "@/components/VoiceConsole";
import { IMAGES } from "@/lib/images";
import { serverBaseUrl } from "@/lib/server-url";
import { getIntegrationStatus } from "@/lib/status";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "音声AI相談" };

export default async function VoicePage() {
  const [status, settings] = await Promise.all([getIntegrationStatus(await serverBaseUrl()), getSettings()]);
  return (
    <div className="container-x py-8">
      <PageHero
        image={IMAGES.washitsuLight}
        eyebrow="② 音声AI相談"
        title="話しかけるだけ。AIと自然な音声会話でご相談"
        description="OpenAI Realtime API（WebRTC）による低遅延の音声会話。途中で話しかければAIは止まって聞き、言い直しや追加の質問にもそのまま対応します。回答根拠はテキスト相談と同じ社内ナレッジです。"
      />
      <VoiceConsole initialMode={status.openai.configured ? "openai" : "demo"} company={settings.companyName} lineUrl={settings.lineAddFriendUrl} />
      <section className="mt-8 grid gap-4 text-sm text-sumi-600 md:grid-cols-3">
        <div className="card p-4">
          <p className="font-semibold text-sumi-800">自然さ・応答速度</p>
          <p className="mt-1 text-xs leading-relaxed">音声をそのまま理解し音声で返す Realtime モデルを使用。文字起こしを挟まないため、ChatGPT の音声会話と同等の応答速度と自然さを目指しています。</p>
        </div>
        <div className="card p-4">
          <p className="font-semibold text-sumi-800">割り込み・訂正</p>
          <p className="mt-1 text-xs leading-relaxed">サーバー側の発話検出（semantic VAD）で、お客様が話し始めるとAIの発話を即座に停止。「やっぱり8畳で」などの訂正も会話の流れで受け付けます。</p>
        </div>
        <div className="card p-4">
          <p className="font-semibold text-sumi-800">見積受付の確認工程</p>
          <p className="mt-1 text-xs leading-relaxed">口頭で伺った氏名・住所・電話・希望日・要約はAIが画面の確認フォームに転記。お客様が修正・確認して送信するまで登録されません。</p>
        </div>
      </section>
    </div>
  );
}
