// 下層ページのタイトル帯（一畳屋サイト「畳替え価格」ページと同じクリーム地＋黄色い畳柄の帯）
import type { ReactNode } from "react";

export default function PageHero({
  kicker,
  ruby,
  title,
  badge,
  children,
}: {
  kicker: string;
  ruby?: string;
  title: string;
  badge?: [string, string];
  children?: ReactNode;
}) {
  return (
    <section className="relative bg-ichi-cream pb-14">
      <div className="relative z-10 mx-auto flex w-full max-w-[1200px] flex-col items-center px-5 pt-7 text-center sm:pt-9">
        <p className="inline-flex items-center gap-2 rounded-full bg-ichi-theme px-4 py-1 text-xs font-bold tracking-wider text-white">{kicker}</p>
        <div className="mt-2 inline-flex items-start justify-center gap-3 sm:gap-5">
          {badge ? (
            <span className="relative mt-3 grid h-[56px] w-[64px] shrink-0 place-items-center rounded-[46%_54%_50%_50%/55%_48%_52%_45%] bg-ichi-yellow font-hand text-[14px] leading-[1.05] text-ichi-red sm:h-[70px] sm:w-[80px] sm:text-[17px]">
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
            <h1 className="font-hand text-[34px] leading-[1.15] text-ichi-theme sm:text-[50px]">{title}</h1>
          </div>
        </div>
      </div>
      <div className="relative">
        <div className="bg-yellow-tatami absolute inset-x-0 -top-6 h-[300px] sm:-top-8 sm:h-[340px]" aria-hidden />
        <div className="relative z-10 mx-auto w-full max-w-[1200px] px-5 pt-6">{children}</div>
      </div>
    </section>
  );
}
