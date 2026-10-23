"use client";

// AI 相談のメニュー
//   相談の窓口は 1 つなので「AI相談」だけ（押すとトップページの相談の画面へ。文字でも声でもその画面で）。右はふつうの電話ボタン（営業時間外・土日は AI が受付）
//   スマホ・タブレット：一畳屋のホームページの画面下のボタン（左が緑の「LINEで相談」、右が黄色の「電話する」・高さ 60px）と同じ見た目
//   PC：クリーム地・手書き文字・黄色のアクセント
import { MessageSquareText, PhoneCall } from "lucide-react";
import ConsultLink from "./consult/ConsultLink";
import { AI_NAV, BRAND } from "@/lib/brand";

export const AI_ICONS = { ai: MessageSquareText } as const;

export function AiNav() {
  return (
    <nav className="bg-ichi-cream lg:border-b lg:border-[#ece6bf]" aria-label="AI相談メニュー">
      <ul className="mx-auto flex w-full max-w-[1000px] items-stretch lg:px-5">
        {AI_NAV.map((n) => {
          const Icon = AI_ICONS[n.icon];
          return (
            <li key={n.href} className="ainav__item flex min-w-0 flex-1">
              <ConsultLink
                href={n.href}
                command={{ action: n.action }}
                className="ainav__link flex h-[60px] w-full items-center justify-center gap-2 whitespace-nowrap bg-ichi-line px-2 font-hand text-[19px] text-white transition-opacity hover:opacity-80 lg:h-auto lg:gap-1.5 lg:bg-transparent lg:py-3.5 lg:text-base lg:text-ichi-theme"
              >
                <Icon className="h-5 w-5 shrink-0 lg:h-4 lg:w-4" strokeWidth={2.4} />
                <span>{n.label}</span>
              </ConsultLink>
            </li>
          );
        })}
        <li className="ainav__item flex min-w-0 flex-1">
          <a
            href={`tel:${BRAND.freeDialTel}`}
            className="ainav__link flex h-[60px] w-full flex-col items-center justify-center whitespace-nowrap bg-ichi-yellow px-2 text-ichi-text transition-opacity hover:opacity-80 lg:h-auto lg:bg-transparent lg:py-2.5 lg:text-ichi-red"
            aria-label={`電話をかける（${BRAND.freeDial}・${BRAND.phoneAiNote}）`}
          >
            <span className="flex items-center gap-1.5 font-hand text-[19px] leading-none lg:text-base">
              <PhoneCall className="h-5 w-5 shrink-0 lg:h-4 lg:w-4" strokeWidth={2.4} />
              <span className="lg:hidden">電話する</span>
              <span className="hidden lg:inline">電話 {BRAND.freeDial}</span>
            </span>
            <span className="mt-1 text-[11px] font-bold leading-tight text-ichi-theme lg:mt-0.5 lg:text-ichi-green">
              <span className="lg:hidden">時間外はAIが受付</span>
              <span className="hidden lg:inline">{BRAND.phoneAiNote}</span>
            </span>
          </a>
        </li>
      </ul>
    </nav>
  );
}
