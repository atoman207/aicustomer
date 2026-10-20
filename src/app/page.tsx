import { CheckCircle2, MessageSquareText, Mic } from "lucide-react";
import Link from "next/link";
import { BusinessInfo, Faq, Message, Reasons, Stores } from "@/components/CompanyInfo";
import KeyVisual from "@/components/KeyVisual";
import { PhoneCallout } from "@/components/PhoneButton";
import Reveal from "@/components/Reveal";
import { AiNav } from "@/components/SiteNav";
import StickyActions from "@/components/StickyActions";

// AI の相談窓口は「文字」と「声」の 2 つだけ（選択肢を絞って迷わないように）。電話はふつうの電話ボタン
const CHANNELS = [
  {
    href: "/chat",
    icon: MessageSquareText,
    title: "文字で相談",
    lead: "チャットで聞くだけ",
    fit: "人前でも・音を出せない場所でも",
    desc: "料金の目安・工期・対応エリアなどに、その場でお答えします。お見積り（無料）のご依頼も、この画面からできます。",
    cta: "文字で相談する",
  },
  {
    href: "/voice",
    icon: Mic,
    title: "声で相談",
    lead: "マイクに話しかけるだけ",
    fit: "入力が苦手な方・手がふさがっているときに",
    desc: "電話のように話しかけるだけでAIがお答えします。途中で言い直しても大丈夫です。お見積りの内容は画面で確認してから送信します。",
    cta: "声で相談する",
  },
];

/** 安心して使っていただくための一言 */
const ASSURANCES = ["ご相談・お見積りは無料", "24時間いつでも", "お名前などはお見積りのときだけ", "送信前に内容を確認できます"];

export default function HomePage() {
  return (
    <div>
      <KeyVisual />
      <AiNav />

      <section id="ai-consult" className="py-12 lg:py-16">
        <div className="container-x max-w-[1000px]">
          <Reveal effect="fade-up" className="flex justify-center">
            <h2 className="yey">
              <span>
                <span className="text-ichi-red">AI</span>に相談する
              </span>
            </h2>
          </Reveal>
          <Reveal effect="fade-up">
            <p className="mt-3 text-center text-sm leading-relaxed text-sumi-600">
              24時間いつでも、料金の目安や工期、対応エリアなどにすぐお答えします。
              <br className="hidden sm:inline" />
              文字でも声でも、同じAIがご相談をお受けします。
            </p>
          </Reveal>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {CHANNELS.map((c, i) => (
              <Reveal key={c.href} effect="fade-up" delay={i * 150}>
                <Link
                  href={c.href}
                  className="group flex h-full flex-col overflow-hidden rounded-xl bg-white shadow-card transition-opacity duration-300 hover:opacity-90"
                  data-channel={c.href}
                >
                  <div className="relative flex h-[132px] items-center gap-4 bg-ptn-logo px-6 text-white">
                    <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-white text-ichi-green">
                      <c.icon className="h-8 w-8" strokeWidth={2.2} />
                    </span>
                    <span>
                      <span className="block text-xs font-bold text-ichi-yellow">{c.lead}</span>
                      <span className="mt-1 block font-hand text-[28px] leading-tight">{c.title}</span>
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col p-6">
                    <p className="inline-flex self-start rounded-full bg-ichi-cream px-3 py-1 text-xs font-bold text-ichi-theme">{c.fit}</p>
                    <p className="mt-3 flex-1 text-sm leading-[1.9] text-sumi-700">{c.desc}</p>
                    <span className="btn-more mt-5 self-center">{c.cta}</span>
                  </div>
                </Link>
              </Reveal>
            ))}
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
