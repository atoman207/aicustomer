import Link from "next/link";
import { Hanko } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="container-x flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
      <Hanko>迷</Hanko>
      <p className="eyebrow mt-6">404</p>
      <h1 className="section-title mt-2">お探しのページが見つかりません</h1>
      <p className="mt-3 max-w-md text-sm text-sumi-600">
        URL が変更されたか、削除された可能性があります。トップページから各相談窓口へお進みください。
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link href="/" className="btn-primary">
          トップページへ
        </Link>
        <Link href="/chat" className="btn-secondary">
          テキスト相談
        </Link>
        <Link href="/phone" className="btn-secondary">
          AI電話受付
        </Link>
      </div>
    </div>
  );
}
