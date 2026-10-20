"use client";

// 管理画面（ChatGPT 風のシンプルな画面）で共通に使う部品と型
import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { KnowledgeEntry, KnowledgeOrigin, KnowledgeSourceRecord } from "@/lib/types";

export interface AdminEntry extends KnowledgeEntry {
  edited?: boolean;
  hasTable?: boolean;
  updatedAt?: string;
}

export interface SetupInfo {
  supabase: { configured: boolean; ready: boolean; setupRequired?: boolean; error?: string };
  projectRef: string;
  sqlEditorUrl: string;
  tableEditorUrl: string;
  sql: string;
  sync?: { synced: boolean; upserted: number; removed: number };
  entries?: number;
}

export type Source = KnowledgeSourceRecord;

export class ApiError extends Error {
  status: number;
  setupRequired: boolean;
  constructor(message: string, status: number, setupRequired = false) {
    super(message);
    this.status = status;
    this.setupRequired = setupRequired;
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const res = await fetch(url, { ...init, headers: isForm ? init?.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string; setupRequired?: boolean };
  if (!res.ok) throw new ApiError(j.error ?? `通信エラー（HTTP ${res.status}）`, res.status, Boolean(j.setupRequired));
  return j;
}

export const ORIGIN_LABEL: Record<KnowledgeOrigin, string> = {
  manual: "顧客対応マニュアル",
  company: "会社情報",
  website: "ホームページ",
  admin: "入力した情報",
  upload: "ファイルから",
};

export function Chip({ children, tone = "gray" }: { children: React.ReactNode; tone?: "gray" | "green" | "amber" | "red" | "blue" }) {
  const tones = {
    gray: "bg-black/[0.05] text-[#5d5d5d]",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    blue: "bg-sky-50 text-sky-700",
  };
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

export const btn = {
  primary: "inline-flex items-center justify-center gap-1.5 rounded-full bg-[#0d0d0d] px-4 py-2 text-sm font-medium text-white transition hover:bg-black/80 disabled:cursor-not-allowed disabled:bg-black/20",
  ghost: "inline-flex items-center justify-center gap-1.5 rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-[#0d0d0d] transition hover:bg-black/[0.04] disabled:opacity-50",
  danger: "inline-flex items-center justify-center gap-1.5 rounded-full border border-red-200 bg-white px-4 py-2 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-50",
  icon: "grid h-8 w-8 place-items-center rounded-lg text-[#5d5d5d] transition hover:bg-black/[0.05] hover:text-[#0d0d0d]",
};

export const field = "w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-[#0d0d0d] outline-none transition focus:border-black/30 focus:ring-2 focus:ring-black/5";

export function AdminModal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl ${wide ? "sm:max-w-3xl" : "sm:max-w-xl"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-base font-semibold text-[#0d0d0d]">{title}</p>
          <button type="button" className={btn.icon} onClick={onClose} aria-label="閉じる">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function formatDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

export function formatSize(bytes?: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function ErrorNote({ message }: { message: string }) {
  if (!message) return null;
  return <p className="rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-sm text-red-700">{message}</p>;
}
