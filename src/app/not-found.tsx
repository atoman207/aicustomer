import Link from "next/link";

export default function NotFound() {
  return (
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
  );
}
