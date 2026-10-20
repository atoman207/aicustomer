import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AdminApp from "@/components/admin/AdminApp";
import { isAdminAuthenticated } from "@/lib/auth";
import { env } from "@/lib/env";
import { serverBaseUrl } from "@/lib/server-url";
import { getIntegrationStatus } from "@/lib/status";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "管理画面", robots: { index: false, follow: false } };

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");
  const [status, settings, params] = await Promise.all([getIntegrationStatus(await serverBaseUrl()), getSettings(), searchParams]);
  return <AdminApp initialStatus={status} initialSettings={settings} protectedMode={env.adminProtected} initialView={params.view} />;
}
