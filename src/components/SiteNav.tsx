"use client";

// AI 相談のメニュー（クリーム地・手書き文字・現在地に黄色のアクセント）
//   相談の画面は 1 つ（文字でも声でも）。「文字で相談」「声で相談」はその画面で始めるだけ。右端はふつうの電話ボタン（営業時間外・土日は AI が受付）
import { Home, MessageSquareText, Mic, PhoneCall } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ConsultLink from "./consult/ConsultLink";
import { AI_NAV, BRAND } from "@/lib/brand";

export const AI_ICONS = { home: Home, text: MessageSquareText, voice: Mic } as const;

export function AiNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="border-b border-[#ece6bf] bg-ichi-cream" aria-label="AI相談メニュー">
      <ul className="mx-auto flex w-full max-w-[1000px] items-stretch px-2 lg:px-5">
        {AI_NAV.map((n) => {
          const Icon = AI_ICONS[n.icon];
          const current = n.action === null && pathname === "/";
          const className = `ainav__link flex w-full items-center justify-center gap-1.5 whitespace-nowrap px-1 py-3 font-hand text-[13px] transition-opacity hover:opacity-80 sm:text-base lg:py-3.5 ${
            current ? "is-current text-ichi-red" : "text-ichi-theme"
          }`;
          const label = (
            <>
              <Icon className="h-4 w-4 shrink-0" strokeWidth={2.4} />
              <span className="sm:hidden">{n.short}</span>
              <span className="hidden sm:inline">{n.label}</span>
            </>
          );
          return (
            <li key={n.href} className="ainav__item flex min-w-0 flex-1">
              {n.action ? (
                <ConsultLink href={n.href} command={{ action: n.action }} className={className}>
                  {label}
                </ConsultLink>
              ) : (
                <Link href={n.href} aria-current={current ? "page" : undefined} className={className}>
                  {label}
                </Link>
              )}
            </li>
          );
        })}
        <li className="ainav__item flex min-w-0 flex-1">
          <a
            href={`tel:${BRAND.freeDialTel}`}
            className="ainav__link flex w-full flex-col items-center justify-center whitespace-nowrap px-1 py-2 text-ichi-red transition-opacity hover:opacity-80 lg:py-2.5"
            aria-label={`電話をかける（${BRAND.freeDial}・${BRAND.phoneAiNote}）`}
          >
            <span className="flex items-center gap-1.5 font-hand text-[13px] sm:text-base">
              <PhoneCall className="h-4 w-4 shrink-0" strokeWidth={2.4} />
              <span className="sm:hidden">電話</span>
              <span className="hidden sm:inline">電話 {BRAND.freeDial}</span>
            </span>
            <span className="text-[9px] font-bold leading-tight text-ichi-green sm:text-[10px]">
              <span className="sm:hidden">時間外はAI</span>
              <span className="hidden sm:inline">{BRAND.phoneAiNote}</span>
            </span>
          </a>
        </li>
      </ul>
    </nav>
  );
}
