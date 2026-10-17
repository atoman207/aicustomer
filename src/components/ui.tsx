"use client";

import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

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
    neutral: "border-washi-300 bg-washi-100 text-sumi-600",
    green: "border-tatami-200 bg-tatami-50 text-tatami-700",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    red: "border-shu-200 bg-shu-50 text-shu-700",
    blue: "border-ai-200 bg-ai-50 text-ai-700",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function ModeBadge({ mode }: { mode: string }) {
  if (mode === "openai")
    return (
      <Badge tone="green">
        <CheckCircle2 className="h-3 w-3" />
        OpenAI API 接続中
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
    <div className={`rounded-xl border border-amber-200 bg-amber-50 text-amber-900 ${compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"}`}>
      <p className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <span className="font-semibold">デモモードで動作中：</span>
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
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-sumi-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-washi-50 p-5 shadow-2xl animate-fadeUp sm:rounded-2xl ${wide ? "sm:max-w-4xl" : "sm:max-w-2xl"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-lg font-bold text-sumi-800">{title}</h2>
          <button type="button" className="rounded-full p-1.5 text-sumi-400 hover:bg-washi-200 hover:text-sumi-700" onClick={onClose} aria-label="閉じる">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-sumi-600">
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-tatami-500" : "bg-amber-400"}`} />
      {label}
    </span>
  );
}
