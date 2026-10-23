import { CheckCircle2 } from "lucide-react";
import { BusinessInfo, Faq, Message, Reasons, Stores } from "@/components/CompanyInfo";
import ConsultConsole from "@/components/ConsultConsole";
import ConsultBoundary from "@/components/consult/ConsultBoundary";
import KeyVisual from "@/components/KeyVisual";
import { PhoneCallout } from "@/components/PhoneButton";
import Reveal from "@/components/Reveal";
import { AiNav } from "@/components/SiteNav";
import StickyActions from "@/components/StickyActions";
import { serverBaseUrl } from "@/lib/server-url";
import { getIntegrationStatus } from "@/lib/status";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";

/** 安心して使っていただくための一言 */
const ASSURANCES = ["ご相談・お見積りは無料", "24時間いつでも", "文字でも声でも・途中で切り替えOK", "お名前などはお見積りのときだけ", "送信前に内容を確認できます"];

// トップページから、そのまま相談できる（入口を分けず、1 つの画面で文字でも声でも）。電話はふつうの電話ボタン
export default async function HomePage() {
  const [status, settings] = await Promise.all([getIntegrationStatus(await serverBaseUrl()), getSettings()]);
  return (
    <div>
      {/* 最初の画面：キービジュアルの高さを画面に合わせ、AI 相談メニュー（4 つのボタン）を画面の一番下に表示する */}
      <div className="kv-first">
        <KeyVisual />
        <AiNav />
      </div>

      <section id="ai-consult" className="scroll-mt-20 py-12 lg:scroll-mt-0 lg:py-16">
        <div className="container-x max-w-[1200px]">
          <Reveal effect="fade-up" className="flex justify-center">
            <h2 className="yey">
              <span>
                <span className="text-ichi-red">AI</span>に相談する
              </span>
            </h2>
          </Reveal>
          <Reveal effect="fade-up">
            <p className="mt-3 text-balance text-center text-sm leading-relaxed text-sumi-600 [word-break:auto-phrase]">
              24時間いつでも、料金の目安や工期、対応エリアなどにすぐお答えします。
              <br className="hidden sm:inline" />
              下の画面に文字で入力するか、マイクのボタンを押して話しかけてください。途中で切り替えても、会話はそのまま続きます。
            </p>
          </Reveal>
          <div className="mt-8" data-consult="home">
            <ConsultBoundary>
              <ConsultConsole
                layout="section"
                mode={status.openai.configured ? "openai" : "demo"}
                company={settings.companyName}
                lineUrl={settings.lineAddFriendUrl}
                knowledgeLabel={status.knowledge.label}
              />
            </ConsultBoundary>
          </div>
          <Reveal effect="fade-up">
            <ul className="mt-6 flex flex-wrap justify-center gap-2" aria-label="安心してご利用いただくために">
              {ASSURANCES.map((t) => (
                <li key={t} className="inline-flex items-center gap-1 rounded-full border border-ichi-green/30 bg-white px-3 py-1 text-xs font-bold text-ichi-theme">
                  <CheckCircle2 className="h-3.5 w-3.5 text-ichi-green" />
                  {t}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal effect="fade-up" className="mt-8">
            <PhoneCallout />
          </Reveal>
        </div>
      </section>

      <BusinessInfo />
      <Faq />
      <Reasons />
      <Message />
      <Stores />
      <StickyActions watchId="ai-consult" />
    </div>
  );
}
