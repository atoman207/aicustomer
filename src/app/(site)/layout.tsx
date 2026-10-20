import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

// お客様向けのページ（一畳屋サイトと同じヘッダー・フッター）。管理画面（/admin）は独自のヘッダーを使う
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
