"use client";

// 管理画面で表示中に問題が起きたとき
import ErrorFallback from "@/components/ErrorFallback";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} where="管理画面の表示" />;
}
