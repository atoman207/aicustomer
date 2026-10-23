"use client";

// スマホ・タブレット：トップを読み進めても「AI相談」と「電話する」をすぐ押せるように、画面下に固定表示
//   一畳屋のホームページの画面下のボタン（左が緑・右が黄色・高さ 60px）と同じ見た目
//   ・「AIに相談する」の相談の画面が見えている間（入力欄に重ならないように）と、ページの最下部では隠す
import { MessageSquareText, PhoneCall } from "lucide-react";
import { useEffect, useState } from "react";
import ConsultLink from "./consult/ConsultLink";
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
      className={`sticky-actions fixed inset-x-0 bottom-0 z-[100] bg-white shadow-[0_-4px_14px_rgba(0,0,0,0.12)] transition-transform duration-300 lg:hidden ${
        show ? "translate-y-0" : "translate-y-full"
      }`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-hidden={!show}
      data-show={show ? "true" : "false"}
    >
      <div className="grid grid-cols-2">
        <ConsultLink
          href="/#ai-consult"
          command={{ action: "text" }}
          className="flex h-[60px] items-center justify-center gap-2 bg-ichi-line px-2 font-hand text-[19px] text-white transition-opacity hover:opacity-80"
          tabIndex={show ? 0 : -1}
        >
          <MessageSquareText className="h-5 w-5" strokeWidth={2.4} />
          AI相談
        </ConsultLink>
        <a
          href={`tel:${BRAND.freeDialTel}`}
          className="flex h-[60px] flex-col items-center justify-center bg-ichi-yellow px-2 text-ichi-text transition-opacity hover:opacity-80"
          tabIndex={show ? 0 : -1}
          aria-label={`電話をかける（${BRAND.freeDial}・${BRAND.phoneAiNote}）`}
        >
          <span className="flex items-center gap-1.5 font-hand text-[19px] leading-none">
            <PhoneCall className="h-5 w-5" strokeWidth={2.4} />
            電話する
          </span>
          <span className="mt-1 text-[11px] font-bold leading-none text-ichi-theme">時間外はAIが受付</span>
        </a>
      </div>
    </div>
  );
}
