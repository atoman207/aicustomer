import Link from "next/link";
import { IMAGE_CREDITS } from "@/lib/images";

export default function SiteFooter({ company, phone }: { company: string; phone: string }) {
  return (
    <footer className="mt-16 border-t border-washi-300/70 bg-washi-100/80">
      <div className="container-x grid gap-8 py-10 md:grid-cols-3">
        <div>
          <p className="font-serif text-lg font-bold text-sumi-800">{company}</p>
          <p className="mt-2 text-sm text-sumi-500">
            熊本県の畳・襖・障子・網戸・住宅リフォーム。
            <br />
            AI による相談・見積受付を 24 時間承ります。
          </p>
          <p className="mt-3 text-sm font-semibold text-shu-600">フリーダイヤル {phone}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-sumi-400">相談窓口</p>
          <ul className="mt-2 space-y-1 text-sm text-sumi-600">
            <li>
              <Link className="hover:text-ai-600" href="/chat">
                ① テキストAI相談（HP）
              </Link>
            </li>
            <li>
              <Link className="hover:text-ai-600" href="/voice">
                ② 音声AI相談（HP）
              </Link>
            </li>
            <li>
              <Link className="hover:text-ai-600" href="/phone">
                ③ AI電話受付（0120）
              </Link>
            </li>
            <li>
              <Link className="hover:text-ai-600" href="/admin">
                管理画面（受付一覧・設定・ナレッジ）
              </Link>
            </li>
          </ul>
        </div>
        <div className="text-xs text-sumi-500">
          <p className="font-semibold text-sumi-600">このサイトはデモです</p>
          <p className="mt-1">
            表示される価格・工期・会社情報はすべてサンプルです。Next.js / OpenAI API / Googleスプレッドシート / Twilio /
            LINE Messaging API で構成されています。
          </p>
          <details className="mt-3">
            <summary className="cursor-pointer text-sumi-500 hover:text-sumi-700">画像クレジット（すべて日本の風景・住まい）</summary>
            <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto pr-2">
              {IMAGE_CREDITS.map((img) => (
                <li key={img.key}>
                  {img.title} — {img.credit}（{img.license} / {img.source}）
                </li>
              ))}
            </ul>
          </details>
        </div>
      </div>
      <div className="border-t border-washi-300/70 py-4 text-center text-xs text-sumi-400">
        © {new Date().getFullYear()} {company} — AI顧客相談・電話受付システム（デモ）
      </div>
    </footer>
  );
}
