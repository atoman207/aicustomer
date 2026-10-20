import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AdminLogin from "@/components/AdminLogin";
import { isAdminAuthenticated } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "管理画面ログイン", robots: { index: false, follow: false } };

export default async function AdminLoginPage() {
  if (await isAdminAuthenticated()) redirect("/admin");
  return (
    <div className="flex min-h-dvh flex-col bg-[#f9f9f9] leading-normal">
      <header className="flex h-14 items-center gap-2 border-b border-black/[0.06] bg-white px-4">
        <Link href="/" className="shrink-0 rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-black/20" aria-label="トップページへ">
          <img src="/ichijoya/logo-symbol.svg" alt="一畳屋" className="h-7 w-7" />
        </Link>
        <p className="text-sm font-semibold text-[#0d0d0d]">一畳屋 AI 管理画面</p>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <AdminLogin />
      </main>
    </div>
  );
}
