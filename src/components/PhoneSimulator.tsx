"use client";

import {
  CheckCircle2,
  Circle,
  Clock,
  Keyboard,
  Loader2,
  Mic,
  Phone,
  PhoneForwarded,
  PhoneOff,
  Send,
  Volume2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge, DemoNotice, ModeBadge } from "./ui";
import {
  createRecognizer,
  isFatalRecognitionError,
  recognitionErrorMessage,
  speakText,
  stopSpeaking,
  supportsRecognition,
  warmUpVoices,
  type Recognizer,
} from "@/lib/speech-client";
import type { AgentStage, EstimateRequest, IntakeDraft } from "@/lib/types";
import { uid } from "@/lib/utils";

type CallState = "idle" | "ringing" | "transfer" | "live" | "ended";
type Mode = "openai" | "demo";

interface Line {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** OpenAI を使わずに学習済みのナレッジで答えた */
  local?: boolean;
}
interface Routing {
  handler: "ai" | "human";
  inBusinessHours: boolean;
  reason: string;
}
interface StartResp {
  ok: boolean;
  sessionId: string;
  session?: unknown;
  greeting: string;
  mode: Mode;
  routing: Routing;
  now: string;
  settings: { companyName: string; companyPhone: string; forwardNumber: string; mode: string; hoursLabel: string };
  error?: string;
}
interface TurnResp {
  ok: boolean;
  reply: string;
  answeredBy?: string;
  stage: AgentStage;
  draft: IntakeDraft;
  done: boolean;
  mode: Mode;
  estimate: EstimateRequest | null;
  session?: unknown;
  error?: string;
}

const STAGES: { key: AgentStage; label: string }[] = [
  { key: "consult", label: "ご相談対応" },
  { key: "collecting", label: "情報の聞き取り" },
  { key: "confirming", label: "復唱・確認" },
  { key: "completed", label: "受付完了" },
];

