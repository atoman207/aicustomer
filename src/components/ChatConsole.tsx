"use client";

import { BookOpenCheck, ChevronRight, ClipboardCheck, Clock3, Loader2, Mic, Send, UserRound, Zap } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import EstimateForm from "./EstimateForm";
import { PhoneCompact } from "./PhoneButton";
import { DemoNotice, Modal, ModeBadge } from "./ui";
import { BUSINESS } from "@/lib/company";
import type { ChatMessage, EstimateRequest } from "@/lib/types";
import { uid } from "@/lib/utils";

/** AI の顔：一畳屋のロゴマーク */
function AiAvatar({ size = "h-9 w-9" }: { size?: string }) {
  return (
    <span className={`grid ${size} shrink-0 place-items-center rounded-full border-2 border-ichi-green bg-white`}>
      <img src="/ichijoya/logo-symbol.svg" alt="" className="w-[62%]" />
    </span>
  );
}

interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: { title: string; category: string; origin?: string }[];
  mode?: string;
  kind?: string;
  pending?: boolean;
}

// お客様に見せる参照元の呼び名（社内向けの「マニュアル」などの言い方は出さない）
const ORIGIN_SHORT: Record<string, string> = { manual: "サービス案内", company: "会社案内", website: "公式サイト", admin: "最新のご案内" };

/** OpenAI を使わずに答えた回答の表示（お客様には「公式情報から」。スタッフ向けの詳細はツールチップ） */
function answeredLocally(mode?: string): { label: string; detail: string } | null {
  if (mode === "local") return { label: "一畳屋の公式情報から回答", detail: "学習済みナレッジから回答（AI未使用）" };
  if (mode === "cache") return { label: "一畳屋の公式情報から回答", detail: "学習済みの回答を再利用（AI未使用）" };
  return null;
}

const SUGGESTIONS = [
  "6畳の畳の表替えはいくらですか？",
  "畳の表替えは何日かかりますか？",
  "土日に工事をお願いできますか？",
  "お店に行って見本を見られますか？",
  "猫がいても破れにくい障子紙はありますか？",
  "水まわりのリフォームもできますか？",
  "対応エリアを教えてください",
];

