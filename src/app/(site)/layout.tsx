import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

// お客様向けのページ（一畳屋サイトと同じヘッダー・フッター）。管理画面（/admin）は独自のヘッダーを使う
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* site-chrome：今のホームページの窓（embed.js）の中では出さない */}
      <div className="site-chrome contents">
        <SiteHeader />
      </div>
      <main className="flex-1">{children}</main>
      <div className="site-chrome contents">
        <SiteFooter />
      </div>
    </div>
  );
}
