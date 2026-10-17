import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AdminLogin from "@/components/AdminLogin";
import { isAdminAuthenticated } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "管理画面ログイン" };

export default async function AdminLoginPage() {
  if (await isAdminAuthenticated()) redirect("/admin");
  return (
    <div className="container-x flex min-h-[60vh] items-center py-12">
      <AdminLogin />
    </div>
  );
}
