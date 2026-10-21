"use client";

// 文字で AI 相談（お客様向け）。回答は一畳屋の公式情報（料金表・会社案内・ホームページ）だけを根拠にする
//   ・会話はこの端末に 6 時間保存（ページを読み直しても続きから）。声の相談の内容も引き継ぐ。「新しい相談」で最初から
//   ・「見積をお願いします」には、このチャットでお名前・ご住所・お電話番号・ご希望日時（第3希望まで）を伺う
//   ・「見積依頼」ボタンで開く確認画面には、会話で伺った内容とご相談内容の要約が入っている（お客様は確認して送信するだけ）
import {
  ArrowUp,
  CalendarClock,
  CalendarDays,
  Cat,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Coins,
  Loader2,
  MapPin,
  Mic,
  RotateCcw,
  Store,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import AiAvatar from "./chat/AiAvatar";
import RichText from "./chat/RichText";
import EstimateForm, { type EstimateFormEdits } from "./EstimateForm";
import { PhoneCompact } from "./PhoneButton";
import { Modal } from "./ui";
import { BUSINESS } from "@/lib/company";
import { clearConversation, loadConversation, saveConversation } from "@/lib/conversation-store";
import { emptyDraft, keepTouched, missingFields, sanitizeIntake, type IntakeState } from "@/lib/intake";
import type { ChatMessage, EstimateRequest } from "@/lib/types";
import { uid } from "@/lib/utils";

interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: { title: string; category: string; origin?: string }[];
  mode?: string;
  kind?: string;
  pending?: boolean;
  /** 送信できなかった質問（「もう一度送る」で再送） */
  retry?: string;
  at?: number;
  /** 声の相談で話した内容（声 → 文字に切り替えたとき） */
  channel?: "text" | "voice";
}

// お客様に見せる参照元の呼び名（社内向けの「マニュアル」などの言い方は出さない）
const ORIGIN_SHORT: Record<string, string> = { manual: "サービス案内", website: "公式サイト" };

/** OpenAI を使わずに答えた回答の表示（お客様には「公式情報から」。スタッフ向けの詳細はツールチップ） */
function answeredLocally(mode?: string): { label: string; detail: string } | null {
  if (mode === "local") return { label: "一畳屋の公式情報から回答", detail: "学習済みナレッジから回答（AI未使用）" };
  if (mode === "cache") return { label: "一畳屋の公式情報から回答", detail: "学習済みの回答を再利用（AI未使用）" };
  return null;
}

const TOPICS = [
  { icon: Coins, label: "畳の料金", q: "6畳の畳の表替えはいくらですか？" },
  { icon: CalendarClock, label: "工期", q: "畳の表替えは何日かかりますか？" },
  { icon: MapPin, label: "対応エリア", q: "対応エリアを教えてください" },
  { icon: CalendarDays, label: "土日の工事", q: "土日に工事をお願いできますか？" },
  { icon: Cat, label: "ペットがいる家", q: "猫がいても破れにくい障子紙はありますか？" },
  { icon: Store, label: "来店・見本", q: "お店に行って見本を見られますか？" },
];

function greeting(company: string): UiMessage {
  return {
    id: "greeting",
    role: "assistant",
    content: `こんにちは。畳の${company}のAI相談員です。\n畳・襖・障子・網戸から住まいのリフォームまで、料金の目安や工期、対応エリアなどにお答えします。\n気になることを、そのまま入力してください。`,
  };
}

const emptyIntake = (): IntakeState => ({ active: false, draft: emptyDraft() });

