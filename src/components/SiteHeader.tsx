"use client";

// ヘッダー（一畳屋サイトと同じ見た目）
//   PC：ロゴ／百年企業／無料お見積りOK／フリーダイヤル（営業時間外・土日は AI が受付）／受付時間／AIに相談
//   SP：固定ヘッダー＋赤い「もくじ」ボタンで、AI相談と電話のメニューを開く
import { PhoneCall, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ConsultLink from "./consult/ConsultLink";
import { AI_ICONS, AiNav } from "./SiteNav";
import { AI_NAV, ASSETS, BRAND } from "@/lib/brand";

/** メニュー（もくじ）のトップページの項目（一畳屋のホームページのもくじと同じく、ページの中身へ移動する） */
const DRAWER_SECTIONS = [
  { href: "/#info", label: "営業のご案内" },
  { href: "/#faq", label: "よくあるご質問" },
  { href: "/#reasons", label: "当社が選ばれる理由" },
  { href: "/#message", label: "一畳屋について" },
  { href: "/#stores", label: "店舗のご案内" },
];
const AiIcon = AI_ICONS.ai;

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
        <div className="flex h-20 items-center pl-5 lg:h-[100px] lg:pl-10" data-header-bar>
          <Link href="/" className="flex max-w-[calc(100vw-120px)] items-center gap-2 pr-3 transition-opacity hover:opacity-80 sm:gap-2.5" aria-label="一畳屋 AI相談窓口 トップ">
            <img src={ASSETS.logoColor} alt="一畳屋" width={205} className="w-[min(165px,calc((100vw-120px)*0.72))] lg:w-[205px]" />
            <img src={ASSETS.hyakunen} alt="百年企業" width={69} className="w-[min(55px,calc((100vw-120px)*0.24))] lg:w-[70px]" />
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
            <div className="pl-[30px] text-[11px] font-bold leading-none">
              <img src={ASSETS.uketsuke} alt={`受付 ${BRAND.hours}`} width={190} />
              <span className="mt-1.5 block text-ichi-green" data-phone-note>
                ※{BRAND.phoneAiNote}
              </span>
              <span className="mt-1 block">{BRAND.hoursNote}</span>
            </div>
          </div>

          {/* 一畳屋サイトの「LINEで相談」の位置を、AI相談の入口にしています（ご相談の窓口を AI に一元化） */}
          <div className="hidden pl-10 lg:block">
            <ConsultLink
              href="/#ai-consult"
              command={{ action: "text" }}
              className="flex h-[100px] w-[187px] flex-col items-center justify-center gap-1.5 bg-ichi-line text-white transition-opacity duration-300 hover:opacity-80"
              aria-label="AI相談（24時間受付）"
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
            </ConsultLink>
          </div>
        </div>
      </header>

      {/* SP：固定ヘッダーの高さ分のスペーサー */}
      <div className="h-20 lg:hidden" aria-hidden data-header-bar />

      {/* AI相談と電話のメニュー（トップはキービジュアルの下に表示）。ほかのページのスマホでは出さない（相談の画面を画面いっぱいに。電話は画面の中とメニューに） */}
      {!isHome ? (
        <div className="hidden lg:block">
          <AiNav />
        </div>
      ) : null}

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

      {/* SP：メニュー（一畳屋のホームページの「もくじ」と同じ：緑の地に白い手書き文字の項目を中央に・点線の区切り、その下に白地で電話と相談のボタン） */}
      <div id="drawer" className="drawer fixed inset-0 z-[125] lg:hidden" aria-hidden={!open}>
        <div className="absolute inset-0 bg-white/80" onClick={() => setOpen(false)} />
        <div className="drawer__container absolute right-0 top-0 flex h-full w-full max-w-[480px] flex-col overflow-y-auto overscroll-contain bg-white text-sumi-800">
          {/* 一畳屋のホームページと同じく、メニューを開いてもロゴを上に出す（右上は閉じるボタン） */}
          <div className="flex h-20 shrink-0 items-center pl-5 pr-[100px]" data-header-bar>
            <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80 sm:gap-2.5" tabIndex={open ? 0 : -1} aria-label="一畳屋 AI相談窓口 トップ" onClick={() => setOpen(false)}>
              <img src={ASSETS.logoColor} alt="一畳屋" width={165} className="w-[min(165px,calc((100vw-120px)*0.72))]" />
              <img src={ASSETS.hyakunen} alt="百年企業" width={55} className="w-[min(55px,calc((100vw-120px)*0.24))]" />
            </Link>
          </div>
          <nav className="bg-ptn-logo px-5 py-2 text-white" aria-label="もくじ">
            <ul>
              {AI_NAV.map((n) => {
                const Icon = AI_ICONS[n.icon];
                return (
                  <li key={n.href} className="border-b border-dashed border-white/60">
                    <ConsultLink
                      href={n.href}
                      command={{ action: n.action }}
                      className="flex min-h-[60px] items-center justify-center gap-2 py-3 font-hand text-[20px]"
                      tabIndex={open ? 0 : -1}
                      onDone={() => setOpen(false)}
                    >
                      <Icon className="h-5 w-5 text-ichi-yellow" strokeWidth={2.4} />
                      {n.label}
                    </ConsultLink>
                  </li>
                );
              })}
              {DRAWER_SECTIONS.map((s, i) => (
                <li key={s.href} className={i < DRAWER_SECTIONS.length - 1 ? "border-b border-dashed border-white/60" : ""}>
                  <a href={s.href} className="flex min-h-[60px] items-center justify-center py-3 font-hand text-[20px]" tabIndex={open ? 0 : -1} onClick={() => setOpen(false)}>
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="px-5 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-8 text-center">
            <p className="text-[15px] font-bold leading-relaxed">
              畳・襖は一畳屋に
              <br />＼お気軽にご相談ください！／
            </p>
            <img src={ASSETS.fukidashiFree} alt="無料お見積りOK" width={96} className="mt-3" />
            <a href={`tel:${BRAND.freeDialTel}`} className="mt-1 block" tabIndex={open ? 0 : -1} aria-label={`${BRAND.freeDial} に電話をかける`}>
              <img src={ASSETS.freeDial} alt={BRAND.freeDial} width={320} className="mx-auto w-full max-w-[320px]" />
            </a>
            <img src={ASSETS.uketsuke} alt={`受付 ${BRAND.hours}`} width={170} className="mx-auto mt-3" />
            <p className="mt-2 inline-flex rounded-full bg-ichi-green px-3 py-1 text-xs font-bold text-white" data-phone-note>
              {BRAND.phoneAiNote}
            </p>
            <p className="mt-1.5 text-xs font-bold">{BRAND.hoursNote}</p>
            <ConsultLink
              href="/#ai-consult"
              command={{ action: "text" }}
              className="mt-5 flex min-h-[64px] w-full items-center justify-center gap-2 bg-ichi-line px-4 font-hand text-[20px] text-white transition-opacity hover:opacity-80"
              tabIndex={open ? 0 : -1}
              onDone={() => setOpen(false)}
            >
              <AiIcon className="h-6 w-6" strokeWidth={2.4} />
              AI相談（24時間受付）
            </ConsultLink>
            <a href={`tel:${BRAND.freeDialTel}`} className="btn-accent mt-3 min-h-12 w-full text-[15px]" tabIndex={open ? 0 : -1}>
              <PhoneCall className="h-4 w-4" />
              電話をかける
            </a>
            <Link href="/admin" className="mt-6 inline-flex min-h-10 items-center justify-center gap-1.5 px-3 text-xs text-sumi-500 underline" tabIndex={open ? 0 : -1}>
              <Settings2 className="h-3.5 w-3.5" />
              スタッフ用管理画面
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
