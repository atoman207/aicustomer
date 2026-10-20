import { MessageSquareText, Mic, PhoneCall } from "lucide-react";
import Link from "next/link";
import { BusinessInfo, Faq, Message, Reasons, Stores } from "@/components/CompanyInfo";
import KeyVisual from "@/components/KeyVisual";
import Reveal from "@/components/Reveal";
import { AiNav } from "@/components/SiteNav";
import { BRAND } from "@/lib/brand";

const CHANNELS = [
  {
    href: "/chat",
    icon: MessageSquareText,
    num: "①",
    title: "文字でAI相談",
    lead: "ホームページでチャット",
    desc: "料金・仕上がり日数・対応エリアなどを文字でご相談いただけます。お見積りは会話をAIが要約し、内容を確認してから送信できます。",
    cta: "文字で相談する",
  },
  {
    href: "/voice",
    icon: Mic,
    num: "②",
    title: "声でAI相談",
    lead: "マイクに話しかけるだけ",
    desc: "AIと自然な音声でお話しいただけます。途中で言い直しても大丈夫です。お見積りの内容は画面で確認してから送信します。",
    cta: "声で相談する",
  },
  {
    href: "/phone",
    icon: PhoneCall,
    num: "③",
    title: "AI電話受付",
    lead: `フリーダイヤル ${BRAND.freeDial}`,
    desc: "土日・営業時間外のお電話をAIが受付します。ご用件を復唱して確認したうえで記録し、担当者が営業時間内に折り返してご連絡します。",
    cta: "電話受付を試す",
  },
];

export default function HomePage() {
  return (
    <div>
      <KeyVisual />
      <AiNav />

      <section className="py-12 lg:py-16">
        <div className="container-x">
          <Reveal effect="fade-up" className="flex justify-center">
            <h2 className="yey">
              <span>
                <span className="text-ichi-red">3つ</span>の相談窓口
              </span>
            </h2>
          </Reveal>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {CHANNELS.map((c, i) => (
              <Reveal key={c.href} effect="fade-up" delay={i * 150}>
                <Link href={c.href} className="group flex h-full flex-col overflow-hidden rounded-xl bg-white shadow-card transition-opacity duration-300 hover:opacity-90">
                  <div className="relative flex h-[132px] items-center gap-4 bg-ptn-logo px-6 text-white">
                    <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-white text-ichi-green">
                      <c.icon className="h-8 w-8" strokeWidth={2.2} />
                    </span>
                    <span>
                      <span className="block text-xs font-bold text-ichi-yellow">{c.lead}</span>
                      <span className="mt-1 block font-hand text-[26px] leading-tight">{c.title}</span>
                    </span>
                    <span className="absolute right-4 top-3 font-hand text-2xl text-ichi-yellow">{c.num}</span>
                  </div>
                  <div className="flex flex-1 flex-col p-6">
                    <p className="flex-1 text-sm leading-[1.9] text-sumi-700">{c.desc}</p>
                    <span className="btn-more mt-5 self-center">{c.cta}</span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <BusinessInfo />
      <Faq />
      <Reasons />
      <Message />
      <Stores />
    </div>
  );
}
