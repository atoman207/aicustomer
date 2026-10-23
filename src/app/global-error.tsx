"use client";

// 一番外側（ページ全体の枠）で問題が起きたときの画面。ほかの画面の部品・スタイルが使えない場合でも表示できるように、ここだけで完結させる
import { useEffect } from "react";
import { BRAND } from "@/lib/brand";
import { reportClientError } from "@/lib/report-error";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError("ページ全体の表示", error);
  }, [error]);
  const button = { display: "block", width: "100%", maxWidth: 320, margin: "12px auto 0", padding: "14px 16px", borderRadius: 999, fontSize: 16, fontWeight: 700, border: "none", cursor: "pointer", textDecoration: "none" } as const;
  return (
    <html lang="ja">
      <body style={{ margin: 0, fontFamily: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif', color: "#222", background: "#fffdea" }}>
        <main style={{ padding: "64px 20px", textAlign: "center", maxWidth: 560, margin: "0 auto" }} role="alert">
          <p style={{ fontSize: 22, fontWeight: 700, color: "#1c4911", margin: 0 }}>表示中に問題が発生しました</p>
          <p style={{ fontSize: 15, lineHeight: 1.8, marginTop: 12 }}>お手数ですが、「もう一度表示する」を押してください。直らない場合は、お電話でもご相談いただけます。</p>
          <button type="button" onClick={() => reset()} style={{ ...button, background: "#488937", color: "#fff" }}>
            もう一度表示する
          </button>
          <a href="/" style={{ ...button, background: "#fff", color: "#222", border: "1px solid #222", boxSizing: "border-box" }}>
            トップへ戻る
          </a>
          <a href={`tel:${BRAND.freeDialTel}`} style={{ ...button, background: "#a72126", color: "#fff", boxSizing: "border-box" }}>
            電話 {BRAND.freeDial}
          </a>
        </main>
      </body>
    </html>
  );
}
