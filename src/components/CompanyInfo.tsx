// トップページの会社情報（営業のご案内・よくあるご質問・選ばれる理由・会社メッセージ・店舗）
// 写真は一畳屋サイト（ichijoya.co.jp）のもの。内容は src/lib/company.ts
import { CalendarCheck, ChevronDown, Clock3, MapPin, MessageSquareText, PhoneCall, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import ConsultLink from "./consult/ConsultLink";
import Reveal from "./Reveal";
import { BRAND } from "@/lib/brand";
import { BUSINESS, FAQ, MESSAGE, PHILOSOPHY, REASONS, STORES, infoPhoto, mapUrl } from "@/lib/company";

function InfoPic({ name, alt, width, height, className }: { name: string; alt: string; width: number; height: number; className?: string }) {
  const p = infoPhoto(name);
  return (
    <picture>
      <source type="image/webp" srcSet={p.webp} />
      <img src={p.jpg} alt={alt} width={width} height={height} loading="lazy" decoding="async" className={className} />
    </picture>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Reveal effect="fade-up" className="flex justify-center">
      <h2 className="yey">
        <span>{children}</span>
      </h2>
    </Reveal>
  );
}

function InfoRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-4 py-4">
      <dt className="flex w-[96px] shrink-0 items-start gap-2 font-bold text-ichi-theme sm:w-[108px]">
        <span className="mt-[3px] text-ichi-green">{icon}</span>
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-sumi-700">{children}</dd>
    </div>
  );
}