function timeLabel(at?: number): string {
  if (!at) return "";
  return new Date(at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

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
  const [sessionId, setSessionId] = useState(() => uid());
  const [messages, setMessages] = useState<UiMessage[]>(() => [greeting(company)]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [estimateOpen, setEstimateOpen] = useState(false);
  // 見積依頼の聞き取り（伺った内容の下書き）。会話と一緒にこの端末に保存し、毎回サーバーに送る
  const [intake, setIntake] = useState<IntakeState>(emptyIntake);
  const [draftLoading, setDraftLoading] = useState(false);
  const intakeRef = useRef(intake);
  const [lastEstimate, setLastEstimate] = useState<EstimateRequest | null>(null);
  const [restored, setRestored] = useState(false);
  const messagesRef = useRef(messages);
  const sessionRef = useRef(sessionId);
  const busyRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  messagesRef.current = messages;
  sessionRef.current = sessionId;
  intakeRef.current = intake;

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    // 最初の画面（まだ質問していない）はあいさつから見えるように上から、質問後は最新の発言まで
    if (!messages.some((m) => m.role === "user")) el.scrollTo({ top: 0 });
    else el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // 入力欄の高さを内容に合わせる
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);

  // 会話をこの端末に保存（読み直しても・声の相談に切り替えても続きから）
  useEffect(() => {
    if (!restored) return;
    const keep = messages.filter((m) => !m.pending && !m.retry && m.id !== "greeting");
    saveConversation({
      id: sessionId,
      estimateId: lastEstimate?.id,
      intake,
      messages: keep.map((m) => ({ id: m.id, role: m.role, content: m.content, at: m.at, channel: m.channel ?? "text", sources: m.sources, mode: m.mode, kind: m.kind })),
    });
  }, [messages, sessionId, lastEstimate, intake, restored]);

  const toHistory = (list: UiMessage[]): ChatMessage[] =>
    list.filter((m) => !m.pending && !m.retry && m.content.trim()).map((m) => ({ role: m.role, content: m.content }));

  const send = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setInput("");
    const userMsg: UiMessage = { id: uid(), role: "user", content: t, at: Date.now() };
    const pendingId = uid();
    const history = toHistory([...messagesRef.current, userMsg]);
    const firstQuestion = !messagesRef.current.some((m) => m.role === "user");
    setMessages((prev) => [...prev, userMsg, { id: pendingId, role: "assistant", content: "", pending: true }]);
    // スマホ：最初の質問で相談の枠を画面いっぱいに
    if (firstQuestion && window.innerWidth < 1024) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 70_000);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionRef.current, channel: "web_text", messages: history, intake: intakeRef.current }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const m = res.headers.get("X-Mode") ?? "openai";
      const kind = res.headers.get("X-Answer-Kind") ?? "";
      let sources: { title: string; category: string; origin?: string }[] = [];
      try {
        sources = JSON.parse(decodeURIComponent(res.headers.get("X-Sources") ?? "%5B%5D")) as typeof sources;
      } catch {
        sources = [];
      }
      // 見積依頼の聞き取りの状態（お客様が確認画面で直した項目はそのまま）
      const intakeHeader = res.headers.get("X-Intake");
      if (intakeHeader) {
        try {
          const next = sanitizeIntake(JSON.parse(decodeURIComponent(intakeHeader)));
          setIntake((prev) => ({ ...next, draft: keepTouched(next.draft, prev.draft, prev.touched), touched: prev.touched, aiFilled: prev.aiFilled }));
        } catch {
          // 状態が読めなければ前のまま
        }
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
          x.id === pendingId ? { ...x, content: acc || "申し訳ありません、うまくお答えできませんでした。言い方を変えてもう一度お試しください。", pending: false, sources, mode: m, kind, at: Date.now() } : x,
        ),
      );
    } catch (e) {
      const timeout = (e as Error).name === "AbortError";
      setMessages((prev) =>
        prev.map((x) =>
          x.id === pendingId
            ? {
                ...x,
                content: timeout
                  ? "申し訳ありません、回答に時間がかかっています。通信環境をご確認のうえ、もう一度お試しください。"
                  : "申し訳ありません、通信がうまくいきませんでした。もう一度お試しください。",
                pending: false,
                mode: "error",
                retry: t,
                at: Date.now(),
              }
            : x,
        ),
      );
    } finally {
      clearTimeout(timer);
      busyRef.current = false;
      setBusy(false);
      if (window.innerWidth >= 1024) textareaRef.current?.focus();
    }
  }, []);

  // 保存した会話の復元 → トップページの「AIにくわしく聞く」から来た場合（/chat?q=...）はそのまま質問する
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const saved = loadConversation();
    if (saved) {
      setSessionId(saved.id);
      sessionRef.current = saved.id;
      const list: UiMessage[] = [greeting(company), ...saved.messages.map((m) => ({ ...m, channel: m.channel ?? "text" }))];
      messagesRef.current = list;
      setMessages(list);
      if (saved.intake) {
        intakeRef.current = saved.intake;
        setIntake(saved.intake);
      }
    }
    setRestored(true);
    const q = new URLSearchParams(window.location.search).get("q")?.trim();
    if (q) {
      window.history.replaceState(null, "", window.location.pathname);
      void send(q.slice(0, 300));
    }
  }, [company, send]);

  function retry(m: UiMessage) {
    if (!m.retry || busyRef.current) return;
    const idx = messagesRef.current.findIndex((x) => x.id === m.id);
    const list = messagesRef.current.filter((_, i) => i !== idx && i !== idx - 1);
    messagesRef.current = list;
    setMessages(list);
    void send(m.retry);
  }

  function reset() {
    if (busyRef.current) return;
    if (messagesRef.current.some((m) => m.role === "user") && !window.confirm("これまでの会話を消して、新しい相談を始めますか？")) return;
    const id = uid();
    setSessionId(id);
    sessionRef.current = id;
    setLastEstimate(null);
    setIntake(emptyIntake());
    intakeRef.current = emptyIntake();
    const list = [greeting(company)];
    messagesRef.current = list;
    setMessages(list);
    clearConversation();
  }

  /**
   * 確認画面を開く。会話で伺った内容はすぐに表示し、足りない項目・ご相談内容（要約）は会話全体から読み取って入れる
   * （すべてそろっていて、要約のあとに会話が増えていなければ読み取り直さない）
   */
  async function openEstimate() {
    setEstimateOpen(true);
    const history = toHistory(messagesRef.current);
    const cur = intakeRef.current;
    if (!history.some((m) => m.role === "user")) return;
    const fresh = Boolean(cur.draft.summary) && (cur.summaryAt ?? -1) >= history.length - 1;
    if (missingFields(cur.draft).length === 0 && fresh) return;
    setDraftLoading(true);
    try {
      const res = await fetch("/api/estimates/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, draft: cur.draft, keepSummary: cur.touched?.includes("summary") }),
      });
      const j = (await res.json()) as { ok: boolean; draft?: IntakeState["draft"] };
      if (j.ok && j.draft) {
        const read = j.draft;
        setIntake((prev) => ({ ...prev, draft: keepTouched(read, prev.draft, prev.touched), summaryAt: history.length }));
      }
    } catch {
      // 読み取れなかった項目は、お客様に確認画面で入力していただく
    } finally {
      setDraftLoading(false);
    }
  }

  /** 確認画面での入力・修正（閉じて開き直しても残す） */
  function onFormChange(edits: EstimateFormEdits) {
    setIntake((prev) => ({ ...prev, draft: edits.draft, touched: edits.touched, aiFilled: edits.aiFilled, summaryEdited: edits.touched.includes("summary") }));
  }

  function onSubmitted(est: EstimateRequest) {
    setLastEstimate(est);
    // 次のご依頼のために、お名前・ご連絡先だけ残す（ご希望日時・ご相談内容は新しく伺う）
    setIntake((prev) => ({ active: false, draft: { name: prev.draft.name, address: prev.draft.address, phone: prev.draft.phone, dates: [] } }));
    setMessages((prev) => [
      ...prev,
      {
        id: uid(),
        role: "assistant",
        content: `無料お見積りのご依頼を受け付けました（受付番号：${est.id}）。\n担当者より折り返しお電話し、お見積りに伺う日程を決めさせていただきます。ありがとうございました。`,
        at: Date.now(),
      },
    ]);
  }

  const asked = messages.some((m) => m.role === "user");
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && !m.pending);
  const remaining = TOPICS.filter((t) => !messages.some((m) => m.role === "user" && m.content === t.q)).slice(0, 3);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section
        ref={panelRef}
        className="chat-card card flex h-[calc(100dvh-92px)] min-h-[480px] scroll-mt-[86px] flex-col overflow-hidden rounded-2xl lg:h-[calc(100dvh-230px)] lg:max-h-[860px] lg:min-h-[600px] lg:scroll-mt-4"
        data-busy={busy ? "true" : "false"}
        data-mode={mode}
        aria-label="文字でAI相談"
      >
        <header className="flex items-center gap-3 bg-ptn-logo px-4 py-3 text-white">
          <AiAvatar size="h-10 w-10" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="font-hand text-[17px]">一畳屋 AI相談員</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/80" title={`回答の根拠：${knowledgeLabel}`}>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#9be37a] opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#9be37a]" />
              </span>
              24時間受付中<span className="hidden sm:inline">・一畳屋の料金表・会社案内をもとにお答えします</span>
            </p>
          </div>
          <button
            type="button"
            onClick={reset}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/85 transition hover:bg-white/10 hover:text-white"
            aria-label="新しい相談を始める"
            title="新しい相談を始める"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button type="button" onClick={openEstimate} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ichi-yellow px-3 py-1.5 text-xs font-bold text-ichi-theme transition hover:opacity-90 sm:px-4 sm:text-[13px]">
            <ClipboardCheck className="h-4 w-4" />
            <span className="hidden sm:inline">無料お見積り</span>
            <span className="sm:hidden">見積</span>
          </button>
        </header>

        <div ref={listRef} role="log" aria-live="polite" aria-relevant="additions" className="flex-1 space-y-5 overflow-y-auto bg-[#fbfaf5] px-3 py-5 sm:px-5">
          {messages.map((m, i) => {
            const local = answeredLocally(m.mode);
            // 声の相談から引き継いだ発言のあとに区切りを入れる
            const voiceEnds = m.channel === "voice" && messages[i + 1]?.channel !== "voice";
            const divider = voiceEnds ? (
              <p key={`${m.id}-handoff`} className="flex items-center gap-2 text-[11px] font-bold text-ichi-green" data-handoff>
                <span className="h-px flex-1 bg-ichi-green/25" />
                <Mic className="h-3.5 w-3.5" />
                ここまでは声の相談の内容です。続けて文字でどうぞ
                <span className="h-px flex-1 bg-ichi-green/25" />
              </p>
            ) : null;
            const tag = m.channel === "voice" ? (
              <span className="inline-flex items-center gap-0.5 text-ichi-green" data-channel="voice">
                <Mic className="h-3 w-3" />
                声の相談
              </span>
            ) : null;
            const isLast = m.id === lastAssistant?.id && !m.retry && m.id !== "greeting";
            // 聞き取りがそろった回答には「内容を確認して送信」（確認画面）。料金の回答などには、このチャットで見積を依頼するボタン
            const showReady = isLast && m.kind === "intake" && intake.ready && !lastEstimate;
            const showCta =
              isLast && !showReady && !lastEstimate && !intake.active && m.kind !== "intake" && (m.kind === "price" || /見積/.test(m.content)) && !/受付番号/.test(m.content);
            const bubble =
              m.role === "user" ? (
              <div key={m.id} className="flex animate-fadeUp flex-col items-end">
                <div data-role="user" className="bubble max-w-[86%] rounded-2xl rounded-tr-md bg-ichi-green px-4 py-2.5 text-[15px] leading-relaxed text-white shadow-sm">
                  {m.content}
                </div>
                {m.at || tag ? (
                  <span className="mt-1 flex items-center gap-2 text-[10px] text-sumi-400">
                    {tag}
                    {timeLabel(m.at)}
                  </span>
                ) : null}
              </div>
            ) : (
              <div key={m.id} className="flex animate-fadeUp gap-2.5">
                <span className="mt-0.5">
                  <AiAvatar size="h-8 w-8" />
                </span>
                <div className="min-w-0 max-w-[88%]">
                  <div
                    data-role="assistant"
                    className={`bubble rounded-2xl rounded-tl-md border bg-white px-4 py-3 text-[15px] leading-relaxed text-sumi-800 shadow-sm ${m.retry ? "border-shu-200" : "border-black/[0.06]"}`}
                  >
                    {m.pending && !m.content ? (
                      <span className="flex items-center gap-2 text-sm text-sumi-400" aria-label="回答を準備しています">
                        <span className="flex gap-1">
                          <span className="h-1.5 w-1.5 animate-blink rounded-full bg-ichi-green" />
                          <span className="h-1.5 w-1.5 animate-blink rounded-full bg-ichi-green [animation-delay:0.2s]" />
                          <span className="h-1.5 w-1.5 animate-blink rounded-full bg-ichi-green [animation-delay:0.4s]" />
                        </span>
                        回答を準備しています
                      </span>
                    ) : (
                      <RichText text={m.content} />
                    )}
                  </div>
                  {m.retry ? (
                    <button type="button" onClick={() => retry(m)} className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-shu-300 bg-white px-3 py-1 text-xs font-bold text-shu-600 hover:bg-shu-50">
                      <RotateCcw className="h-3.5 w-3.5" />
                      もう一度送る
                    </button>
                  ) : null}
                  {!m.pending && (local || m.sources?.length || m.at || tag) ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-sumi-400">
                      {tag}
                      {m.at ? <span>{timeLabel(m.at)}</span> : null}
                      {local ? (
                        <span className="inline-flex items-center gap-1 font-bold text-ichi-green" data-answer={m.mode} title={local.detail}>
                          <CheckCircle2 className="h-3 w-3" />
                          {local.label}
                        </span>
                      ) : null}
                      {(m.sources ?? []).slice(0, 2).map((s) => (
                        <span key={s.title}>
                          参考：{s.origin && ORIGIN_SHORT[s.origin] ? `${ORIGIN_SHORT[s.origin]}｜` : ""}
                          {s.title.replace(/^.*｜/, "")}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {showReady ? (
                    <button
                      type="button"
                      onClick={openEstimate}
                      className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-ichi-red px-4 py-2.5 text-[14px] font-bold text-white shadow-sm transition hover:opacity-90"
                      data-intake-ready
                    >
                      <ClipboardCheck className="h-4 w-4" />
                      内容を確認して送信
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  ) : null}
                  {showCta ? (
                    <button
                      type="button"
                      onClick={() => void send("見積をお願いします")}
                      disabled={busy}
                      className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-ichi-red px-4 py-2 text-[13px] font-bold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
                    >
                      <ClipboardCheck className="h-4 w-4" />
                      このままチャットで見積を依頼する
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>
            );
            return divider ? [bubble, divider] : bubble;
          })}

          {!asked ? (
            <div className="pl-[42px]">
              <p className="mb-2 text-xs font-bold text-sumi-500">よくあるご質問から選ぶ</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {TOPICS.map((t) => (
                  <button
                    key={t.q}
                    type="button"
                    onClick={() => send(t.q)}
                    disabled={busy}
                    className="group flex items-center gap-3 rounded-xl border border-ichi-green/25 bg-white px-3 py-2.5 text-left transition hover:border-ichi-green hover:bg-ichi-cream/60 disabled:opacity-50"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ichi-cream text-ichi-green">
                      <t.icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-bold text-ichi-green">{t.label}</span>
                      <span className="block text-[13px] leading-snug text-sumi-700">{t.q}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <footer className="border-t border-black/[0.06] bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 sm:px-4">
          {asked ? (
            <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
              {!lastEstimate ? (
                <button type="button" onClick={openEstimate} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ichi-red px-3 py-1 text-xs font-bold text-white">
                  <ClipboardCheck className="h-3.5 w-3.5" />
                  {intake.ready ? "内容を確認して送信" : "無料お見積りを依頼"}
                </button>
              ) : null}
              {remaining.map((t) => (
                <button
                  key={t.q}
                  type="button"
                  onClick={() => send(t.q)}
                  disabled={busy}
                  className="shrink-0 rounded-full border border-ichi-green/40 bg-white px-3 py-1 text-xs font-bold text-ichi-theme transition hover:bg-ichi-cream disabled:opacity-50"
                >
                  {t.label}
                </button>
              ))}
            </div>
          ) : null}
          <form
            className="flex items-end gap-2 rounded-[24px] border border-sumi-200 bg-white py-1.5 pl-4 pr-1.5 transition focus-within:border-ichi-green focus-within:ring-2 focus-within:ring-ichi-green/15"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <textarea
              ref={textareaRef}
              className="max-h-[140px] min-h-[36px] flex-1 resize-none bg-transparent py-1.5 text-[16px] leading-relaxed text-sumi-800 outline-none placeholder:text-sumi-300 sm:text-[15px]"
              rows={1}
              value={input}
              placeholder="ご質問を入力してください"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              aria-label="ご質問"
              aria-busy={busy}
              enterKeyHint="send"
            />
            <button
              type="submit"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ichi-green text-white transition hover:opacity-90 disabled:bg-sumi-200"
              disabled={busy || !input.trim()}
              aria-label="送信"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-[18px] w-[18px]" />}
            </button>
          </form>
          <p className="mt-1.5 text-center text-[10px] leading-snug text-sumi-400">
            AIは一畳屋の公式情報をもとにお答えします。正式なお見積りは担当者が現地を確認してご案内します。
          </p>
        </footer>
      </section>

      <aside className="space-y-4">
        <div className="card overflow-hidden rounded-2xl">
          <div className="bg-ichi-cream px-4 py-3">
            <p className="font-hand text-[17px] text-ichi-theme">無料お見積りのご依頼</p>
            <p className="mt-0.5 text-xs text-sumi-600">担当者が現地を確認してから、お見積りを無料で提出します。</p>
          </div>
          <div className="p-4">
            <ol className="space-y-2 text-xs text-sumi-600">
              {["AIが会話の中でお名前・ご連絡先・ご希望日時を伺います", "「見積依頼」を押すと、伺った内容とご相談内容の要約が入った確認画面に", "確認して送信 → 担当者からお電話し、伺う日程を決定"].map((s, i) => (
                <li key={s} className="flex items-start gap-2">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ichi-green text-[11px] font-bold text-white">{i + 1}</span>
                  <span className="pt-0.5">{s}</span>
                </li>
              ))}
            </ol>
            <button type="button" className="btn-accent mt-4 w-full py-3" onClick={openEstimate}>
              <ClipboardCheck className="h-4 w-4" />
              {intake.ready && !lastEstimate ? "内容を確認して送信" : "無料お見積りを依頼"}
            </button>
            {lastEstimate ? (
              <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-ichi-cream px-3 py-2 text-xs text-ichi-theme">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  受付済み（受付番号：{lastEstimate.id}）
                  <br />
                  担当者より折り返しご連絡します。
                </span>
              </p>
            ) : null}
          </div>
        </div>
        <div className="card rounded-2xl p-4 text-xs leading-relaxed text-sumi-600">
          <p className="flex items-center gap-1.5 font-hand text-[17px] text-sumi-800">
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
        <Link href="/voice" className="card flex items-center gap-3 rounded-2xl px-4 py-3 transition-opacity hover:opacity-80">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ichi-cream text-ichi-green">
            <Mic className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-ichi-theme">{asked ? "この続きを声で相談する" : "声で相談したい方はこちら"}</span>
            <span className="block text-[11px] text-sumi-500">{asked ? "ここまでの会話を引き継いで、話しかけるだけでお答えします" : "マイクに話しかけるだけで、AIがお答えします"}</span>
          </span>
          <ChevronRight className="h-4 w-4 text-sumi-400" />
        </Link>
        <PhoneCompact />
      </aside>

      <Modal open={estimateOpen} onClose={() => setEstimateOpen(false)} title="無料お見積りのご依頼">
        <EstimateForm
          channel="web_text"
          sessionId={sessionId}
          initial={intake.draft}
          touched={intake.touched}
          aiFilled={intake.aiFilled}
          loading={draftLoading}
          lineUrl={lineUrl}
          onSubmitted={onSubmitted}
          onCancel={() => setEstimateOpen(false)}
          onChange={onFormChange}
        />
      </Modal>
    </div>
  );
}
