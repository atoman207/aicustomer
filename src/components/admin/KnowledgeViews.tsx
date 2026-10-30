"use client";

// 管理画面：AI が回答に使うナレッジ（Googleスプレッドシート・ホームページ）の一覧（読み取り専用）
//   内容を変えるときはスプレッドシートを直す（ホームページは「AIの学習状況・情報源」から再学習）
import { Loader2, RefreshCw, Search, Table2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { KnowledgeOrigin } from "@/lib/types";
import { api, btn, Chip, ErrorNote, field, ORIGIN_LABEL, type AdminEntry } from "./shared";

// ---------------- ナレッジ 1 件 ----------------

export function EntryCard({ e }: { e: AdminEntry }) {
  const [open, setOpen] = useState(false);
  const long = e.content.length > 220;
  return (
    <div className="rounded-2xl border border-black/[0.08] bg-white p-4">
      <p className="text-[15px] font-semibold leading-snug text-[#0d0d0d]">{e.title}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {e.origin ? <Chip tone={e.origin === "manual" ? "green" : "gray"}>{ORIGIN_LABEL[e.origin]}</Chip> : null}
        {e.category ? <Chip tone="blue">{e.category}</Chip> : null}
        {e.hasTable ? (
          <Chip tone="green">
            <Table2 className="h-3 w-3" />
            料金表
          </Chip>
        ) : null}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#3d3d3d]">{open || !long ? e.content : `${e.content.slice(0, 220)}…`}</p>
      {long ? (
        <button type="button" className="-mb-2 inline-flex min-h-10 items-center text-xs text-[#5d5d5d] underline underline-offset-2" onClick={() => setOpen(!open)}>
          {open ? "閉じる" : "すべて表示"}
        </button>
      ) : null}
    </div>
  );
}

// ---------------- 登録済みナレッジ ----------------

const ORIGINS: KnowledgeOrigin[] = ["manual", "website"];

export function KnowledgeListView() {
  const [entries, setEntries] = useState<AdminEntry[]>([]);
  const [stale, setStale] = useState<{ id: string; title: string; missing: string[] }[]>([]);
  const [sheetConnected, setSheetConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [origin, setOrigin] = useState<"" | KnowledgeOrigin>("");
  const [category, setCategory] = useState("");

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError("");
    try {
      if (refresh) await api("/api/knowledge/refresh", { method: "POST" });
      const j = await api<{ entries: AdminEntry[]; stale: typeof stale; sheetConnected?: boolean }>("/api/admin/knowledge");
      setEntries(j.entries);
      setStale(j.stale ?? []);
      setSheetConnected(Boolean(j.sheetConnected));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => [...new Set(entries.map((e) => e.category).filter(Boolean))].sort(), [entries]);
  const filtered = useMemo(() => {
    const f = q.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (!origin || e.origin === origin) &&
        (!category || e.category === category) &&
        (!f || `${e.title} ${e.content} ${e.category} ${e.keywords.join(" ")}`.toLowerCase().includes(f)),
    );
  }, [entries, q, origin, category]);
  const counts = useMemo(() => Object.fromEntries(ORIGINS.map((o) => [o, entries.filter((e) => e.origin === o).length])), [entries]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-[#0d0d0d]">登録済みナレッジ</h2>
          <p className="mt-1 text-sm text-[#5d5d5d]">
            AI がお客様に答えるときに使う情報です（Googleスプレッドシートとホームページ）。
            {sheetConnected ? "内容を変えるときはスプレッドシートを直してください（約 1 分で反映）。" : "スプレッドシートを読めていないため、保存版の内容を表示しています（「AIの学習状況・情報源」で確認）。"}
          </p>
        </div>
        <button type="button" className={btn.ghost} onClick={() => void load(true)} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          スプレッドシートを再読み込み
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setOrigin("")} className={`rounded-full px-3 py-1 text-xs transition ${origin === "" ? "bg-[#0d0d0d] text-white" : "bg-black/[0.05] text-[#3d3d3d] hover:bg-black/10"}`}>
          すべて {entries.length}
        </button>
        {ORIGINS.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setOrigin(o)}
            className={`rounded-full px-3 py-1 text-xs transition ${origin === o ? "bg-[#0d0d0d] text-white" : "bg-black/[0.05] text-[#3d3d3d] hover:bg-black/10"}`}
          >
            {ORIGIN_LABEL[o]} {counts[o] ?? 0}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8f8f8f]" />
          <input className={`${field} pl-9`} placeholder="キーワードで探す（例：ヘリ、営業時間、ダニ）" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className={`${field} w-auto`} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="分類で絞り込み">
          <option value="">すべての分類</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {stale.length ? (
        <p className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-800">
          料金がスプレッドシートと違うため、AI が使っていないホームページの項目：
          {stale.map((s) => `「${s.title}」（${s.missing.join("、")}）`).join("")}
        </p>
      ) : null}
      <ErrorNote message={error} />

      {loading && entries.length === 0 ? (
        <p className="flex items-center gap-2 py-10 text-sm text-[#8f8f8f]">
          <Loader2 className="h-4 w-4 animate-spin" />
          読み込み中…
        </p>
      ) : (
        <>
          <p className="text-xs text-[#8f8f8f]">{filtered.length} 件</p>
          <div className="space-y-2.5">
            {filtered.map((e) => (
              <EntryCard key={e.id} e={e} />
            ))}
            {filtered.length === 0 ? <p className="py-10 text-center text-sm text-[#8f8f8f]">該当するナレッジはありません</p> : null}
          </div>
        </>
      )}
    </div>
  );
}
