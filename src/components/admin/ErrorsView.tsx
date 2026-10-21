"use client";

// エラー履歴：OpenAI・音声・LINE・スプレッドシートなどのエラーを 1 か所で確認する
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, btn, Chip, ErrorNote, formatDate } from "./shared";
import { ERROR_SOURCE_LABEL, type ErrorLogItem } from "@/lib/errorlog-types";

export function ErrorsView() {
  const [items, setItems] = useState<ErrorLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const j = await api<{ errors: ErrorLogItem[] }>("/api/admin/errors");
      setItems(j.errors ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function clear() {
    if (!window.confirm("エラー履歴をすべて消しますか？（確認が済んだものだけを消してください）")) return;
    try {
      await api("/api/admin/errors", { method: "DELETE" });
      setItems([]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 sm:px-6" data-errors={items.length}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="w-full text-sm leading-relaxed text-[#5d5d5d] sm:w-auto sm:min-w-0 sm:flex-1">
          AI の回答・声の相談の接続・LINE・スプレッドシートの読み取りと受付の記録で起きたエラーを新しい順に表示します（最大 200 件。同じエラーが続いたときは回数をまとめて表示）。
        </p>
        <button type="button" className={btn.ghost} onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          更新
        </button>
        {items.length ? (
          <button type="button" className={btn.ghost} onClick={() => void clear()}>
            <Trash2 className="h-4 w-4" />
            すべて消す
          </button>
        ) : null}
      </div>
      <ErrorNote message={error} />
      {loading && !items.length ? (
        <p className="flex items-center gap-2 py-10 text-sm text-[#8f8f8f]">
          <Loader2 className="h-4 w-4 animate-spin" />
          読み込み中…
        </p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-black/[0.06] bg-[#f9f9f9] px-6 py-12 text-center">
          <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-600" />
          <p className="mt-3 text-sm font-semibold">エラーはありません</p>
          <p className="mt-1 text-xs text-[#8f8f8f]">問題が起きると、ここに内容と日時が表示されます。</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={`${it.at}-${i}`} className="rounded-2xl border border-black/[0.06] bg-white px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <Chip tone={it.source === "browser" || it.source === "realtime" ? "amber" : "red"}>{ERROR_SOURCE_LABEL[it.source] ?? it.source}</Chip>
                <span className="font-semibold text-[#0d0d0d]">{it.where}</span>
                <span className="ml-auto text-[#8f8f8f]">
                  {formatDate(it.at)}
                  {it.count && it.count > 1 ? `（${it.count} 回）` : ""}
                </span>
              </div>
              <p className="mt-1.5 break-words font-mono text-[12px] leading-relaxed text-[#3d3d3d]">{it.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
