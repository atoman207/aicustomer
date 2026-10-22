"use client";

// AI 相談のメニュー（クリーム地・手書き文字・黄色のアクセント）
//   相談の窓口は 1 つなので「AI相談」だけ（押すとトップページの相談の画面へ。文字でも声でもその画面で）。右端はふつうの電話ボタン（営業時間外・土日は AI が受付）
import { MessageSquareText, PhoneCall } from "lucide-react";
import ConsultLink from "./consult/ConsultLink";
import { AI_NAV, BRAND } from "@/lib/brand";

export const AI_ICONS = { ai: MessageSquareText } as const;

export function AiNav() {
  return (
    <nav className="border-b border-[#ece6bf] bg-ichi-cream" aria-label="AI相談メニュー">
      <ul className="mx-auto flex w-full max-w-[1000px] items-stretch px-2 lg:px-5">
        {AI_NAV.map((n) => {
          const Icon = AI_ICONS[n.icon];
          return (
            <li key={n.href} className="ainav__item flex min-w-0 flex-1">
              <ConsultLink
                href={n.href}
                command={{ action: n.action }}
                className="ainav__link flex w-full items-center justify-center gap-1.5 whitespace-nowrap px-1 py-3 font-hand text-[15px] text-ichi-theme transition-opacity hover:opacity-80 sm:text-base lg:py-3.5"
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={2.4} />
                <span className="sm:hidden">{n.short}</span>
                <span className="hidden sm:inline">{n.label}</span>
              </ConsultLink>
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
