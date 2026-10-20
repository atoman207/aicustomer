// フッター（濃緑のロゴ柄・著作権表記とスタッフ用リンクのみ）
import Link from "next/link";
import { ASSETS, BRAND } from "@/lib/brand";

export default function SiteFooter() {
  return (
    <footer className="mt-auto bg-ptn-logo text-white">
      <div className="mx-auto flex w-[calc(100%-40px)] max-w-[1170px] flex-col items-center gap-3 py-6 sm:flex-row sm:justify-between">
        <Link href="/" className="transition-opacity hover:opacity-80" aria-label="一畳屋 AI相談窓口 トップ">
          <img src={ASSETS.logoWhite} alt="一畳屋" width={150} />
        </Link>
        <small className="text-xs text-white/90">{BRAND.copyright}</small>
        <Link href="/admin" className="text-xs text-white/80 underline-offset-2 hover:underline">
          スタッフ用管理画面
        </Link>
      </div>
    </footer>
  );
}
