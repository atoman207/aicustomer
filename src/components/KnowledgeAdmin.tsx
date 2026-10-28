"use client";

// 管理画面「AIの学習状況・情報源」：AI の回答情報源（Googleスプレッドシート・ホームページ）と接続先の設定、回答テスト、
// AI の利用状況（OpenAI を使わずに答えた割合・トークン数）、学習済みの回答、答えられなかった質問
// （情報を変えるときはスプレッドシートを直す。管理画面からの追加・アップロードはなし）
import { BookOpenCheck, Database, Globe, Link2, Loader2, PencilLine, RefreshCw, Save, Search, Sparkles, Trash2, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "./ui";
import type { KnowledgeEntry, KnowledgeOrigin, KnowledgeSource, KnowledgeStats, StaffNotes } from "@/lib/types";
import { parseSheetLink, sheetLinkLabel } from "@/lib/sheet-link";
import { formatJst, truncate } from "@/lib/utils";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j;
}

interface KnowledgeResp {
  entries: KnowledgeEntry[];
  tables: { id: string; title: string; caption: string; columns: string[]; rows: number; notes: number }[];
  source: KnowledgeSource;
  sourceLabel: string;
  sheetName?: string;
  fetchedAt: string;
  warning?: string;
  stats: KnowledgeStats;
  stale: { id: string; title: string; missing: string[] }[];
  excludedLines: string[];
  websiteFetchedAt?: string;
  websiteOrigin: "bundled" | "relearned";
  websiteUsed?: boolean;
  remoteConfigured: boolean;
  sheet?: { configured: boolean; connected: boolean; via: "gas" | "csv" | "env" | null; url: string };
  staffNotes?: StaffNotes | null;
  /** 声の AI の読み方（シートの読み方の一覧） */
  readings?: [string, string][];
}

interface Usage {
  date: string;
  usage: {
    answers: Record<"local" | "cache" | "openai" | "notfound" | "smalltalk" | "demo", number>;
    tokens: { prompt: number; completion: number; embedding: number };
    calls: Record<string, number>;
  };
}

interface Learned {
  key: string;
  question: string;
  answer: string;
  sources: { id: string; title: string }[];
  style: "text" | "voice";
  createdAt: string;
  lastUsedAt: string;
  hits: number;
}

interface Unanswered {
  key: string;
  question: string;
  count: number;
  lastAt: string;
}

const ORIGIN: Record<KnowledgeOrigin, { label: string; tone: "green" | "blue" | "amber" | "neutral" }> = {
  manual: { label: "スプレッドシート", tone: "green" },
  website: { label: "ホームページ", tone: "neutral" },
};

const MODE_LABEL: Record<string, { label: string; tone: "green" | "blue" | "amber" | "neutral" | "red" }> = {
  local: { label: "学習済みナレッジから回答（AI未使用）", tone: "green" },
  cache: { label: "学習済みの回答を再利用（AI未使用）", tone: "green" },
  smalltalk: { label: "定型文（AI未使用）", tone: "neutral" },
  notfound: { label: "該当なし → 担当者の折り返しを案内（AI未使用）", tone: "amber" },
  demo: { label: "デモモード（ナレッジ検索）", tone: "neutral" },
  openai: { label: "AIが回答を作成（スプレッドシートの全文を参照）", tone: "blue" },
};

