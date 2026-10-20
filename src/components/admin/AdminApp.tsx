"use client";

// 管理画面の外枠（ChatGPT のようなシンプルな画面：左にメニューと追加の履歴、上にヘッダー、中央に内容）
import {
  BarChart3,
  ClipboardList,
  Database,
  ExternalLink,
  FileText,
  Library,
  LogOut,
  Menu,
  MessageCircleQuestion,
  MessagesSquare,
  Pencil,
  PhoneCall,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ConversationsTab, PhoneSettingsTab, ReceptionsTab, StatusTab } from "../AdminDashboard";
import KnowledgeAdmin from "../KnowledgeAdmin";
import { AddView } from "./AddView";
import { KnowledgeListView, SourceView } from "./KnowledgeViews";
import { SetupView } from "./SetupView";
import { api, Chip, formatDate, type Source } from "./shared";
import { TestChatView } from "./TestChatView";
import type { AppSettings, IntegrationStatus } from "@/lib/types";

type View = "add" | "knowledge" | "test" | "receptions" | "conversations" | "ai" | "phone" | "status" | "setup" | `source:${string}`;

const NAV: { view: View; label: string; icon: typeof Library }[] = [
  { view: "knowledge", label: "登録済みナレッジ", icon: Library },
  { view: "test", label: "AIに質問（テスト）", icon: MessageCircleQuestion },
  { view: "receptions", label: "受付一覧", icon: ClipboardList },
  { view: "conversations", label: "会話履歴", icon: MessagesSquare },
  { view: "ai", label: "AIの学習状況", icon: BarChart3 },
  { view: "phone", label: "電話・営業時間", icon: PhoneCall },
  { view: "status", label: "接続状況", icon: ShieldCheck },
  { view: "setup", label: "セットアップ", icon: Database },
];

const TITLES: Record<string, string> = {
  add: "情報を追加",
  knowledge: "登録済みナレッジ",
  test: "AIに質問（テスト）",
  receptions: "受付一覧",
  conversations: "会話履歴",
  ai: "AIの学習状況",
  phone: "電話・営業時間",
  status: "接続状況",
  setup: "セットアップ",
  source: "追加した情報",
};

function parseView(v: string | undefined): View {
  if (!v) return "add";
  if (v.startsWith("source:")) return v as View;
  return (Object.keys(TITLES).includes(v) && v !== "source" ? v : "add") as View;
}

