import type { Metadata, Viewport } from "next";
import "./globals.css";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "AI顧客相談・電話受付システム｜熊本たたみ工房（デモ）",
    template: "%s｜熊本たたみ工房（デモ）",
  },
  description:
    "熊本県の畳・襖・障子・網戸・リフォーム会社向け AI 顧客相談システムのデモ。テキスト相談・音声相談・AI電話受付の3窓口を共通の社内ナレッジで自動化し、見積受付をスプレッドシートに記録します。",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#234b73",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings();
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Shippori+Mincho:wght@500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="flex min-h-screen flex-col">
        <SiteHeader company={settings.companyName} phone={settings.companyPhone} />
        <main className="flex-1">{children}</main>
        <SiteFooter company={settings.companyName} phone={settings.companyPhone} />
      </body>
    </html>
  );
}
