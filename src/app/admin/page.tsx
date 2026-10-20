import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AdminDashboard from "@/components/AdminDashboard";
import PageHero from "@/components/PageHero";
import { isAdminAuthenticated } from "@/lib/auth";
import { env } from "@/lib/env";
import { serverBaseUrl } from "@/lib/server-url";
import { getIntegrationStatus } from "@/lib/status";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "管理画面" };

export default async function AdminPage() {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");
  const [status, settings] = await Promise.all([getIntegrationStatus(await serverBaseUrl()), getSettings()]);
  return (
    <PageHero kicker="スタッフ専用" ruby="かんりがめん" title="AI相談 管理画面">
      <div className="rounded-[15px] bg-white p-4 shadow-card sm:p-6">
        <AdminDashboard initialStatus={status} initialSettings={settings} protectedMode={env.adminProtected} />
      </div>
    </PageHero>
  );
}
