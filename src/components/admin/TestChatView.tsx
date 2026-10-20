"use client";

// 管理画面「AIに質問（テスト）」：お客様と同じ AI に質問して、登録した情報で正しく答えるかを確かめる
//   （会話は「テスト」として会話履歴に保存）
import { ArrowUp, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Chip } from "./shared";

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  mode?: string;
  kind?: string;
  sources?: string[];
}

const KIND_LABEL: Record<string, string> = {
  price: "料金表から回答（AI未使用）",
  faq: "登録した情報から回答（AI未使用）",
  area: "営業範囲から回答（AI未使用）",
  learned: "学習済みの回答（AI未使用）",
  smalltalk: "定型文",
  notfound: "該当する情報なし → 折り返しを案内",
  llm: "AI が登録した情報をもとに作成",
  search: "ナレッジ検索（デモモード）",
};

const SAMPLES = ["6畳の畳の表替えはいくらですか？", "営業時間と定休日を教えてください", "猫がいても破れにくい網戸はありますか？", "畳のダニ対策はありますか？"];

const newId = () => Math.random().toString(36).slice(2, 10);

export function TestChatView() {
  const [session, setSession] = useState(() => `admintest-${newId()}`);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const busy = messages.some((m) => m.pending);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const history = [...messages.filter((m) => !m.pending), { id: newId(), role: "user" as const, content: question }];
    const reply: Msg = { id: newId(), role: "assistant", content: "", pending: true };
    setMessages([...history, reply]);
    setInput("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session, channel: "web_text", messages: history.map((m) => ({ role: m.role, content: m.content })) }),
      });
      const mode = res.headers.get("x-mode") ?? "";
      const kind = res.headers.get("x-answer-kind") ?? "";
      let sources: string[] = [];
      try {
        sources = (JSON.parse(decodeURIComponent(res.headers.get("x-sources") ?? "%5B%5D")) as { title: string }[]).map((s) => s.title.replace(/^.*｜/, ""));
      } catch {
        sources = [];
      }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setMessages((list) => list.map((m) => (m.id === reply.id ? { ...m, content: text } : m)));
      }
      setMessages((list) => list.map((m) => (m.id === reply.id ? { ...m, content: text, pending: false, mode, kind, sources } : m)));
    } catch (e) {
      setMessages((list) => list.map((m) => (m.id === reply.id ? { ...m, pending: false, content: `通信エラー：${(e as Error).message}` } : m)));
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-4 py-10 sm:px-6">
            <h2 className="text-center text-2xl font-semibold text-[#0d0d0d]">AI に質問してみる</h2>
            <p className="mt-2 text-center text-sm text-[#5d5d5d]">お客様と同じ AI が、登録した情報だけを根拠に答えます。登録した内容が正しく使われるか確かめてください。</p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {SAMPLES.map((s) => (
                <button key={s} type="button" onClick={() => void ask(s)} className="rounded-2xl border border-black/[0.08] px-4 py-3 text-left text-sm text-[#0d0d0d] transition hover:bg-black/[0.03]">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6">
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-3xl bg-[#f4f4f4] px-5 py-2.5 text-[15px] leading-relaxed text-[#0d0d0d]">{m.content}</p>
                </div>
              ) : (
                <div key={m.id} className="flex gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-black/10 bg-white">
                    <img src="/ichijoya/logo-symbol.svg" alt="" className="w-[60%]" />
                  </span>
                  <div className="min-w-0 flex-1 pt-1">
                    {m.pending && !m.content ? <Loader2 className="h-4 w-4 animate-spin text-[#8f8f8f]" /> : <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[#0d0d0d]">{m.content}</p>}
                    {!m.pending && (m.kind || m.sources?.length) ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {m.kind ? <Chip tone={m.kind === "llm" ? "blue" : m.kind === "notfound" ? "amber" : "green"}>{KIND_LABEL[m.kind] ?? m.kind}</Chip> : null}
                        {(m.sources ?? []).slice(0, 4).map((s) => (
                          <Chip key={s}>根拠：{s}</Chip>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ),
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>
      <div className="bg-white px-4 pb-4 pt-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-[26px] border border-black/10 bg-white p-2.5 shadow-[0_2px_14px_rgba(0,0,0,0.07)]">
          {messages.length ? (
            <button
              type="button"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#5d5d5d] hover:bg-black/[0.05]"
              onClick={() => {
                setMessages([]);
                setSession(`admintest-${newId()}`);
              }}
              aria-label="新しい会話"
              title="新しい会話"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          ) : null}
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void ask(input);
              }
            }}
            placeholder="お客様になったつもりで質問してください"
            className="max-h-40 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-relaxed text-[#0d0d0d] outline-none placeholder:text-[#8f8f8f]"
            aria-label="質問"
          />
          <button
            type="button"
            onClick={() => void ask(input)}
            disabled={busy || !input.trim()}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#0d0d0d] text-white transition hover:bg-black/80 disabled:bg-black/15"
            aria-label="送信"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
