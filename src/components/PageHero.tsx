// 下層ページのタイトル帯（一畳屋サイト「畳替え価格」ページと同じクリーム地＋黄色い畳柄の帯）
//   compact：文字・声の相談ページ用（タイトルを小さくして、相談の枠を画面の上の方に）
import type { ReactNode } from "react";

export default function PageHero({
  kicker,
  ruby,
  title,
  badge,
  lead,
  compact = false,
  children,
}: {
  kicker: string;
  ruby?: string;
  title: string;
  badge?: [string, string];
  lead?: string;
  compact?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className={`relative bg-ichi-cream ${compact ? "pb-8 sm:pb-10" : "pb-14"}`}>
      <div className={`relative z-10 mx-auto flex w-full max-w-[1200px] flex-col items-center px-5 text-center ${compact ? "pt-4 sm:pt-6" : "pt-7 sm:pt-9"}`}>
        <p className="inline-flex items-center gap-2 rounded-full bg-ichi-theme px-4 py-1 text-xs font-bold tracking-wider text-white">{kicker}</p>
        <div className="mt-2 inline-flex items-start justify-center gap-3 sm:gap-5">
          {badge ? (
            <span
              className={`relative mt-3 grid shrink-0 place-items-center rounded-[46%_54%_50%_50%/55%_48%_52%_45%] bg-ichi-yellow font-hand leading-[1.05] text-ichi-red ${
                compact ? "h-[46px] w-[54px] text-[12px] sm:h-[58px] sm:w-[68px] sm:text-[15px]" : "h-[56px] w-[64px] text-[14px] sm:h-[70px] sm:w-[80px] sm:text-[17px]"
              }`}
            >
              <span>
                {badge[0]}
                <br />
                {badge[1]}
              </span>
              <span className="absolute -right-2 top-1/2 h-0 w-0 -translate-y-1/2 border-y-[7px] border-l-[12px] border-y-transparent border-l-ichi-yellow" aria-hidden />
            </span>
          ) : null}
          <div>
            {ruby ? <p className="font-hand text-[12px] tracking-[0.5em] text-ichi-theme sm:text-sm">{ruby}</p> : null}
            <h1 className={`font-hand leading-[1.15] text-ichi-theme ${compact ? "text-[28px] sm:text-[40px]" : "text-[34px] sm:text-[50px]"}`}>{title}</h1>
          </div>
        </div>
        {lead ? <p className="mt-2 max-w-xl text-xs leading-relaxed text-sumi-600 sm:text-sm">{lead}</p> : null}
      </div>
      <div className="relative">
        <div className={`bg-yellow-tatami absolute inset-x-0 -top-6 sm:-top-8 ${compact ? "h-[220px] sm:h-[260px]" : "h-[300px] sm:h-[340px]"}`} aria-hidden />
        <div className={`relative z-10 mx-auto w-full max-w-[1200px] px-3 sm:px-5 ${compact ? "pt-4" : "pt-6"}`}>{children}</div>
      </div>
    </section>
  );
}