export function BusinessInfo() {
  return (
    <section id="info" className="bg-ichi-cream py-12 lg:py-16">
      <div className="container-x max-w-[1040px]">
        <SectionTitle>
          営業<span className="text-ichi-red">のご案内</span>
        </SectionTitle>
        <div className="mt-8 grid gap-5 md:grid-cols-[1.15fr_1fr]">
          <Reveal effect="fade-up">
            <dl className="card h-full divide-y divide-dashed divide-ichi-green/40 px-5 text-sm">
              <InfoRow icon={<Clock3 className="h-4 w-4" />} label="営業時間">
                <span className="font-hand text-[22px] leading-none text-sumi-800">{BUSINESS.hours}</span>
              </InfoRow>
              <InfoRow icon={<CalendarCheck className="h-4 w-4" />} label="定休日">
                <span className="font-bold text-sumi-800">{BUSINESS.closed}</span>
                <span className="mt-1 block text-xs leading-relaxed text-sumi-500">
                  その他の休業日：{BUSINESS.otherHolidays}。{BUSINESS.holidayNote}
                </span>
              </InfoRow>
              <InfoRow icon={<PhoneCall className="h-4 w-4" />} label="お電話">
                <a href={`tel:${BRAND.freeDialTel}`} className="font-bold text-ichi-red underline-offset-2 hover:underline">
                  フリーダイヤル <span className="whitespace-nowrap">{BRAND.freeDial}</span>
                </a>
                <span className="mt-1 block text-xs leading-relaxed text-sumi-500">{BUSINESS.phoneNote}</span>
              </InfoRow>
              <InfoRow icon={<Wrench className="h-4 w-4" />} label="土日の施工">
                <span className="font-bold text-sumi-800">OK（要予約）</span>
                <span className="mt-1 block text-xs leading-relaxed text-sumi-500">施工希望日の3週間前までにご予約ください。</span>
              </InfoRow>
            </dl>
          </Reveal>
          <Reveal effect="fade-up" delay={150}>
            <div className="card h-full p-5 text-sm">
              <p className="flex items-center gap-2 font-bold text-ichi-theme">
                <MapPin className="h-4 w-4 text-ichi-green" />
                対応エリア（営業範囲）
              </p>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {BUSINESS.area.map((a) => (
                  <li key={a} className="chip">
                    {a}
                  </li>
                ))}
              </ul>
              <p className="mt-4 rounded-lg bg-ichi-cream px-3 py-2 text-xs leading-relaxed text-sumi-600">{BUSINESS.areaNote}</p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export function Faq() {
  return (
    <section id="faq" className="py-12 lg:py-16">
      <div className="container-x max-w-[880px]">
        <SectionTitle>
          よくある<span className="text-ichi-red">ご質問</span>
        </SectionTitle>
        <div className="mt-8 space-y-3">
          {FAQ.map((f, i) => (
            <Reveal key={f.q} effect="fade-up">
              <details className="faq group card overflow-hidden" open={i === 0}>
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 text-[15px] font-bold text-sumi-800 transition-colors hover:bg-ichi-cream sm:px-5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ichi-green font-en text-sm font-black text-white">Q</span>
                  <span className="min-w-0 flex-1">{f.q}</span>
                  <ChevronDown className="h-5 w-5 shrink-0 text-ichi-green transition-transform duration-300 group-open:rotate-180" />
                </summary>
                <div className="flex gap-3 border-t border-dashed border-ichi-green/40 px-4 py-4 sm:px-5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ichi-red font-en text-sm font-black text-white">A</span>
                  <div className="min-w-0 flex-1 space-y-2 text-sm leading-[1.9] text-sumi-700">
                    {f.a.map((p) => (
                      <p key={p}>{p}</p>
                    ))}
                    {/* トップページの相談の画面でそのまま質問する（相談の画面がないページでは /chat で） */}
                    <ConsultLink
                      href={`/chat?q=${encodeURIComponent(f.q)}`}
                      command={{ action: "ask", q: f.q }}
                      className="inline-flex items-center gap-1.5 pt-1 text-xs font-bold text-ichi-green underline-offset-2 hover:underline"
                    >
                      <MessageSquareText className="h-3.5 w-3.5" />
                      AIにくわしく聞く
                    </ConsultLink>
                  </div>
                </div>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Reasons() {
  return (
    <section id="reasons" className="bg-yellow-tatami py-12 lg:py-16">
      <div className="container-x max-w-[1120px]">
        <SectionTitle>
          当社が<span className="text-ichi-red">選ばれる</span>理由
        </SectionTitle>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {REASONS.map((r, i) => (
            <Reveal key={r.title} effect="fade-up" delay={i * 120}>
              <article className="flex h-full flex-col rounded-xl bg-white p-4 shadow-card">
                <div className="relative">
                  <InfoPic
                    name={r.photo}
                    alt={r.alt}
                    width={360}
                    height={240}
                    className="aspect-[3/2] w-full rounded-[10px] border-[3px] border-ichi-yellow object-cover"
                  />
                  <span className="absolute -left-2 -top-2 grid h-11 w-11 place-items-center rounded-full bg-ichi-red font-en text-[15px] font-black text-white shadow-soft">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="mt-4 font-hand text-[19px] leading-snug text-ichi-theme">{r.title}</h3>
                <p className="mt-2 text-[13px] leading-[1.9] text-sumi-700">{r.text}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Message() {
  return (
    <section id="message" className="py-12 lg:py-16">
      <div className="container-x max-w-[1040px]">
        <div className="grid items-center gap-8 md:grid-cols-[1fr_1.05fr] lg:gap-12">
          <Reveal effect="fade-right">
            <InfoPic name="intro" alt="畳の和室で遊ぶ子どもたち" width={600} height={420} className="w-full rounded-xl object-cover shadow-card" />
          </Reveal>
          <Reveal effect="fade-left">
            <span className="chip">一畳屋について</span>
            <h2 className="mt-3 font-hand text-[30px] leading-tight text-ichi-theme sm:text-[38px]">{MESSAGE.title}</h2>
            <div className="mt-4 space-y-3 text-sm leading-[2] text-sumi-700">
              {MESSAGE.body.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
            <ul className="mt-6 grid grid-cols-2 gap-2">
              {MESSAGE.facts.map((f) => (
                <li key={f.label} className="rounded-lg bg-ichi-cream px-3 py-2.5">
                  <span className="block text-[11px] font-bold text-sumi-500">{f.label}</span>
                  <span className="block font-hand text-[18px] leading-snug text-ichi-theme">{f.value}</span>
                  {"note" in f && f.note ? <span className="block text-[11px] text-sumi-500">（{f.note}）</span> : null}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        <Reveal effect="fade-up" className="mt-10">
          <div className="rounded-2xl bg-ptn-logo p-6 text-white sm:p-8">
            <div className="grid gap-6 md:grid-cols-2">
              {[PHILOSOPHY.mission, PHILOSOPHY.vision].map((x) => (
                <div key={x.label}>
                  <p className="text-xs font-bold tracking-wider text-ichi-yellow">{x.label}</p>
                  <p className="mt-1 text-balance font-hand text-[19px] leading-snug sm:text-[24px]">{x.text}</p>
                </div>
              ))}
            </div>
            <details className="group mt-6 rounded-xl bg-white/10">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-bold">
                {PHILOSOPHY.valuesLabel}
                <ChevronDown className="ml-auto h-4 w-4 transition-transform duration-300 group-open:rotate-180" />
              </summary>
              <ol className="grid gap-x-6 gap-y-3 px-4 pb-4 sm:grid-cols-2">
                {PHILOSOPHY.values.map((v, i) => (
                  <li key={v.title} className="flex gap-3">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ichi-yellow font-en text-xs font-black text-ichi-theme">{i + 1}</span>
                    <span>
                      <span className="block font-bold">{v.title}</span>
                      <span className="block text-xs leading-relaxed text-white/85">{v.text}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function Stores() {
  return (
    <section id="stores" className="bg-ichi-cream py-12 lg:py-16">
      <div className="container-x max-w-[1120px]">
        <SectionTitle>
          熊本県内<span className="text-ichi-red">5</span>店舗
        </SectionTitle>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {STORES.map((st, i) => (
            <Reveal key={st.key} effect="fade-up" delay={(i % 3) * 120}>
              <article className="flex h-full flex-col overflow-hidden rounded-xl bg-white shadow-card">
                <div className="relative">
                  <InfoPic name={`store-${st.key}`} alt={`一畳屋 ${st.name}の外観`} width={480} height={240} className="aspect-[2/1] w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 flex h-16 items-end bg-gradient-to-t from-ichi-theme/90 to-transparent px-4 pb-2">
                    <img src={st.label} alt="" className="h-[30px] w-auto max-w-[80%]" />
                  </div>
                </div>
                <div className="flex flex-1 flex-col p-4 text-sm">
                  <p className="font-bold text-sumi-800">{st.name}</p>
                  <p className="mt-0.5 text-sumi-600">
                    {st.address}
                    {"note" in st && st.note ? <span className="text-sumi-500">（{st.note}）</span> : null}
                  </p>
                  <a
                    href={mapUrl(st.address)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-auto inline-flex items-center gap-1 self-start pt-3 text-xs font-bold text-ichi-green underline-offset-2 hover:underline"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    地図を見る
                  </a>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
