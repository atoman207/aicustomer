"use client";

// 表示中に問題が起きたときの画面（白い画面・「Application error」にしない）：もう一度表示する・トップへ・電話
//   2 回目の「もう一度表示する」では、この端末に保存した会話も消して読み込み直す（保存した内容が原因で表示できない場合のため）
import { PhoneCall, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { clearConversation } from "@/lib/conversation-store";
import { BRAND } from "@/lib/brand";
import { reportClientError } from "@/lib/report-error";

/** 「もう一度表示する」を押した回数（表示し直すとこの画面は作り直されるので、画面の外で数える） */
const retries = new Map<string, number>();

export default function ErrorFallback({ error, reset, where, compact = false }: { error: unknown; reset: () => void; where: string; compact?: boolean }) {
  useEffect(() => {
    reportClientError(where, error);
  }, [error, where]);

  function retry() {
    const n = (retries.get(where) ?? 0) + 1;
    retries.set(where, n);
    if (n >= 2) {
      retries.delete(where);
      clearConversation();
      window.location.reload();
      return;
    }
    reset();
  }

  return (
    <div className={`mx-auto w-full max-w-[560px] text-center ${compact ? "card px-5 py-8" : "px-5 py-16"}`} role="alert">
      <p className="font-hand text-[22px] leading-snug text-ichi-theme">表示中に問題が発生しました</p>
      <p className="mt-3 text-[15px] leading-relaxed text-sumi-600">
        お手数ですが、「もう一度表示する」を押してください。
        <br className="hidden sm:inline" />
        直らない場合は、お電話でもご相談いただけます。
      </p>
      <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
        <button type="button" onClick={retry} className="btn-primary min-h-12 text-[15px]">
          <RotateCcw className="h-4 w-4" />
          もう一度表示する
        </button>
        {!compact ? (
          <a href="/" className="btn-secondary min-h-12 text-[15px]">
            トップへ戻る
          </a>
        ) : null}
        <a href={`tel:${BRAND.freeDialTel}`} className="btn-accent min-h-12 text-[15px]">
          <PhoneCall className="h-4 w-4" />
          {BRAND.freeDial}
        </a>
      </div>
    </div>
  );
}
