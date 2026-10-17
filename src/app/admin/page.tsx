import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AdminDashboard from "@/components/AdminDashboard";
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
    <div className="container-x py-8">
      <div className="mb-6">
        <p className="eyebrow">管理画面</p>
        <h1 className="section-title mt-1">受付一覧・会話履歴・設定・ナレッジ</h1>
        <p className="mt-2 text-sm text-sumi-600">3窓口（テキスト・音声・電話）＋LINEの受付情報を一元管理し、AI／人間の切替やナレッジの確認を行います。</p>
      </div>
      <AdminDashboard initialStatus={status} initialSettings={settings} protectedMode={env.adminProtected} />
    </div>
  );
}
