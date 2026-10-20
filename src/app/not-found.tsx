import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="bg-ichi-cream">
          <div className="container-x flex min-h-[50vh] flex-col items-center justify-center py-16 text-center">
            <img src="/ichijoya/logo-symbol.svg" alt="" width={64} />
            <p className="mt-4 font-en text-sm font-bold tracking-[0.3em] text-ichi-green">404 NOT FOUND</p>
            <h1 className="mt-2 font-hand text-[28px] text-sumi-800 sm:text-[36px]">お探しのページが見つかりません</h1>
            <Link href="/" className="btn-primary mt-6">
              AI相談窓口トップへ
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