export default function AdminApp({
  initialStatus,
  initialSettings,
  protectedMode,
  initialView,
}: {
  initialStatus: IntegrationStatus;
  initialSettings: AppSettings;
  protectedMode: boolean;
  initialView?: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>(() => parseView(initialView ?? (initialStatus.supabase.ready ? "add" : initialStatus.supabase.configured ? "setup" : "add")));
  const [ready, setReady] = useState(initialStatus.supabase.ready);
  const [sources, setSources] = useState<Source[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  const go = useCallback((v: View) => {
    setView(v);
    setMenuOpen(false);
    const url = new URL(window.location.href);
    if (v === "add") url.searchParams.delete("view");
    else url.searchParams.set("view", v);
    window.history.replaceState(null, "", url.toString());
  }, []);

  const loadSources = useCallback(async () => {
    try {
      const j = await api<{ sources: Source[] }>("/api/admin/sources");
      setSources(j.sources);
    } catch {
      setSources([]);
    }
  }, []);

  useEffect(() => {
    if (ready) void loadSources();
  }, [ready, loadSources]);

  const onSetupRequired = useCallback(() => setReady(false), []);

  async function logout() {
    await fetch("/api/admin/login", { method: "DELETE" });
    router.push("/admin/login");
    router.refresh();
  }

  const key = view.startsWith("source:") ? "source" : view;
  const sb = initialStatus.supabase;

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 px-3">
        <Link href="/" className="shrink-0 rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-black/20" aria-label="トップページへ">
          <img src="/ichijoya/logo-symbol.svg" alt="一畳屋" className="h-7 w-7" />
        </Link>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold text-[#0d0d0d]">一畳屋 AI 管理画面</p>
          <p className="text-[11px] text-[#8f8f8f]">スタッフ専用</p>
        </div>
        <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-[#5d5d5d] hover:bg-black/[0.06] lg:hidden" onClick={() => setMenuOpen(false)} aria-label="メニューを閉じる">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="px-2">
        <button
          type="button"
          onClick={() => go("add")}
          className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[14px] font-medium transition ${key === "add" ? "bg-black/[0.08] text-[#0d0d0d]" : "text-[#0d0d0d] hover:bg-black/[0.05]"}`}
        >
          <span className="grid h-6 w-6 place-items-center rounded-full bg-[#0d0d0d] text-white">
            <Plus className="h-3.5 w-3.5" />
          </span>
          情報を追加
        </button>
      </div>
      <nav className="mt-2 space-y-0.5 px-2" aria-label="管理メニュー">
        {NAV.map(({ view: v, label, icon: Icon }) => (
          <button
            key={v}
            type="button"
            onClick={() => go(v)}
            className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[14px] transition ${key === v ? "bg-black/[0.08] font-medium text-[#0d0d0d]" : "text-[#3d3d3d] hover:bg-black/[0.05]"}`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">{label}</span>
            {v === "setup" && !ready ? <span className="h-2 w-2 rounded-full bg-amber-500" aria-label="未完了" /> : null}
          </button>
        ))}
      </nav>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-2">
        <p className="px-3 pb-1 text-[11px] font-medium text-[#8f8f8f]">追加した情報</p>
        {!ready ? <p className="px-3 py-1 text-xs text-[#8f8f8f]">セットアップ後に表示されます</p> : null}
        {ready && sources.length === 0 ? <p className="px-3 py-1 text-xs text-[#8f8f8f]">まだありません</p> : null}
        <ul className="space-y-0.5 pb-3">
          {sources.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => go(`source:${s.id}`)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] transition ${view === `source:${s.id}` ? "bg-black/[0.08] text-[#0d0d0d]" : "text-[#3d3d3d] hover:bg-black/[0.05]"}`}
                title={`${s.name}（${formatDate(s.created_at)}）`}
              >
                {s.kind === "file" ? <FileText className="h-3.5 w-3.5 shrink-0 text-[#8f8f8f]" /> : <Pencil className="h-3.5 w-3.5 shrink-0 text-[#8f8f8f]" />}
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                {s.status === "error" ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" /> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-0.5 border-t border-black/[0.06] p-2">
        <a href="/" target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-[#3d3d3d] hover:bg-black/[0.05]">
          <ExternalLink className="h-4 w-4" />
          お客様向けのサイトを見る
        </a>
        {protectedMode ? (
          <button type="button" onClick={logout} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-[#3d3d3d] hover:bg-black/[0.05]">
            <LogOut className="h-4 w-4" />
            ログアウト
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-white leading-normal text-[#0d0d0d]">
      <aside className="hidden w-[264px] shrink-0 border-r border-black/[0.06] bg-[#f9f9f9] lg:block">{sidebar}</aside>
      {menuOpen ? (
        <div className="fixed inset-0 z-[200] lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] bg-[#f9f9f9] shadow-2xl">{sidebar}</aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-black/[0.06] bg-white px-3 sm:px-4">
          <button type="button" className="grid h-9 w-9 place-items-center rounded-lg text-[#3d3d3d] hover:bg-black/[0.05] lg:hidden" onClick={() => setMenuOpen(true)} aria-label="メニューを開く">
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{TITLES[key]}</h1>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => go(ready ? "status" : "setup")} className="hidden sm:block" title="接続状況">
              <Chip tone={ready ? "green" : "amber"}>{ready ? "Supabase 接続中" : sb.configured ? "Supabase 要セットアップ" : "Supabase 未設定"}</Chip>
            </button>
            <Chip tone={initialStatus.openai.configured ? "green" : "amber"}>{initialStatus.openai.configured ? "OpenAI 接続中" : "デモモード"}</Chip>
            {protectedMode ? (
              <button type="button" onClick={logout} className="hidden h-8 items-center gap-1 rounded-full px-3 text-xs text-[#5d5d5d] hover:bg-black/[0.05] sm:flex">
                <LogOut className="h-3.5 w-3.5" />
                ログアウト
              </button>
            ) : (
              <Chip tone="red">パスワード未設定</Chip>
            )}
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto" data-view={key}>
          {key === "add" ? (
            ready ? (
              <AddView
                ready={ready}
                onSetupRequired={onSetupRequired}
                onSaved={(s) => setSources((list) => [s, ...list.filter((x) => x.id !== s.id)])}
              />
            ) : (
              <div className="mx-auto max-w-2xl px-6 py-16 text-center">
                <Database className="mx-auto h-10 w-10 text-[#8f8f8f]" />
                <h2 className="mt-4 text-xl font-semibold">はじめに Supabase のセットアップをしてください</h2>
                <p className="mt-2 text-sm leading-relaxed text-[#5d5d5d]">追加した情報・アップロードしたファイル・会話履歴はすべて Supabase のデータベースに保存します。テーブルを作る SQL を 1 回実行すると使えるようになります。</p>
                <button type="button" onClick={() => go("setup")} className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-[#0d0d0d] px-5 py-2.5 text-sm font-medium text-white hover:bg-black/80">
                  セットアップへ
                </button>
              </div>
            )
          ) : null}
          {key === "knowledge" ? <KnowledgeListView onSetupRequired={() => go("setup")} /> : null}
          {key === "source" ? (
            <SourceView
              id={view.slice("source:".length)}
              onSetupRequired={() => go("setup")}
              onDeleted={() => {
                void loadSources();
                go("knowledge");
              }}
            />
          ) : null}
          {key === "test" ? <TestChatView /> : null}
          {key === "setup" ? (
            <SetupView
              onReady={() => {
                setReady(true);
                void loadSources();
              }}
            />
          ) : null}
          {["receptions", "conversations", "ai", "phone", "status"].includes(key) ? (
            <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
              {key === "receptions" ? <ReceptionsTab storage={initialStatus.storage} /> : null}
              {key === "conversations" ? <ConversationsTab /> : null}
              {key === "ai" ? <KnowledgeAdmin /> : null}
              {key === "phone" ? <PhoneSettingsTab initialSettings={initialSettings} /> : null}
              {key === "status" ? <StatusTab initialStatus={initialStatus} /> : null}
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
