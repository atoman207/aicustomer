"use client";

// ヘッダー（一畳屋サイトと同じ見た目）
//   PC：ロゴ／百年企業／無料お見積りOK／フリーダイヤル／受付時間／LINEで相談
//   SP：固定ヘッダー＋赤い「もくじ」ボタンで、3つの相談窓口のメニューを開く
import { Home, MessageSquareText, Mic, PhoneCall, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AiNav } from "./SiteNav";
import { AI_NAV, ASSETS, BRAND } from "@/lib/brand";

const AI_ICONS = { "/": Home, "/chat": MessageSquareText, "/voice": Mic, "/phone": PhoneCall } as const;

export default function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const isHome = pathname === "/";
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // ページ遷移でメニューを閉じる
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // メニュー表示中はスクロール固定・Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-[106] bg-white lg:relative">
        <div className="flex h-20 items-center pl-5 lg:h-[100px] lg:pl-10">
          <Link href="/" className="flex max-w-[calc(100vw-120px)] items-center gap-2.5 pr-3 transition-opacity hover:opacity-80" aria-label="一畳屋 AI相談窓口 トップ">
            <img src={ASSETS.logoColor} alt="一畳屋" width={205} className="w-[165px] lg:w-[205px]" />
            <img src={ASSETS.hyakunen} alt="百年企業" width={69} className="w-[55px] lg:w-[70px]" />
          </Link>

          <div className="ml-auto hidden items-center lg:flex">
            <div className="flex items-center gap-[15px] whitespace-nowrap">
              <img src={ASSETS.fukidashiFree} alt="無料お見積りOK" width={90} />
              <span>
                <p className="mb-1.5 text-xs font-bold leading-none">畳・襖は一畳屋にお気軽にご相談ください！</p>
                <a href={`tel:${BRAND.freeDialTel}`} className="block transition-opacity hover:opacity-80">
                  <img src={ASSETS.freeDial} alt={BRAND.freeDial} width={310} />
                </a>
              </span>
            </div>
            <div className="pl-[30px] text-[10px] font-bold leading-none">
              <img src={ASSETS.uketsuke} alt={`受付 ${BRAND.hours}`} width={190} />
              <span className="mt-2.5 inline-block">{BRAND.hoursNote}</span>
            </div>
          </div>

          {/* 一畳屋サイトの「LINEで相談」の位置を、AI相談の入口にしています（ご相談の窓口を AI に一元化） */}
          <div className="hidden pl-10 lg:block">
            <Link
              href="/chat"
              className="flex h-[100px] w-[187px] flex-col items-center justify-center gap-1.5 bg-ichi-line text-white transition-opacity duration-300 hover:opacity-80"
              aria-label="AIに相談する（24時間受付）"
            >
              <span className="relative block h-[46px] w-[50px]" aria-hidden>
                <svg viewBox="0 0 49.91 46" className="absolute inset-0 h-full w-full">
                  <path
                    fill="#fdd000"
                    fillRule="evenodd"
                    transform="translate(-1278.12 -6.031)"
                    d="M1285.4,10.021l-2.94,3.368,7.94,4.7Zm8.67-3.993-4.2,1.088,4.77,7.778Zm-15.95,17.407,0.67-4.286,8.21,3.975Z"
                  />
                </svg>
                <span className="absolute bottom-0 right-0 grid h-[35px] w-[35px] place-items-center rounded-[8px] bg-white font-en text-[17px] font-black leading-none text-ichi-line">
                  AI
                </span>
              </span>
              <span className="font-hand text-[21px] leading-none">AIに相談</span>
            </Link>
          </div>
        </div>
      </header>

      {/* SP：固定ヘッダーの高さ分のスペーサー */}
      <div className="h-20 lg:hidden" aria-hidden />

      {/* 3つの相談窓口のメニュー（トップはキービジュアルの下に表示） */}
      {!isHome ? <AiNav /> : null}

      {/* SP：もくじボタン */}
      <button
        ref={triggerRef}
        type="button"
        className="trigger fixed right-0 top-0 z-[130] flex h-20 w-20 flex-col items-center justify-center border-2 border-ichi-red bg-ichi-red text-white lg:hidden"
        aria-expanded={open}
        aria-controls="drawer"
        aria-label={open ? "メニューを閉じる" : "メニューを開く"}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="trigger__u" />
        <img src={ASSETS.triggerLabel} alt="" width={40} className="mt-1.5" />
      </button>

      {/* SP：メニュー */}
      <div id="drawer" className="drawer fixed inset-0 z-[125] lg:hidden" aria-hidden={!open}>
        <div className="absolute inset-0 bg-white/80" onClick={() => setOpen(false)} />
        <div className="drawer__container absolute right-0 top-0 flex h-full w-full max-w-[420px] flex-col overflow-y-auto bg-ptn-logo pb-10 pt-20 text-white">
          <p className="px-6 pt-4 text-[11px] font-bold tracking-widest text-white/70">AI相談窓口（24時間受付）</p>
          <ul className="px-4">
            {AI_NAV.map((n) => {
              const Icon = AI_ICONS[n.href];
              return (
                <li key={n.href} className="border-b border-dashed border-white/50">
                  <Link href={n.href} className="flex items-center gap-3 px-2 py-4 font-hand text-lg" tabIndex={open ? 0 : -1}>
                    <Icon className="h-5 w-5 text-ichi-yellow" strokeWidth={2.4} />
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mx-6 mt-8 rounded-xl bg-white px-4 py-4 text-center text-sumi-800">
            <p className="text-xs font-bold">畳・襖は一畳屋にお気軽にご相談ください！</p>
            <a href={`tel:${BRAND.freeDialTel}`} className="mt-2 block" tabIndex={open ? 0 : -1}>
              <img src={ASSETS.freeDial} alt={BRAND.freeDial} width={250} className="mx-auto" />
            </a>
            <img src={ASSETS.uketsuke} alt={`受付 ${BRAND.hours}`} width={160} className="mx-auto mt-2" />
            <p className="mt-1 text-[10px] font-bold">{BRAND.hoursNote}</p>
          </div>
          <Link href="/admin" className="mx-6 mt-6 flex items-center justify-center gap-1.5 text-xs text-white/70 underline" tabIndex={open ? 0 : -1}>
            <Settings2 className="h-3.5 w-3.5" />
            スタッフ用管理画面
          </Link>
        </div>
      </div>
    </>
  );
}
