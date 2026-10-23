// フッター（濃緑のロゴ柄・会社情報・著作権表記とスタッフ用リンク）
//   会社情報は一畳屋のホームページのフッターと同じ（株式会社一畳屋・住所・電話番号）
import Link from "next/link";
import { ASSETS, BRAND } from "@/lib/brand";

export default function SiteFooter() {
  return (
    <footer className="mt-auto bg-ptn-logo text-white">
      <div className="mx-auto flex w-[calc(100%-40px)] max-w-[1170px] flex-col items-center gap-3 py-8 text-center lg:flex-row lg:justify-between lg:py-6 lg:text-left">
        <Link href="/" className="transition-opacity hover:opacity-80" aria-label="一畳屋 AI相談窓口 トップ">
          <img src={ASSETS.logoWhite} alt="一畳屋" width={150} />
        </Link>
        <address className="text-sm not-italic leading-relaxed text-white/95">
          {BRAND.legalName}
          <br className="lg:hidden" />
          <span className="hidden lg:inline">　</span>
          {BRAND.postal} {BRAND.address}
          <br />
          TEL.
          <a href={`tel:${BRAND.telHref}`} className="underline-offset-2 hover:underline">
            {BRAND.tel}
          </a>
          （フリーダイヤル <a href={`tel:${BRAND.freeDialTel}`} className="underline-offset-2 hover:underline">{BRAND.freeDial}</a>）
        </address>
        <div className="flex flex-col items-center gap-1 lg:items-end">
          <small className="text-xs text-white/90">{BRAND.copyright}</small>
          <Link href="/admin" className="inline-flex min-h-10 items-center px-2 text-xs text-white/80 underline-offset-2 hover:underline">
            スタッフ用管理画面
          </Link>
        </div>
      </div>
    </footer>
  );
}
