"use client";

// 管理画面「AIの学習状況」：AI の回答情報源（マニュアル・会社情報・ホームページ・追加分）の件数、回答テスト、
// AI の利用状況（OpenAI を使わずに答えた割合・トークン数）、学習済みの回答、答えられなかった質問
// （ナレッジの一覧・編集は「登録済みナレッジ」、追加は「情報を追加」）
import { BookOpenCheck, Database, Globe, Loader2, Pencil, RefreshCw, Search, Sparkles, Trash2, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "./ui";
import type { KnowledgeEntry, KnowledgeOrigin, KnowledgeSource, KnowledgeStats } from "@/lib/types";
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
  remoteConfigured: boolean;
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
  manual: { label: "マニュアル", tone: "green" },
  company: { label: "会社情報", tone: "blue" },
  website: { label: "ホームページ", tone: "neutral" },
  admin: { label: "管理画面で追加", tone: "amber" },
  upload: { label: "アップロード", tone: "amber" },
};

const MODE_LABEL: Record<string, { label: string; tone: "green" | "blue" | "amber" | "neutral" | "red" }> = {
  local: { label: "学習済みナレッジから回答（AI未使用）", tone: "green" },
  cache: { label: "学習済みの回答を再利用（AI未使用）", tone: "green" },
  smalltalk: { label: "定型文（AI未使用）", tone: "neutral" },
  notfound: { label: "該当なし → 担当者の折り返しを案内（AI未使用）", tone: "amber" },
  demo: { label: "デモモード（ナレッジ検索）", tone: "neutral" },
  openai: { label: "AIが回答を作成（関係するナレッジだけを参照）", tone: "blue" },
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
      <SourcesCard data={data} loading={loading} busy={busy} onRefresh={() => loadAll(true)} onRelearn={() => relearnSite(false)} onReset={() => relearnSite(true)} />
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
          <p className="px-4 pt-3 text-xs text-sumi-500">AI が一度作った回答を覚えておき、同じ質問には AI を使わずに答えます。根拠にしたナレッジが変わると自動的に使われなくなります。</p>
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
}: {
  data: KnowledgeResp | null;
  loading: boolean;
  busy: string;
  onRefresh: () => void;
  onRelearn: () => void;
  onReset: () => void;
}) {
  const s = data?.stats;
  const rows: { icon: typeof Database; title: string; detail: string; extra?: React.ReactNode }[] = data
    ? [
        {
          icon: Database,
          title: `① 顧客対応マニュアル（最優先）`,
          detail: `${data.sourceLabel}${data.sheetName ? `／シート「${data.sheetName}」` : ""}：文章 ${s?.manualText ?? 0} 件・料金表 ${s?.manualTables ?? 0} 表（社内向けの ${s?.excluded ?? 0} 行は除外）`,
          extra: data.tables.length ? (
            <span className="block text-[11px] text-sumi-400">料金表：{data.tables.map((t) => `${t.title}（${t.rows}行）`).join("・")}</span>
          ) : null,
        },
        {
          icon: BookOpenCheck,
          title: "② 会社情報（登録済み）",
          detail: `${s?.company ?? 0} 件${s?.companyStale ? `（マニュアル・ホームページと内容が合わないため ${s.companyStale} 件を停止中）` : ""}`,
          extra: data.stale.length ? (
            <span className="block text-[11px] text-amber-700">要確認：{data.stale.map((x) => `${x.title}（見つからない語：${x.missing.join("、")}）`).join(" ／ ")}</span>
          ) : null,
        },
        {
          icon: Globe,
          title: "③ ホームページ（ichijoya.co.jp）",
          detail: `${s?.website ?? 0} 件／${data.websiteFetchedAt ? `${formatJst(data.websiteFetchedAt)} に学習` : "—"}（${data.websiteOrigin === "relearned" ? "管理画面で再学習" : "同梱版"}）`,
        },
        { icon: Pencil, title: "④ 管理画面で追加・アップロード", detail: `入力 ${s?.admin ?? 0} 件・ファイルから ${s?.upload ?? 0} 件` },
      ]
    : [];
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-serif text-base font-bold text-sumi-800">AIの回答情報源</p>
          <p className="mt-1 text-xs text-sumi-500">
            AI はこの 4 つだけを根拠に回答します（食い違いはマニュアルが優先）。料金・会社情報・よくある質問は、ここから AI（OpenAI）を使わずにそのまま答えます。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            マニュアルを再読み込み
          </button>
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={onRelearn} disabled={!!busy}>
            {busy === "site" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
            ホームページから再学習
          </button>
          {data?.websiteOrigin === "relearned" ? (
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={onReset} disabled={!!busy}>
              同梱版に戻す
            </button>
          ) : null}
        </div>
      </div>
      {data?.warning ? <p className="mt-2 text-xs text-amber-700">{data.warning}</p> : null}
      <ul className="mt-4 grid gap-2 md:grid-cols-2">
        {rows.map((r) => (
          <li key={r.title} className="flex gap-3 rounded-xl border border-washi-300 bg-white px-3 py-2.5 text-sm">
            <r.icon className="mt-0.5 h-4 w-4 shrink-0 text-ai-600" />
            <span className="min-w-0">
              <span className="block font-semibold text-sumi-800">{r.title}</span>
              <span className="block text-xs text-sumi-600">{r.detail}</span>
              {r.extra}
            </span>
          </li>
        ))}
      </ul>
      {data ? (
        <p className="mt-3 text-[11px] text-sumi-400">
          最終読込 {formatJst(data.fetchedAt, true)}
          {!data.remoteConfigured
            ? "　※ マニュアルは同梱の database/manual.json を使用中です（Excel を更新したら npm run knowledge:build で作り直して再デプロイ）。GAS_WEBHOOK_URL などでスプレッドシートを接続すると、シートの更新が約1分で反映されます。"
            : ""}
        </p>
      ) : null}
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
    answer_test: "回答テスト",
  };
  return (
    <div className="card p-5">
      <p className="flex items-center gap-1.5 font-serif text-base font-bold text-sumi-800">
        <Zap className="h-4 w-4 text-ichi-green" />
        AIの利用状況
      </p>
      <p className="mt-1 text-xs text-sumi-500">料金表・会社情報・よくある質問・学習済みの回答は OpenAI を使わずに答えます。OpenAI はナレッジだけでは答えきれない質問にだけ使います。</p>
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
