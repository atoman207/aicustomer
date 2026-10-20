"use client";

import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: "neutral" | "green" | "amber" | "red" | "blue";
  children: ReactNode;
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "border-sumi-200 bg-white text-sumi-600",
    green: "border-ichi-leaf bg-white text-ichi-leaf",
    amber: "border-[#e0b400] bg-[#fffcdb] text-[#7a5a00]",
    red: "border-ichi-red bg-white text-ichi-red",
    blue: "border-ichi-theme bg-ichi-theme text-white",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function ModeBadge({ mode }: { mode: string }) {
  if (mode === "openai")
    return (
      <Badge tone="green">
        <CheckCircle2 className="h-3 w-3" />
        AI（OpenAI）接続中
      </Badge>
    );
  return (
    <Badge tone="amber">
      <AlertTriangle className="h-3 w-3" />
      デモモード（テンプレート応答）
    </Badge>
  );
}

export function DemoNotice({ reason, compact = false }: { reason?: string; compact?: boolean }) {
  return (
    <div className={`rounded-lg border border-[#e0b400] bg-[#fffcdb] text-[#5c4400] ${compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"}`}>
      <p className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <span className="font-bold">デモモードで動作中：</span>
          OPENAI_API_KEY が未設定のため、あらかじめ用意したテンプレート応答（社内ナレッジのキーワード検索）で動作しています。
          <code className="mx-1 rounded bg-white/70 px-1">.env</code>に OPENAI_API_KEY を設定して再起動すると、同じ画面がそのまま本番の AI 応答に切り替わります。
          {reason ? <span className="mt-1 block text-xs opacity-80">{reason}</span> : null}
        </span>
      </p>
    </div>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

/** サイトの .p-modal と同じ：黒 80% の背景、枠は 0.9 倍から拡大しながらフェード */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  // ヘッダーより前面に出すため body 直下に描画（親の z-index の影響を受けない）
  return createPortal(
    <div className="modal-overlay fixed inset-0 z-[200] flex items-end justify-center bg-black/80 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal-frame relative max-h-[92vh] w-full overflow-y-auto rounded-t-[15px] border-2 border-ichi-theme bg-white p-5 shadow-2xl sm:rounded-[15px] sm:p-7 ${
          wide ? "sm:max-w-4xl" : "sm:max-w-2xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between gap-3 border-b border-sumi-100 pb-3">
          <h2 className="flex items-center gap-2 font-hand text-lg text-ichi-theme sm:text-xl">
            <img src="/ichijoya/logo-symbol.svg" alt="" width={26} />
            {title}
          </h2>
          <button
            type="button"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ichi-theme text-white transition-opacity hover:opacity-80"
            onClick={onClose}
            aria-label="閉じる"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-sumi-600">
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-ichi-leaf" : "bg-[#e0b400]"}`} />
      {label}
    </span>
  );
}