export default function KnowledgeAdmin() {
  const [data, setData] = useState<KnowledgeResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [usage, setUsage] = useState<Usage[]>([]);
  const [learned, setLearned] = useState<Learned[]>([]);
  const [unanswered, setUnanswered] = useState<Unanswered[]>([]);

  const loadAll = useCallback(async (refresh = false) => {
    setLoading(true);
    setError("");
    try {
      const [k, u, l] = await Promise.all([
        refresh ? api<KnowledgeResp>("/api/knowledge/refresh", { method: "POST" }) : api<KnowledgeResp>("/api/knowledge"),
        api<{ days: Usage[] }>("/api/usage?days=7").catch(() => ({ days: [] })),
        api<{ learned: Learned[]; unanswered: Unanswered[] }>("/api/knowledge/learned").catch(() => ({ learned: [], unanswered: [] })),
      ]);
      setData(k);
      setUsage(u.days);
      setLearned(l.learned);
      setUnanswered(l.unanswered);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  /** 回答に使う Googleスプレッドシートの URL を保存して、すぐに読み込み直す */
  async function saveSheet(url: string): Promise<boolean> {
    setBusy("sheet");
    setError("");
    setInfo("");
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ knowledgeSheetUrl: url }) });
      const k = await api<KnowledgeResp>("/api/knowledge/refresh", { method: "POST" });
      setData(k);
      setInfo(
        !url
          ? "スプレッドシートの URL を消しました（環境変数の設定、または保存版で回答します）"
          : k.sheet?.connected
            ? "スプレッドシートを読み込みました。次の回答からこのシートの内容で答えます"
            : "URL を保存しましたが、シートを読み取れませんでした（下の注意をご確認ください）",
      );
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  }

  async function relearnSite(reset = false) {
    setBusy(reset ? "reset" : "site");
    setError("");
    setInfo("");
    try {
      const j = await api<KnowledgeResp & { pages: { path: string; label: string; entries: number; error?: string }[] }>(
        `/api/knowledge/learn-site${reset ? "?reset=1" : ""}`,
        { method: "POST" },
      );
      setData(j);
      setInfo(reset ? "ホームページの内容を同梱版に戻しました" : `ホームページを学習しました：${j.pages.map((p) => `${p.label} ${p.error ? `失敗（${p.error}）` : `${p.entries}件`}`).join("／")}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function removeLearned(key: string) {
    const j = await api<{ learned: Learned[]; unanswered: Unanswered[] }>(`/api/knowledge/learned?type=learned&key=${encodeURIComponent(key)}`, { method: "DELETE" });
    setLearned(j.learned);
  }

  async function removeUnanswered(key?: string) {
    const j = await api<{ learned: Learned[]; unanswered: Unanswered[] }>(`/api/knowledge/learned?type=unanswered${key ? `&key=${encodeURIComponent(key)}` : ""}`, { method: "DELETE" });
    setUnanswered(j.unanswered);
  }

  return (
    <div className="space-y-4">
      <SourcesCard
        data={data}
        loading={loading}
        busy={busy}
        onRefresh={() => loadAll(true)}
        onRelearn={() => relearnSite(false)}
        onReset={() => relearnSite(true)}
        onSaveSheet={saveSheet}
      />
      {error ? <p className="rounded-xl border border-shu-200 bg-shu-50 px-4 py-2 text-sm text-shu-700">{error}</p> : null}
      {info ? <p className="rounded-xl border border-tatami-200 bg-tatami-50 px-4 py-2 text-sm text-tatami-800">{info}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <AnswerTestCard onAnswered={() => loadAll(false)} />
        <UsageCard usage={usage} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-washi-200 bg-washi-100/70 px-4 py-3">
            <Sparkles className="h-4 w-4 text-ai-600" />
            <p className="text-sm font-semibold text-sumi-800">学習済みの回答</p>
            <span className="text-xs text-sumi-400">{learned.length} 件</span>
            {learned.length ? (
              <button type="button" className="ml-auto text-xs text-sumi-500 underline" onClick={() => window.confirm("学習済みの回答をすべて削除しますか？") && removeLearned("*")}>
                すべて削除
              </button>
            ) : null}
          </div>
          <p className="px-4 pt-3 text-xs text-sumi-500">AI が一度作った回答を覚えておき、同じ質問（「ですか」「？」などの言い回しの違いはそろえて照合）には AI を使わずに答えます（トークンがかかりません）。スプレッドシートの内容・回答の書き方・AI のモデルが変わると自動的に使われなくなり、30日で消えます。直したい回答は削除すると、次に聞かれたときに AI が答え直します。</p>
          <ul className="max-h-[360px] divide-y divide-washi-200 overflow-auto px-4 py-2 text-sm">
            {learned.length === 0 ? <li className="py-3 text-sumi-400">まだありません</li> : null}
            {learned.map((l) => (
              <li key={`${l.key}-${l.style}`} className="py-2">
                <div className="flex items-start gap-2">
                  <p className="flex-1 font-medium text-sumi-800">{l.question}</p>
                  <Badge>{l.style === "voice" ? "音声" : "文字"}</Badge>
                  <button type="button" className="rounded p-1 text-sumi-400 hover:bg-shu-50 hover:text-shu-600" onClick={() => removeLearned(l.key)} aria-label="削除">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-sumi-600">{truncate(l.answer, 140)}</p>
                <p className="mt-0.5 text-[11px] text-sumi-400">
                  再利用 {l.hits} 回 ／ {formatJst(l.createdAt)} 学習 ／ 根拠：{l.sources.map((s) => s.title).join("、") || "—"}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-washi-200 bg-washi-100/70 px-4 py-3">
            <BookOpenCheck className="h-4 w-4 text-amber-600" />
            <p className="text-sm font-semibold text-sumi-800">AIが答えられなかった質問</p>
            <span className="text-xs text-sumi-400">{unanswered.length} 件</span>
            {unanswered.length ? (
              <button type="button" className="ml-auto text-xs text-sumi-500 underline" onClick={() => window.confirm("一覧をすべて消しますか？") && removeUnanswered()}>
                すべて消す
              </button>
            ) : null}
          </div>
          <p className="px-4 pt-3 text-xs text-sumi-500">ナレッジに答えがなく「担当者より折り返し」を案内した質問です。顧客対応マニュアル（シート）に回答を書き足すと、次から AI が答えられます。</p>
          <ul className="max-h-[360px] divide-y divide-washi-200 overflow-auto px-4 py-2 text-sm">
            {unanswered.length === 0 ? <li className="py-3 text-sumi-400">ありません</li> : null}
            {unanswered.map((u) => (
              <li key={u.key} className="flex items-start gap-2 py-2">
                <p className="flex-1 text-sumi-800">{u.question}</p>
                <span className="whitespace-nowrap text-xs text-sumi-400">
                  {u.count} 回 ／ {formatJst(u.lastAt)}
                </span>
                <button type="button" className="rounded p-1 text-sumi-400 hover:bg-shu-50 hover:text-shu-600" onClick={() => removeUnanswered(u.key)} aria-label="消す">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

    </div>
  );
}

function SourcesCard({
  data,
  loading,
  busy,
  onRefresh,
  onRelearn,
  onReset,
  onSaveSheet,
}: {
  data: KnowledgeResp | null;
  loading: boolean;
  busy: string;
  onRefresh: () => void;
  onRelearn: () => void;
  onReset: () => void;
  onSaveSheet: (url: string) => Promise<boolean>;
}) {
  const s = data?.stats;
  const sheet = data?.sheet;
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setUrl(sheet?.url ?? "");
  }, [sheet?.url, touched]);
  const link = parseSheetLink(url);
  const status = !sheet?.configured
    ? { tone: "neutral" as const, label: "未接続（保存版で回答中）" }
    : sheet.connected
      ? { tone: "green" as const, label: "接続中" }
      : { tone: "amber" as const, label: "読み取れません（保存版で回答中）" };
  return (
    <div className="card p-5" data-sources>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-serif text-base font-bold text-sumi-800">
            AIの回答情報源：{data?.websiteUsed === false ? "Googleスプレッドシートだけ" : "Googleスプレッドシートとホームページ"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-sumi-500">
            {data?.websiteUsed === false
              ? "AI は指定のスプレッドシートの内容だけを根拠に回答します（書かれていないことは推測せず「お答えできかねます」と案内）。"
              : "AI はこの 2 つの内容だけを根拠に回答します（食い違いはスプレッドシートが優先・料金はスプレッドシートの料金表）。"}
            内容を変えるときはスプレッドシートを直してください（約 1 分で反映。「スプレッドシートを再読み込み」ですぐに反映）。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            スプレッドシートを再読み込み
          </button>
          {/* ホームページは回答に使わない（websiteUsed は常に false）。以前の版との互換のため、使う設定のときだけ表示 */}
          {data?.websiteUsed ? (
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={onRelearn} disabled={!!busy}>
              {busy === "site" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
              ホームページから再学習
            </button>
          ) : null}
          {data?.websiteUsed && data?.websiteOrigin === "relearned" ? (
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={onReset} disabled={!!busy}>
              同梱版に戻す
            </button>
          ) : null}
        </div>
      </div>

      {data ? (
        <div className="mt-4 space-y-2">
          {/* ① Googleスプレッドシート */}
          <div className="rounded-xl border border-washi-300 bg-white px-3 py-3 text-sm" data-sheet-status={sheet?.connected ? "connected" : sheet?.configured ? "error" : "none"}>
            <div className="flex flex-wrap items-center gap-2">
              <Database className="h-4 w-4 shrink-0 text-ai-600" />
              <span className="font-semibold text-sumi-800">① Googleスプレッドシート（顧客対応マニュアル）</span>
              <Badge tone={status.tone}>{status.label}</Badge>
            </div>
            <p className="mt-1 text-xs text-sumi-600">
              {data.sourceLabel}
              {data.sheetName ? `／シート「${data.sheetName}」` : ""}：文章 {s?.manualText ?? 0} 件・料金表 {s?.manualTables ?? 0} 表（社内向けの {s?.excluded ?? 0} 行は除外）
            </p>
            {data.tables.length ? <p className="mt-0.5 text-[11px] text-sumi-400">料金表：{data.tables.map((t) => `${t.title}（${t.rows}行）`).join("・")}</p> : null}
            {data.warning ? <p className="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs leading-relaxed text-amber-800">{data.warning}</p> : null}
            <form
              className="mt-3 space-y-1.5"
              onSubmit={async (e) => {
                e.preventDefault();
                if (link?.kind === "invalid") return;
                if (await onSaveSheet(url.trim())) setTouched(false);
              }}
            >
              <label className="flex items-center gap-1.5 text-xs font-semibold text-sumi-700" htmlFor="sheet-url">
                <Link2 className="h-3.5 w-3.5" />
                回答に使うスプレッドシートの URL
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="sheet-url"
                  className="input min-w-0 flex-1 font-mono text-xs"
                  placeholder="https://script.google.com/macros/s/…/exec または https://docs.google.com/spreadsheets/d/…/edit#gid=…"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setTouched(true);
                  }}
                />
                <button type="submit" className="btn-primary shrink-0 px-4 py-2 text-xs" disabled={busy === "sheet" || link?.kind === "invalid" || url.trim() === (sheet?.url ?? "")}>
                  {busy === "sheet" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  保存して読み込む
                </button>
              </div>
              {link?.kind === "invalid" ? (
                <p className="text-xs text-shu-600">{link.reason}</p>
              ) : url.trim() ? (
                <p className="text-[11px] text-sumi-500">接続方法：{sheetLinkLabel(link)}</p>
              ) : null}
              <p className="text-[11px] leading-relaxed text-sumi-400">
                {sheet?.via === "env" && !sheet.url
                  ? "現在はサービスアカウント（環境変数）でスプレッドシートを非公開のまま読み取っています。別のシート（タブ）を使うときだけ、ここに URL を貼ってください。"
                  : "スプレッドシートの URL（回答に使うタブを開いた #gid=… 付き）を貼ると、サービスアカウントで非公開のまま読み取ります（シートの「共有」にサービスアカウントを追加してください）。Apps Script・「ウェブに公開」の URL も使えます。"}
              </p>
            </form>
          </div>
          {/* ② ホームページ */}
          <div className="flex gap-3 rounded-xl border border-washi-300 bg-white px-3 py-2.5 text-sm">
            <Globe className="mt-0.5 h-4 w-4 shrink-0 text-ai-600" />
            <span className="min-w-0">
              <span className="block font-semibold text-sumi-800">② ホームページ（ichijoya.co.jp）</span>
              {data.websiteUsed === false ? (
                <span className="block text-xs text-sumi-600">
                  回答には使いません（回答の根拠は指定のスプレッドシートだけ。一畳屋様のご要望）。
                </span>
              ) : (
                <span className="block text-xs text-sumi-600">
                  {s?.website ?? 0} 件／{data.websiteFetchedAt ? `${formatJst(data.websiteFetchedAt)} に学習` : "—"}（{data.websiteOrigin === "relearned" ? "管理画面で再学習" : "同梱版"}）
                </span>
              )}
              {data.stale.length ? (
                <span className="mt-0.5 block text-[11px] text-amber-700">
                  料金がスプレッドシートと違うため使っていないページ：{data.stale.map((x) => `${x.title}（${x.missing.join("、")}）`).join(" ／ ")}
                </span>
              ) : null}
            </span>
          </div>
          {/* ③ スタッフからの修正点・要望（「修正点など」のタブ） */}
          {data.staffNotes ? (
            <div className="rounded-xl border border-washi-300 bg-white px-3 py-3 text-sm" data-staff-notes={data.staffNotes.error && !data.staffNotes.text ? "error" : "ok"}>
              <div className="flex flex-wrap items-center gap-2">
                <PencilLine className="h-4 w-4 shrink-0 text-ai-600" />
                <span className="font-semibold text-sumi-800">③ スタッフからの修正点・要望（シート「{data.staffNotes.tab}」）</span>
                <Badge tone={data.staffNotes.text ? "green" : "amber"}>{data.staffNotes.text ? `${data.staffNotes.lines} 件をAIに反映中` : "未反映"}</Badge>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-sumi-600">
                このタブに書いた修正点・要望は、文字・声・電話のAIの指示に入ります（書き足すと約1分で反映。1行に1項目、下が新しいもの）。料金などの事実は、これまでどおり①のシートだけが根拠です。
              </p>
              {data.staffNotes.text ? (
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-washi-50 px-2.5 py-2 font-sans text-xs leading-relaxed text-sumi-700">{data.staffNotes.text}</pre>
              ) : null}
              {data.staffNotes.truncated ? <p className="mt-1 text-[11px] text-amber-700">長いため、古い項目（上の行）の一部は省いています。</p> : null}
              {data.staffNotes.error ? <p className="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs leading-relaxed text-amber-800">{data.staffNotes.error}</p> : null}
            </div>
          ) : null}
          {/* 声のAIの読み方（シートの「畳床（たたみどこ）　七島（しっとう）…」の行） */}
          <div className="rounded-xl border border-washi-300 bg-white px-3 py-3 text-sm" data-readings={data.readings?.length ?? 0}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-sumi-800">声のAIの読み方（シートの読み方の一覧）</span>
              <Badge tone={data.readings?.length ? "green" : "amber"}>{data.readings?.length ? `${data.readings.length} 語を反映中` : "なし"}</Badge>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-sumi-600">
              シートに「畳床（たたみどこ）　七島（しっとう）」のように「言葉（よみ）」を1行に4つ以上並べると、声のAIはその言葉をこの読みで話します（約1分で反映。1文字の言葉は使いません）。「見積り」「承る」「畳床」「戸車」「表替え」などは、最初から正しい読みで話します。
            </p>
            {data.readings?.length ? <p className="mt-2 rounded-lg bg-washi-50 px-2.5 py-2 text-xs leading-relaxed text-sumi-700">{data.readings.map(([w, k]) => `${w}（${k}）`).join("　")}</p> : null}
          </div>
        </div>
      ) : null}
      {data ? <p className="mt-3 text-[11px] text-sumi-400">最終読込 {formatJst(data.fetchedAt, true)}</p> : null}
    </div>
  );
}

function AnswerTestCard({ onAnswered }: { onAnswered: () => void }) {
  const [q, setQ] = useState("");
  const [style, setStyle] = useState<"text" | "voice">("text");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ mode: string; kind: string; reply: string; sources: { id: string; title: string; origin?: string }[]; contextChars: number } | null>(null);
  const [error, setError] = useState("");

  async function run() {
    if (!q.trim()) return;
    setTesting(true);
    setError("");
    try {
      const j = await api<NonNullable<typeof result>>("/api/knowledge/answer", { method: "POST", body: JSON.stringify({ question: q, style }) });
      setResult(j);
      onAnswered();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(false);
    }
  }

  const m = result ? (MODE_LABEL[result.mode] ?? MODE_LABEL.demo) : null;
  return (
    <div className="card p-5">
      <p className="flex items-center gap-1.5 font-serif text-base font-bold text-sumi-800">
        <Search className="h-4 w-4 text-ai-600" />
        回答テスト
      </p>
      <p className="mt-1 text-xs text-sumi-500">3窓口と同じ回答エンジンで答えます。AI を使ったかどうかと、根拠にしたナレッジを確認できます。</p>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <input className="input min-w-0 flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="例：朱雀の襖の両面はいくら？" />
        <select className="input w-24" value={style} onChange={(e) => setStyle(e.target.value as "text" | "voice")}>
          <option value="text">文字</option>
          <option value="voice">音声</option>
        </select>
        <button type="submit" className="btn-primary px-4" disabled={testing || !q.trim()}>
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          回答
        </button>
      </form>
      {error ? <p className="mt-2 text-sm text-shu-600">{error}</p> : null}
      {result && m ? (
        <div className="mt-3 space-y-2">
          <Badge tone={m.tone}>
            {result.mode === "local" || result.mode === "cache" ? <Zap className="mr-1 inline h-3 w-3" /> : null}
            {m.label}
          </Badge>
          {result.mode === "openai" ? <p className="text-[11px] text-sumi-400">AI に渡した参考情報：約 {result.contextChars.toLocaleString()} 字（ナレッジ全体ではなく関係する部分だけ）</p> : null}
          <p className="whitespace-pre-wrap rounded-xl bg-washi-50 px-3 py-2 text-sm leading-relaxed text-sumi-800">{result.reply}</p>
          {result.sources.length ? (
            <div className="flex flex-wrap gap-1">
              {result.sources.map((s) => (
                <span key={s.id} className="chip">
                  {s.origin ? `${ORIGIN[s.origin as KnowledgeOrigin]?.label ?? ""}｜` : ""}
                  {truncate(s.title, 30)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function UsageCard({ usage }: { usage: Usage[] }) {
  const sum = (pick: (u: Usage["usage"]) => number, days = usage) => days.reduce((n, d) => n + pick(d.usage), 0);
  const today = usage[0]?.date === new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date()) ? [usage[0]] : [];
  const block = (days: Usage[], label: string) => {
    const local = sum((u) => u.answers.local + u.answers.cache + u.answers.smalltalk + u.answers.notfound, days);
    const ai = sum((u) => u.answers.openai, days);
    const total = local + ai + sum((u) => u.answers.demo, days);
    const pct = total ? Math.round((local / total) * 100) : 0;
    const tokens = sum((u) => u.tokens.prompt + u.tokens.completion, days);
    const emb = sum((u) => u.tokens.embedding, days);
    return (
      <div className="rounded-xl border border-washi-300 bg-white px-3 py-2.5">
        <p className="text-xs font-semibold text-sumi-500">{label}</p>
        <p className="mt-1 text-2xl font-bold text-ichi-theme">
          {pct}
          <span className="text-sm font-semibold">%</span>
          <span className="ml-1 text-xs font-normal text-sumi-500">を AI なしで回答</span>
        </p>
        <p className="text-xs text-sumi-600">
          回答 {total} 件（ナレッジから {local}・AI {ai}）
        </p>
        <p className="text-xs text-sumi-600">OpenAI トークン：{tokens.toLocaleString()}（検索用 {emb.toLocaleString()}）</p>
      </div>
    );
  };
  const calls = usage.reduce<Record<string, number>>((acc, d) => {
    for (const [k, v] of Object.entries(d.usage.calls)) acc[k] = (acc[k] ?? 0) + v;
    return acc;
  }, {});
  const PURPOSE: Record<string, string> = {
    chat: "文字相談の回答",
    agent: "電話・LINEの受付",
    summarize: "相談内容の要約",
    embedding: "意味の近さの検索",
    tts: "音声合成",
    realtime_session: "音声相談の接続",
    voice_answer: "音声相談の回答（資料から）",
    answer_test: "回答テスト",
  };
  return (
    <div className="card p-5">
      <p className="flex items-center gap-1.5 font-serif text-base font-bold text-sumi-800">
        <Zap className="h-4 w-4 text-ichi-green" />
        AIの利用状況
      </p>
      <p className="mt-1 text-xs text-sumi-500">あいさつと、学習済みの回答（前と同じ質問）は OpenAI を使わずに答えます（トークンがかかりません）。それ以外は、AI がスプレッドシートの全文を読んで答えます。</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {block(today, "今日")}
        {block(usage, `直近 ${usage.length || 0} 日`)}
      </div>
      {Object.keys(calls).length ? (
        <p className="mt-2 text-[11px] text-sumi-400">
          OpenAI の呼び出し：{Object.entries(calls).map(([k, v]) => `${PURPOSE[k] ?? k} ${v}回`).join("・")}
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-sumi-400">まだ記録がありません</p>
      )}
      <p className="mt-1 text-[11px] text-sumi-400">※ 声の相談（Realtime API）の音声トークンは OpenAI の管理画面でご確認ください（ナレッジ全文を渡さない設定で節約しています）。</p>
    </div>
  );
}
