// 今のホームページ（public/embed.js の「AIに相談」の窓）として、お客様向けのページを開いてよいサイト。
// それ以外のサイトの中では開けない（なりすまし・クリックジャッキングの防止）。管理画面はどのサイトの中でも開けない
const EMBED_ORIGINS = (process.env.EMBED_ALLOWED_ORIGINS || "https://ichijoya.co.jp https://www.ichijoya.co.jp")
  .split(/[\s,]+/)
  .map((s) => s.trim().replace(/\/$/, ""))
  .filter((s) => /^https?:\/\/[^\s'";]+$/.test(s));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  // AI の回答情報源（database/*.json）は import でビルドに同梱するため、実行時のファイル読み込みはありません
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [390, 640, 768, 1024, 1280, 1536, 1920],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" },
        ],
      },
      {
        source: "/((?!admin|api/).*)",
        headers: [{ key: "Content-Security-Policy", value: `frame-ancestors 'self' ${EMBED_ORIGINS.join(" ")}` }],
      },
      {
        source: "/admin/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
