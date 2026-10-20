"use client";

// スマホ：トップを読み進めても「AIに相談」と「電話する」をすぐ押せるように、画面下に小さく固定表示
//   ・最初の「AIに相談する」欄が見えている間と、ページの最下部では隠す（同じボタンが見えているため）
import { MessageSquareText, PhoneCall } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BRAND } from "@/lib/brand";

export default function StickyActions({ watchId }: { watchId: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const update = () => {
      const el = document.getElementById(watchId);
      const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 140;
      if (!el) {
        setShow(window.scrollY > 400 && !nearBottom);
        return;
      }
      const r = el.getBoundingClientRect();
      const consultVisible = r.top < window.innerHeight && r.bottom > 0;
      setShow(!consultVisible && r.bottom <= 0 && !nearBottom);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [watchId]);

  return (
    <div
      className={`sticky-actions fixed inset-x-0 bottom-0 z-[100] border-t border-ichi-green/30 bg-white/95 px-3 pt-2 shadow-[0_-4px_14px_rgba(0,0,0,0.08)] backdrop-blur transition-transform duration-300 lg:hidden ${
        show ? "translate-y-0" : "translate-y-full"
      }`}
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}
      aria-hidden={!show}
      data-show={show ? "true" : "false"}
    >
      <div className="mx-auto grid max-w-[520px] grid-cols-2 gap-2">
        <Link href="/chat" className="btn-primary h-12 rounded-xl text-[15px]" tabIndex={show ? 0 : -1}>
          <MessageSquareText className="h-5 w-5" />
          AIに相談
        </Link>
        <a
          href={`tel:${BRAND.freeDialTel}`}
          className="flex h-12 flex-col items-center justify-center rounded-xl border-2 border-ichi-red bg-white text-ichi-red transition-opacity hover:opacity-80"
          tabIndex={show ? 0 : -1}
          aria-label={`電話をかける（${BRAND.freeDial}・${BRAND.phoneAiNote}）`}
        >
          <span className="flex items-center gap-1 text-[15px] font-bold leading-none">
            <PhoneCall className="h-4 w-4" />
            電話する
          </span>
          <span className="mt-1 text-[10px] font-bold leading-none text-ichi-green">{BRAND.phoneAiNote}</span>
        </a>
      </div>
    </div>
  );
}
