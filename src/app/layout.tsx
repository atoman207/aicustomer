import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ASSETS } from "@/lib/brand";

export const dynamic = "force-dynamic";

function siteUrl(): URL {
  const explicit = process.env.PUBLIC_BASE_URL?.trim();
  if (explicit) return new URL(explicit);
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return new URL(`https://${vercel}`);
  return new URL("http://localhost:3000");
}

const TITLE = "AI相談窓口｜畳の一畳屋｜熊本県内の畳・襖・障子・網戸の張り替え・交換専門店";
const DESCRIPTION =
  "熊本生まれ熊本育ち、創業120年の一畳屋のAI相談窓口です。畳・襖・障子・網戸の料金や仕上がり日数、対応エリアなどに、文字でも声でもAIが24時間お答えします。フリーダイヤルは営業時間外・土日もAIが受付。お見積りのご依頼は内容を確認のうえ担当者が折り返しご連絡します。";

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: TITLE, template: "%s｜AI相談窓口｜畳の一畳屋" },
  description: DESCRIPTION,
  icons: { icon: ASSETS.favicon, apple: ASSETS.appleTouch },
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName: "畳の一畳屋｜熊本県内の畳・襖・障子・網戸の張り替え・交換専門店",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: ASSETS.og, width: 1200, height: 630, alt: "畳の一畳屋" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [ASSETS.og] },
};

export const viewport: Viewport = {
  themeColor: "#1c4911",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        {/* スクロール表示アニメーション用（JS 無効時は最初から表示） */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
        {/* 今のホームページの「AIに相談」の窓（public/embed.js）の中で開いたとき：ヘッダー・フッター・見出しを出さない */}
        <script
          dangerouslySetInnerHTML={{
            __html: "try{if(/[?&]embed=1/.test(location.search)||window.self!==window.top)document.documentElement.dataset.embed='1'}catch(e){document.documentElement.dataset.embed='1'}",
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&family=Yusei+Magic&display=swap"
          rel="stylesheet"
        />
      </head>
      {/* ヘッダー・フッターはお客様向けページ（app/(site)/layout.tsx）と管理画面（独自のヘッダー）でそれぞれ持つ */}
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