export default function ChatConsole({
  mode,
  company,
  lineUrl,
  knowledgeLabel,
}: {
  mode: "openai" | "demo";
  company: string;
  lineUrl: string;
  knowledgeLabel: string;
}) {
  const [sessionId] = useState(() => uid());
  const [messages, setMessages] = useState<UiMessage[]>([
    {
      id: "greeting",
      role: "assistant",
      content: `こんにちは。畳の${company}のAI相談員です。\n畳・襖・障子・網戸から住まいのリフォームまで、お気軽にご質問ください。料金の目安や工期、対応エリア、営業日などにお答えします。\nお見積り（無料）をご希望の際は、「無料お見積りを依頼」ボタンからお進みください。`,
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastMode, setLastMode] = useState<string>(mode);
  const [estimateOpen, setEstimateOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [lastEstimate, setLastEstimate] = useState<EstimateRequest | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const toHistory = (list: UiMessage[]): ChatMessage[] =>
    list.filter((m) => !m.pending && m.content.trim()).map((m) => ({ role: m.role, content: m.content }));

  const send = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t || busy) return;
      setInput("");
      const userMsg: UiMessage = { id: uid(), role: "user", content: t };
      const pendingId = uid();
      const history = toHistory([...messages, userMsg]);
      setMessages((prev) => [...prev, userMsg, { id: pendingId, role: "assistant", content: "", pending: true }]);
      setBusy(true);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 70_000);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, channel: "web_text", messages: history }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${res.status}`);
        }
        const m = res.headers.get("X-Mode") ?? "openai";
        const kind = res.headers.get("X-Answer-Kind") ?? "";
        setLastMode(m);
        let sources: { title: string; category: string; origin?: string }[] = [];
        try {
          sources = JSON.parse(decodeURIComponent(res.headers.get("X-Sources") ?? "%5B%5D")) as typeof sources;
        } catch {
          sources = [];
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          const snapshot = acc;
          setMessages((prev) => prev.map((x) => (x.id === pendingId ? { ...x, content: snapshot } : x)));
        }
        setMessages((prev) =>
          prev.map((x) =>
            x.id === pendingId ? { ...x, content: acc || "（応答がありませんでした）", pending: false, sources, mode: m, kind } : x,
          ),
        );
      } catch (e) {
        const reason = (e as Error).name === "AbortError" ? "応答がタイムアウトしました" : (e as Error).message;
        setMessages((prev) =>
          prev.map((x) =>
            x.id === pendingId
              ? {
                  ...x,
                  content: `申し訳ありません、通信エラーが発生しました（${reason}）。時間をおいて再度お試しください。`,
                  pending: false,
                  mode: "error",
                }
              : x,
          ),
        );
      } finally {
        clearTimeout(timer);
        setBusy(false);
        textareaRef.current?.focus();
      }
    },
    [busy, messages, sessionId],
  );

  // トップページの「こんなことが聞けます」から来た場合（/chat?q=...）はそのまま質問する
  const autoAsked = useRef(false);
  useEffect(() => {
    if (autoAsked.current) return;
    const q = new URLSearchParams(window.location.search).get("q")?.trim();
    if (!q) return;
    autoAsked.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    void send(q.slice(0, 300));
  }, [send]);

  async function openEstimate() {
    setEstimateOpen(true);
    setSummaryLoading(true);
    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: toHistory(messages) }),
      });
      const j = (await res.json()) as { ok: boolean; summary?: string };
      if (j.ok) setSummary(j.summary ?? "");
    } catch {
      // 要約失敗時は空のまま（お客様が入力）
    } finally {
      setSummaryLoading(false);
    }
  }

  function onSubmitted(est: EstimateRequest) {
    setLastEstimate(est);
    setMessages((prev) => [
      ...prev,
      {
        id: uid(),
        role: "assistant",
        content: `見積依頼を受付しました（受付番号：${est.id}）。\n担当者より折り返しご連絡し、訪問日程を確定いたします。ありがとうございました。`,
      },
    ]);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <section className="card flex h-[70vh] min-h-[520px] flex-col overflow-hidden" data-busy={busy ? "true" : "false"}>
        <header className="flex flex-wrap items-center justify-between gap-2 bg-ptn-logo px-4 py-3 text-white">
          <div className="flex items-center gap-2.5">
            <AiAvatar />
            <div className="leading-tight">
              <p className="font-hand text-base">一畳屋 AI相談員</p>
              <p className="text-[11px] text-white/75" title={`回答の根拠：${knowledgeLabel}`}>
                一畳屋の料金表・会社案内をもとにお答えします
              </p>
            </div>
          </div>
          <ModeBadge mode={mode === "openai" && lastMode !== "demo-error" ? "openai" : "demo"} />
        </header>

        <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.map((m) => (
            <div key={m.id} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              {m.role === "user" ? (
                <span className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sumi-100 text-sumi-600">
                  <UserRound className="h-4 w-4" />
                </span>
              ) : (
                <span className="mt-1">
                  <AiAvatar />
                </span>
              )}
              <div className={`max-w-[85%] ${m.role === "user" ? "text-right" : ""}`}>
                <div
                  data-role={m.role}
                  className={`bubble inline-block rounded-2xl px-4 py-3 text-left text-sm leading-relaxed shadow-sm ${
                    m.role === "user" ? "rounded-tr-sm bg-ai-600 text-white" : "bubble-washi rounded-tl-sm border border-washi-200 text-sumi-800"
                  }`}
                >
                  {m.pending && !m.content ? (
                    <span className="flex items-center gap-1 text-sumi-400">
                      <span className="h-1.5 w-1.5 animate-blink rounded-full bg-sumi-400" />
                      <span className="h-1.5 w-1.5 animate-blink rounded-full bg-sumi-400 [animation-delay:0.2s]" />
                      <span className="h-1.5 w-1.5 animate-blink rounded-full bg-sumi-400 [animation-delay:0.4s]" />
                    </span>
                  ) : (
                    m.content
                  )}
                </div>
                {answeredLocally(m.mode) || (m.sources && m.sources.length > 0) ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {answeredLocally(m.mode) ? (
                      <span className="chip border-ichi-green bg-ichi-cream text-ichi-theme" data-answer={m.mode} title={answeredLocally(m.mode)?.detail}>
                        <Zap className="h-3 w-3" />
                        {answeredLocally(m.mode)?.label}
                      </span>
                    ) : null}
                    {(m.sources ?? []).slice(0, 3).map((s) => (
                      <span key={s.title} className="chip">
                        <BookOpenCheck className="h-3 w-3" />
                        参照：{s.origin && ORIGIN_SHORT[s.origin] ? `${ORIGIN_SHORT[s.origin]}｜` : ""}
                        {s.title.replace(/^.*｜/, "")}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {messages.length <= 2 ? (
          <div className="flex gap-2 overflow-x-auto border-t border-washi-200 px-4 py-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="chip shrink-0 hover:border-ai-300 hover:bg-ai-50" onClick={() => send(s)} disabled={busy}>
                {s}
              </button>
            ))}
          </div>
        ) : null}

        <form
          className="flex items-end gap-2 border-t border-washi-200 bg-white/70 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <textarea
            ref={textareaRef}
            className="input max-h-32 min-h-[44px] flex-1 resize-none"
            rows={1}
            value={input}
            placeholder="ご質問を入力（Enterで送信 / Shift+Enterで改行）"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            aria-busy={busy}
          />
          <button type="submit" className="btn-primary h-[44px] px-4" disabled={busy || !input.trim()} aria-label="送信">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      </section>

      <aside className="space-y-4">
        <div className="card p-4">
          <p className="font-serif text-base font-bold text-sumi-800">お見積りのご依頼（無料）</p>
          <p className="mt-1 text-xs text-sumi-500">
            担当者が現地を見てからお見積りを提出します。ご相談内容はAIが要約し、お名前・ご住所・お電話番号・訪問のご希望日（第1〜第3）とあわせて、送信前にご確認いただきます。
          </p>
          <button type="button" className="btn-accent mt-3 w-full" onClick={openEstimate}>
            <ClipboardCheck className="h-4 w-4" />
            無料お見積りを依頼
          </button>
          {lastEstimate ? (
            <p className="mt-3 rounded-xl bg-tatami-50 px-3 py-2 text-xs text-tatami-700">
              受付済み：{lastEstimate.id}
              <br />
              担当者より折り返しご連絡します。
            </p>
          ) : null}
        </div>
        <div className="card p-4 text-xs leading-relaxed text-sumi-600">
          <p className="flex items-center gap-1.5 font-serif text-base font-bold text-sumi-800">
            <Clock3 className="h-4 w-4 text-ichi-green" />
            営業のご案内
          </p>
          <dl className="mt-2 space-y-1.5">
            <div className="flex gap-2">
              <dt className="w-14 shrink-0 font-bold text-sumi-700">営業時間</dt>
              <dd>{BUSINESS.hours}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-14 shrink-0 font-bold text-sumi-700">定休日</dt>
              <dd>
                {BUSINESS.closed}（ほか{BUSINESS.otherHolidays}）
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-14 shrink-0 font-bold text-sumi-700">土日施工</dt>
              <dd>OK（3週間前までに要予約）</dd>
            </div>
          </dl>
          <p className="mt-2 rounded-lg bg-ichi-cream px-2.5 py-1.5">このAI相談は24時間ご利用いただけます。</p>
        </div>
        <Link href="/voice" className="card flex items-center justify-between gap-2 px-4 py-3 text-sm font-bold text-ichi-theme transition-opacity hover:opacity-80">
          <span className="flex items-center gap-2">
            <Mic className="h-4 w-4 text-ichi-green" />
            声で相談したい方はこちら
          </span>
          <ChevronRight className="h-4 w-4" />
        </Link>
        <PhoneCompact />
        {mode !== "openai" || lastMode === "demo-error" ? <DemoNotice compact /> : null}
      </aside>

      <Modal open={estimateOpen} onClose={() => setEstimateOpen(false)} title="無料お見積りの依頼（内容の確認・送信）">
        <EstimateForm
          channel="web_text"
          sessionId={sessionId}
          initial={{ summary }}
          summaryLoading={summaryLoading}
          lineUrl={lineUrl}
          onSubmitted={onSubmitted}
          onCancel={() => setEstimateOpen(false)}
        />
      </Modal>
    </div>
  );
}
