import type { Metadata, Viewport } from "next";
import "./globals.css";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";

function siteUrl(): URL {
  const explicit = process.env.PUBLIC_BASE_URL?.trim();
  if (explicit) return new URL(explicit);
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return new URL(`https://${vercel}`);
  return new URL("http://localhost:3000");
}

const TITLE = "AI顧客相談・電話受付システム｜熊本たたみ工房（デモ）";
const DESCRIPTION =
  "熊本県の畳・襖・障子・網戸・リフォーム会社向け AI 顧客相談システム。テキスト相談・音声相談・AI電話受付の3窓口を共通の社内ナレッジで自動化し、見積受付をスプレッドシートに記録します。";

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: TITLE, template: "%s｜熊本たたみ工房（デモ）" },
  description: DESCRIPTION,
  icons: { icon: "/favicon.svg" },
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName: "熊本たたみ工房（デモ）",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/og.jpg", width: 1200, height: 630, alt: "障子越しの光が差し込む和室" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og.jpg"] },
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
        <div className="h-1 w-full bg-gradient-to-r from-ai-700 via-shu-500 to-tatami-500" aria-hidden />
        <SiteHeader company={settings.companyName} phone={settings.companyPhone} />
        <main className="flex-1">{children}</main>
        <SiteFooter company={settings.companyName} phone={settings.companyPhone} />
      </body>
    </html>
  );
}
