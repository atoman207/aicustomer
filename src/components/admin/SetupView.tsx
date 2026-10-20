"use client";

// 管理画面「セットアップ」：Supabase のテーブルを作る SQL（コピーして SQL Editor で 1 回実行）と接続確認
import { CheckCircle2, Copy, ExternalLink, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, btn, ErrorNote, type SetupInfo } from "./shared";

export function SetupView({ onReady }: { onReady: () => void }) {
  const [info, setInfo] = useState<SetupInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  const load = useCallback(async () => {
    try {
      setInfo(await api<SetupInfo>("/api/admin/setup"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function check() {
    setBusy(true);
    setError("");
    setResult("");
    try {
      const j = await api<SetupInfo>("/api/admin/setup", { method: "POST" });
      setInfo(j);
      if (j.supabase.ready) {
        setResult(`接続できました。ナレッジ ${j.entries ?? 0} 件を AI の回答に使っています${j.sync?.synced ? `（同梱データ ${j.sync.upserted} 件を取り込み）` : ""}。`);
        onReady();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // クリップボードが使えない場合は手で選択
    }
  }

  const sb = info?.supabase;
  const Step = ({ n, ok, title, children }: { n: number; ok?: boolean; title: string; children?: React.ReactNode }) => (
    <div className="flex gap-3">
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-semibold ${ok ? "bg-emerald-600 text-white" : "bg-black/[0.07] text-[#3d3d3d]"}`}>
        {ok ? <CheckCircle2 className="h-4 w-4" /> : n}
      </span>
      <div className="min-w-0 flex-1 pb-5">
        <p className="text-[15px] font-medium text-[#0d0d0d]">{title}</p>
        <div className="mt-1 space-y-2 text-sm leading-relaxed text-[#5d5d5d]">{children}</div>
      </div>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <div>
        <h2 className="text-xl font-semibold text-[#0d0d0d]">Supabase のセットアップ</h2>
        <p className="mt-1 text-sm text-[#5d5d5d]">AI が使う情報・アップロードしたファイル・会話履歴・受付を Supabase のデータベースに保存します。最初に 1 回だけ設定してください。</p>
      </div>
      <div className="flex items-center gap-2 rounded-2xl border border-black/[0.08] px-4 py-3 text-sm">
        {sb?.ready ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <XCircle className="h-5 w-5 text-amber-600" />}
        <span className="text-[#0d0d0d]">{!sb ? "確認中…" : sb.ready ? `接続済み（プロジェクト ${info?.projectRef}）` : sb.configured ? (sb.error ?? "未接続") : "SUPABASE_URL・SUPABASE_SECRET_KEY が未設定です"}</span>
      </div>

      <div className="pt-2">
        <Step n={1} ok={sb?.configured} title="環境変数を設定する">
          <p>
            <code className="rounded bg-black/[0.05] px-1">SUPABASE_URL</code> と <code className="rounded bg-black/[0.05] px-1">SUPABASE_SECRET_KEY</code>（Supabase の Project Settings › API Keys の secret キー）を
            .env と Vercel の Environment Variables に設定し、再起動（Vercel は Redeploy）します。
          </p>
        </Step>
        <Step n={2} ok={sb?.ready} title="テーブルを作る（SQL を 1 回実行）">
          <p>下の SQL をコピーし、Supabase の SQL Editor に貼り付けて「Run」を押してください。何度実行しても安全です。</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn.primary} onClick={copy} disabled={!info}>
              {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "コピーしました" : "SQL をコピー"}
            </button>
            {info ? (
              <a href={info.sqlEditorUrl} target="_blank" rel="noreferrer" className={btn.ghost}>
                <ExternalLink className="h-4 w-4" />
                SQL Editor を開く
              </a>
            ) : null}
          </div>
          <pre className="max-h-[320px] overflow-auto rounded-xl bg-[#0d0d0d] p-4 text-[12px] leading-relaxed text-white/90">{info?.sql ?? "読み込み中…"}</pre>
        </Step>
        <Step n={3} ok={sb?.ready && Boolean(result)} title="接続を確認する">
          <p>実行したら「接続を確認」を押してください。顧客対応マニュアル・会社情報・ホームページの情報が自動でデータベースに取り込まれます。</p>
          <button type="button" className={btn.primary} onClick={check} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            接続を確認
          </button>
          {result ? <p className="rounded-xl bg-emerald-50 px-4 py-2.5 text-emerald-700">{result}</p> : null}
          {info && sb?.ready ? (
            <p>
              保存された内容は Supabase の{" "}
              <a className="underline" href={info.tableEditorUrl} target="_blank" rel="noreferrer">
                Table Editor
              </a>{" "}
              でも確認できます（knowledge・knowledge_sources・conversations・estimates・app_kv）。
            </p>
          ) : null}
        </Step>
      </div>
      <ErrorNote message={error} />
    </div>
  );
}