function fmtSec(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function PhoneSimulator({ companyPhone, initialMode }: { companyPhone: string; initialMode: Mode }) {
  const [callState, setCallState] = useState<CallState>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [interim, setInterim] = useState("");
  const [stage, setStage] = useState<AgentStage>("consult");
  const [draft, setDraft] = useState<IntakeDraft>({ dates: [] });
  const [estimate, setEstimate] = useState<EstimateRequest | null>(null);
  const [routing, setRouting] = useState<Routing | null>(null);
  const [info, setInfo] = useState<StartResp["settings"] | null>(null);
  const [now, setNow] = useState("");
  const [mode, setMode] = useState<Mode>(initialMode);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [typed, setTyped] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [micOk, setMicOk] = useState(true);

  const [thinking, setThinking] = useState(false);
  const liveRef = useRef(false);
  const busyRef = useRef(false);
  const speakingRef = useRef(false);
  const recRef = useRef<Recognizer | null>(null);
  const recFatalRef = useRef(false); // 音声認識が使えない環境では自動再開しない
  const pendingRef = useRef<string | null>(null); // 応答中に入力された発話
  const sessionIdRef = useRef("");
  const sessionRef = useRef<unknown>(null); // サーバーレス環境でも途切れないよう、セッションを往復させる
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    warmUpVoices();
    setMicOk(supportsRecognition());
    return () => {
      hangup(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, interim]);

  const addLine = (role: Line["role"], text: string, local = false) => setLines((prev) => [...prev, { id: uid(), role, text, local }]);

  async function say(text: string, local = false) {
    addLine("assistant", text, local);
    speakingRef.current = true;
    setSpeaking(true);
    setListening(false);
    await speakText(text);
    speakingRef.current = false;
    setSpeaking(false);
  }

  function listen() {
    if (!liveRef.current || recFatalRef.current) return;
    if (!supportsRecognition()) {
      setMicOk(false);
      return;
    }
    recRef.current?.abort();
    const rec = createRecognizer({
      onInterim: (t) => setInterim(t),
      onFinal: (t) => {
        setInterim("");
        void onUser(t);
      },
      onEnd: () => {
        setListening(false);
        if (liveRef.current && !busyRef.current && !speakingRef.current && !recFatalRef.current) setTimeout(listen, 250);
      },
      onError: (err) => {
        if (isFatalRecognitionError(err)) {
          recFatalRef.current = true;
          setMicOk(false);
          setListening(false);
          setError(recognitionErrorMessage(err));
        }
      },
    });
    if (!rec) {
      setMicOk(false);
      return;
    }
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  async function onUser(text: string) {
    if (!liveRef.current) return;
    if (busyRef.current) {
      // AI の応答・読み上げ中に話しかけられたら、読み上げを止めて次に処理する（入力を取りこぼさない）
      pendingRef.current = text;
      stopSpeaking();
      return;
    }
    busyRef.current = true;
    setThinking(true);
    recRef.current?.abort();
    setListening(false);
    addLine("user", text);
    try {
      const res = await fetch("/api/agent/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionIdRef.current, text, session: sessionRef.current }),
      });
      const j = (await res.json()) as TurnResp;
      if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      if (j.session) sessionRef.current = j.session;
      setStage(j.stage);
      setDraft(j.draft);
      setMode(j.mode);
      if (j.estimate) setEstimate(j.estimate);
      setThinking(false);
      await say(j.reply, j.answeredBy === "local" || j.answeredBy === "cache");
      if (j.done) {
        busyRef.current = false;
        hangup();
        return;
      }
    } catch (e) {
      setThinking(false);
      await say(`申し訳ありません、システムエラーが発生しました（${(e as Error).message}）。もう一度お話しください。`);
    } finally {
      busyRef.current = false;
      setThinking(false);
    }
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next && liveRef.current) {
      void onUser(next);
      return;
    }
    listen();
  }

  async function startCall(forceAi = false) {
    hangup(false);
    recFatalRef.current = false;
    setError("");
    setLines([]);
    setStage("consult");
    setDraft({ dates: [] });
    setEstimate(null);
    setSeconds(0);
    setCallState("ringing");
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const res = await fetch("/api/agent/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "phone", meta: { callerNumber: "090-0000-0000（シミュレーター）" } }),
      });
      const j = (await res.json()) as StartResp;
      if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      sessionIdRef.current = j.sessionId;
      sessionRef.current = j.session ?? null;
      setRouting(j.routing);
      setInfo(j.settings);
      setNow(j.now);
      setMode(j.mode);
      if (j.routing.handler === "human" && !forceAi) {
        setCallState("transfer");
        return;
      }
      setCallState("live");
      liveRef.current = true;
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      await say(j.greeting);
      listen();
    } catch (e) {
      setError((e as Error).message);
      setCallState("idle");
    }
  }

  function hangup(markEnded = true) {
    liveRef.current = false;
    pendingRef.current = null;
    recRef.current?.abort();
    recRef.current = null;
    stopSpeaking();
    speakingRef.current = false;
    setSpeaking(false);
    setListening(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (markEnded) setCallState((s) => (s === "idle" ? "idle" : "ended"));
  }

  function submitTyped() {
    const t = typed.trim();
    if (!t || !liveRef.current) return;
    setTyped("");
    void onUser(t);
  }

  const stageIndex = STAGES.findIndex((s) => s.key === stage);
  const screenLabel = (() => {
    switch (callState) {
      case "idle":
        return "発信ボタンで 0120 番号へ発信（シミュレーション）";
      case "ringing":
        return "呼び出し中…";
      case "transfer":
        return "営業時間内のためスタッフへ転送中…";
      case "live":
        return speaking ? "AI受付が話しています" : listening || interim ? "聞き取り中…" : "お話しください";
      case "ended":
        return "通話を終了しました";
    }
  })();

  return (
    <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
      {/* 電話機モック */}
      <section className="flex flex-col items-center">
        <div className="w-full max-w-[380px] rounded-[2.5rem] border-[6px] border-sumi-800 bg-sumi-900 p-3 shadow-2xl">
          <div className="flex h-[640px] flex-col overflow-hidden rounded-[2rem] bg-gradient-to-b from-sumi-800 to-sumi-900 text-white">
            <div className="flex items-center justify-between px-6 pt-5 text-[11px] text-sumi-300">
              <span>{now ? now.slice(-5) : "--:--"}</span>
              <ModeBadge mode={mode} />
            </div>
            <div className="px-6 pt-6 text-center">
              <p className="text-xs text-sumi-300">{info?.companyName ?? "AI電話受付"}</p>
              <p className="mt-1 font-serif text-3xl font-bold tracking-wider">{companyPhone}</p>
              <p className="mt-2 flex items-center justify-center gap-1 text-xs text-sumi-300">
                {callState === "live" ? <Clock className="h-3 w-3" /> : null}
                {callState === "live" ? fmtSec(seconds) : screenLabel}
              </p>
              {callState === "live" ? <p className="mt-1 text-xs text-sumi-300">{screenLabel}</p> : null}
            </div>

            <div ref={listRef} className="mx-3 mt-4 flex-1 space-y-2 overflow-y-auto rounded-2xl bg-black/25 p-3">
              {lines.length === 0 && callState !== "live" ? (
                <p className="px-2 pt-6 text-center text-xs text-sumi-400">
                  通話の文字起こしがここに表示されます。
                  <br />
                  例：「6畳の畳の表替えはいくら？」→「見積をお願いしたい」
                </p>
              ) : null}
              {lines.map((l) => (
                <div key={l.id} className={`flex ${l.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    data-role={l.role}
                    className={`bubble max-w-[88%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                      l.role === "user" ? "rounded-tr-sm bg-tatami-500 text-white" : "rounded-tl-sm bg-white/95 text-sumi-800"
                    }`}
                  >
                    {l.text}
                    {l.local ? <span className="mt-1 block text-[10px] font-bold text-ichi-green" data-answer="local">⚡ 学習済みナレッジから回答（AI未使用）</span> : null}
                  </div>
                </div>
              ))}
              {interim ? (
                <div className="flex justify-end">
                  <div className="rounded-2xl bg-tatami-500/50 px-3 py-2 text-[13px] text-white/90">{interim}</div>
                </div>
              ) : null}
              {callState === "transfer" ? (
                <div className="mx-auto mt-6 max-w-[92%] rounded-2xl bg-white/95 p-4 text-center text-xs leading-relaxed text-sumi-700">
                  <PhoneForwarded className="mx-auto mb-1 h-5 w-5 text-ai-600" />
                  <p className="font-bold text-sumi-800">{routing?.reason}</p>
                  <p className="mt-1">
                    実際のお電話は、いまの時間帯はスタッフに転送されます（転送先：{info?.forwardNumber || "管理画面で設定"}）。
                  </p>
                  <p className="mt-1">このシミュレーターでは、休日・時間外と同じAI受付をそのままお試しいただけます。</p>
                  <button type="button" className="btn-accent mt-3 w-full py-2 text-sm" onClick={() => startCall(true)}>
                    AI受付で試す
                  </button>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-center gap-6 px-6 py-5">
              {callState === "live" || callState === "ringing" || callState === "transfer" ? (
                <button
                  type="button"
                  onClick={() => hangup()}
                  className="grid h-16 w-16 place-items-center rounded-full bg-shu-500 text-white shadow-soft transition hover:bg-shu-600"
                  aria-label="通話終了"
                >
                  <PhoneOff className="h-7 w-7" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => startCall(false)}
                  className="grid h-16 w-16 place-items-center rounded-full bg-tatami-500 text-white shadow-soft transition hover:bg-tatami-600"
                  aria-label="発信"
                >
                  {callState === "ended" ? <Phone className="h-7 w-7" /> : <Phone className="h-7 w-7" />}
                </button>
              )}
              {callState === "live" ? (
                <span className={`grid h-12 w-12 place-items-center rounded-full ${speaking ? "bg-ai-500" : listening ? "bg-tatami-400" : "bg-sumi-600"} text-white`}>
                  {speaking ? <Volume2 className="h-5 w-5" /> : thinking ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-5 w-5" />}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <form
          className="mt-4 flex w-full max-w-[380px] items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submitTyped();
          }}
        >
          <Keyboard className="h-4 w-4 shrink-0 text-sumi-400" />
          <input
            className="input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={micOk ? "マイクの代わりにテキストで話す" : "テキストで話しかける（音声認識非対応）"}
            disabled={callState !== "live"}
          />
          <button type="submit" className="btn-secondary px-3" disabled={callState !== "live" || !typed.trim()} aria-label="送信">
            <Send className="h-4 w-4" />
          </button>
        </form>
        {error ? <p className="mt-3 w-full max-w-[380px] rounded-xl border border-shu-200 bg-shu-50 px-3 py-2 text-xs text-shu-700">{error}</p> : null}
      </section>

      {/* 右側：状態・設定 */}
      <section className="space-y-4">
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-serif text-base font-bold text-sumi-800">対応ルーティング（AI／スタッフ切替）</p>
            {routing ? <Badge tone={routing.handler === "ai" ? "green" : "blue"}>{routing.handler === "ai" ? "AI受付が対応" : "スタッフへ転送"}</Badge> : <Badge>発信すると判定します</Badge>}
          </div>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-xl bg-washi-100 px-3 py-2">
              <dt className="text-xs text-sumi-400">現在時刻（日本時間）</dt>
              <dd className="text-sumi-800">{now || "—"}</dd>
            </div>
            <div className="rounded-xl bg-washi-100 px-3 py-2">
              <dt className="text-xs text-sumi-400">営業時間</dt>
              <dd className="text-sumi-800">{info?.hoursLabel ?? "—"}</dd>
            </div>
            <div className="rounded-xl bg-washi-100 px-3 py-2 sm:col-span-2">
              <dt className="text-xs text-sumi-400">判定理由</dt>
              <dd className="text-sumi-800">{routing?.reason ?? "管理画面の「電話・営業時間」で、常時AI／営業時間外のみAI／常にスタッフ を切り替えられます"}</dd>
            </div>
          </dl>
        </div>

        <div className="card p-5">
          <p className="font-serif text-base font-bold text-sumi-800">受付の進行状況</p>
          <ol className="mt-3 flex flex-wrap gap-2">
            {STAGES.map((s, i) => (
              <li
                key={s.key}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${
                  i < stageIndex ? "bg-tatami-100 text-tatami-700" : i === stageIndex ? "bg-ai-600 text-white" : "bg-washi-100 text-sumi-400"
                }`}
              >
                {i < stageIndex ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                {s.label}
              </li>
            ))}
          </ol>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            {[
              ["お名前", draft.name],
              ["お電話番号", draft.phone],
              ["ご住所", draft.address],
              ["ご希望日", draft.dates.length ? draft.dates.map((d, i) => `第${i + 1}希望 ${d}`).join(" / ") : undefined],
            ].map(([k, v]) => (
              <div key={k as string} className="flex items-start gap-2 rounded-xl border border-washi-200 px-3 py-2">
                {v ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-tatami-500" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-sumi-300" />}
                <div>
                  <dt className="text-xs text-sumi-400">{k}</dt>
                  <dd className="text-sumi-800">{v || "—"}</dd>
                </div>
              </div>
            ))}
            <div className="flex items-start gap-2 rounded-xl border border-washi-200 px-3 py-2 sm:col-span-2">
              {draft.summary ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-tatami-500" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-sumi-300" />}
              <div>
                <dt className="text-xs text-sumi-400">ご相談内容（AI要約）</dt>
                <dd className="text-sumi-800">{draft.summary || "—"}</dd>
              </div>
            </div>
          </dl>
          {estimate ? (
            <div className="mt-4 rounded-xl border border-tatami-200 bg-tatami-50 p-3 text-sm text-tatami-800">
              <p className="font-semibold">スプレッドシート／受付一覧に登録しました</p>
              <p className="mt-1 text-xs">
                受付番号 {estimate.id} ／ 記録先：{estimate.syncedTo.join(", ")}
                {estimate.syncError ? `（同期エラー：${estimate.syncError}）` : ""}。担当者が後日折り返して日程を確定します。
              </p>
            </div>
          ) : null}
        </div>

        {mode === "demo" ? <DemoNotice compact reason="電話シミュレーターはブラウザの音声認識・合成で動作中。実際の電話では Twilio の音声認識と音声合成を使用し、応答ロジックは同じです。" /> : null}
      </section>
    </div>
  );
}
