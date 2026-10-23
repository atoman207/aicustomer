"use client";

// お客様向けのページで表示中に問題が起きたとき（ヘッダー・フッターはそのまま、中身だけを案内に替える）
import ErrorFallback from "@/components/ErrorFallback";

export default function SiteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} where="お客様向けのページの表示" />;
}
