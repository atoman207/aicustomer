"use client";

import { ClipboardCheck, Keyboard, Loader2, Mic, MicOff, PhoneOff, Send, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import EstimateForm, { type EstimateInitial } from "./EstimateForm";
import { Badge, DemoNotice, Modal, ModeBadge } from "./ui";
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
import type { ChatMessage, EstimateRequest } from "@/lib/types";
import { uid } from "@/lib/utils";

type Status = "idle" | "connecting" | "live" | "ended";
type Mode = "openai" | "demo";

interface Line {
  id: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
}

interface SessionInfo {
  mode: Mode;
  reason?: string;
  clientSecret?: string;
  model?: string;
  api?: "ga" | "beta";
}

interface RtEvent {
  type: string;
  item_id?: string;
  transcript?: string;
  delta?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  response?: { status?: string; output?: { type: string; call_id?: string; name?: string; arguments?: string }[] };
  error?: { message?: string; code?: string };
}

interface ToolArgs {
  query?: string;
  name?: string;
  address?: string;
  phone?: string;
  preferred_dates?: string[];
  summary?: string;
}

export default function VoiceConsole({ initialMode, company, lineUrl }: { initialMode: Mode; company: string; lineUrl: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [mode, setMode] = useState<Mode>(initialMode);
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [interim, setInterim] = useState("");
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [typed, setTyped] = useState("");
  const [estimateOpen, setEstimateOpen] = useState(false);
  const [estimateInitial, setEstimateInitial] = useState<EstimateInitial>({});
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [lastEstimate, setLastEstimate] = useState<EstimateRequest | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [micOk, setMicOk] = useState(true);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<Recognizer | null>(null);
  const liveRef = useRef(false);
  const modeRef = useRef<Mode>(initialMode);
  const busyRef = useRef(false);
  const speakingRef = useRef(false);
  const sessionIdRef = useRef("");
  const agentSessionRef = useRef("");
  const agentSessionObjRef = useRef<unknown>(null); // デモモード：セッションを往復させる（サーバーレス対策）
  const handledCalls = useRef<Set<string>>(new Set());
  const responseActiveRef = useRef(false); // Realtime：モデルが応答中か
  const recFatalRef = useRef(false); // デモ：音声認識が使えない環境では自動再開しない
  const pendingRef = useRef<string | null>(null); // デモ：応答中に入力された発話
  const linesRef = useRef<Line[]>([]);
  const estimateIdRef = useRef<string | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    linesRef.current = lines;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  useEffect(() => {
    warmUpVoices();
    return () => {
      void endSession(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upsertLine = useCallback((id: string, role: Line["role"], text: string, final: boolean, append = false) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.id === id);
      if (idx < 0) return [...prev, { id, role, text, final }];
      const copy = [...prev];
      copy[idx] = { ...copy[idx], text: append ? copy[idx].text + text : text, final };
      return copy;
    });
  }, []);

  const sendEvent = (ev: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") dc.send(JSON.stringify(ev));
  };

  const saveTranscript = async () => {
    const msgs: ChatMessage[] = linesRef.current.filter((l) => l.text.trim()).map((l) => ({ role: l.role, content: l.text }));
    if (!sessionIdRef.current || msgs.length === 0) return;
    try {
      await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sessionIdRef.current, channel: "web_voice", messages: msgs, estimateId: estimateIdRef.current, meta: { mode: modeRef.current } }),
      });
    } catch {
      // ログ保存失敗は無視
    }
  };

  async function endSession(save = true) {
    liveRef.current = false;
    pendingRef.current = null;
    recRef.current?.abort();
    recRef.current = null;
    stopSpeaking();
    try {
      dcRef.current?.close();
    } catch {
      // noop
    }
    try {
      pcRef.current?.close();
    } catch {
      // noop
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    dcRef.current = null;
    pcRef.current = null;
    streamRef.current = null;
    setAiSpeaking(false);
    setListening(false);
    setUserSpeaking(false);
    setStatus((s) => (s === "idle" ? "idle" : "ended"));
    if (save) await saveTranscript();
  }

  // ---------------- OpenAI Realtime (WebRTC) ----------------

  /** ツール（関数）呼び出しの結果を作る */
  async function toolOutput(name: string, argsJson: string): Promise<string> {
    let args: ToolArgs = {};
    try {
      args = JSON.parse(argsJson || "{}") as ToolArgs;
    } catch {
      args = {};
    }
    let output = "";
    if (name === "search_knowledge") {
      try {
        const res = await fetch("/api/knowledge/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: args.query ?? "", k: 4 }),
        });
        const j = (await res.json()) as { answer?: string; mode?: string; hits?: { title: string; content: string }[]; sources?: { title: string }[] };
        const hits = j.hits ?? [];
        setSources((j.sources?.length ? j.sources : hits).map((h) => h.title));
        // answer があれば（料金表・会社情報・学習済みの回答）それを根拠に話す。なければ関係するナレッジだけを渡す
        output = JSON.stringify(
          j.answer
            ? { answer: j.answer }
            : {
                results: hits.map((h) => ({ title: h.title, content: h.content })),
                note: hits.length === 0 ? "該当するナレッジがありません。推測せず、担当者からの折り返しを案内してください。" : undefined,
              },
        );
      } catch (e) {
        output = JSON.stringify({ error: (e as Error).message });
      }
    } else if (name === "propose_estimate_request") {
      setEstimateInitial({
        name: args.name,
        address: args.address,
        phone: args.phone,
        dates: args.preferred_dates ?? [],
        summary: args.summary,
      });
      setEstimateOpen(true);
      output = JSON.stringify({
        ok: true,
        message: "画面に確認フォームを表示しました。お客様に内容の確認・修正と送信ボタンの押下を短く案内してください。",
      });
    } else {
      output = JSON.stringify({ error: `unknown tool: ${name}` });
    }
    return output;
  }

  /**
   * 応答が完了したら、その応答に含まれる関数呼び出しを処理して結果を返し、続きの応答を依頼する。
   * （応答の途中で response.create を送ると「応答中」のエラーになるため、必ず response.done 後に送る）
   */
  async function handleResponseDone(ev: RtEvent) {
    responseActiveRef.current = false;
    const calls = (ev.response?.output ?? []).filter(
      (it) => it.type === "function_call" && it.call_id && it.name && !handledCalls.current.has(it.call_id),
    );
    if (calls.length === 0) return;
    calls.forEach((c) => handledCalls.current.add(c.call_id!));
    const outputs = await Promise.all(calls.map((c) => toolOutput(c.name!, c.arguments ?? "{}")));
    calls.forEach((c, i) => {
      sendEvent({ type: "conversation.item.create", item: { type: "function_call_output", call_id: c.call_id, output: outputs[i] } });
    });
    sendEvent({ type: "response.create" });
  }

  /** お客様の文字入力・システム通知をモデルに渡して応答させる（AIが話している途中なら止めてから） */
  function sendUserText(text: string) {
    if (responseActiveRef.current) {
      sendEvent({ type: "response.cancel" });
      sendEvent({ type: "output_audio_buffer.clear" });
    }
    sendEvent({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
    sendEvent({ type: "response.create" });
  }

  function handleServerEvent(ev: RtEvent) {
    switch (ev.type) {
      case "response.created":
        responseActiveRef.current = true;
        break;
      case "input_audio_buffer.committed":
        if (ev.item_id) upsertLine(ev.item_id, "user", "…", false);
        break;
      case "conversation.item.input_audio_transcription.delta":
        if (ev.item_id) {
          setLines((prev) => {
            const idx = prev.findIndex((l) => l.id === ev.item_id);
            if (idx < 0) return [...prev, { id: ev.item_id!, role: "user", text: ev.delta ?? "", final: false }];
            const copy = [...prev];
            const base = copy[idx].text === "…" ? "" : copy[idx].text;
            copy[idx] = { ...copy[idx], text: base + (ev.delta ?? "") };
            return copy;
          });
        }
        break;
      case "conversation.item.input_audio_transcription.completed": {
        if (!ev.item_id) break;
        const text = ev.transcript?.trim() ?? "";
        // 物音などで文字にならなかった発話は表示しない
        if (text) upsertLine(ev.item_id, "user", text, true);
        else setLines((prev) => prev.filter((l) => l.id !== ev.item_id));
        break;
      }
      case "conversation.item.input_audio_transcription.failed":
        if (ev.item_id) setLines((prev) => prev.filter((l) => l.id !== ev.item_id));
        break;
      case "input_audio_buffer.speech_started":
        setUserSpeaking(true);
        break;
      case "input_audio_buffer.speech_stopped":
        setUserSpeaking(false);
        break;
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta":
        if (ev.item_id) upsertLine(ev.item_id, "assistant", ev.delta ?? "", false, true);
        break;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        if (ev.item_id) upsertLine(ev.item_id, "assistant", ev.transcript ?? "", true);
        break;
      case "output_audio_buffer.started":
        setAiSpeaking(true);
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        setAiSpeaking(false);
        break;
      case "response.done":
        void handleResponseDone(ev);
        break;
      case "error": {
        // 割り込み時などに出る無害なエラーはお客様に表示しない
        const code = ev.error?.code ?? "";
        if (code === "response_cancel_not_active" || code === "conversation_already_has_active_response") break;
        setError(ev.error?.message ?? "Realtime API エラー");
        break;
      }
      default:
        break;
    }
  }

  async function startRealtime(info: SessionInfo) {
    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    pc.ontrack = (e) => {
      if (audioRef.current) {
        audioRef.current.srcObject = e.streams[0];
        audioRef.current.play().catch(() => undefined);
      }
    };
    const ms = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streamRef.current = ms;
    ms.getTracks().forEach((t) => pc.addTrack(t, ms));
    const dc = pc.createDataChannel("oai-events");
    dcRef.current = dc;
    dc.onmessage = (e) => {
      try {
        handleServerEvent(JSON.parse(e.data as string) as RtEvent);
      } catch {
        // 解析不能なイベントは無視
      }
    };
    dc.onopen = () => {
      liveRef.current = true;
      setStatus("live");
      setListening(true);
      sendEvent({
        type: "response.create",
        response: {
          instructions: `「こんにちは、畳の${company}のAI相談員です。畳や襖、障子、網戸のことなら何でもお聞きください。」のように、短く挨拶してご用件を伺ってください。`,
        },
      });
    };
    pc.onconnectionstatechange = () => {
      if ((pc.connectionState === "failed" || pc.connectionState === "closed") && liveRef.current) {
        setError("音声接続が切断されました。もう一度開始してください。");
        void endSession();
      }
    };
    const opened = new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error("音声接続がタイムアウトしました")), 15000);
      dc.addEventListener(
        "open",
        () => {
          window.clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const model = info.model ?? "gpt-realtime";
    const url =
      info.api === "beta"
        ? `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`
        : `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`;
    const headers: Record<string, string> = { Authorization: `Bearer ${info.clientSecret ?? ""}`, "Content-Type": "application/sdp" };
    if (info.api === "beta") headers["OpenAI-Beta"] = "realtime=v1";
    const res = await fetch(url, { method: "POST", body: offer.sdp, headers });
    if (!res.ok) throw new Error(`音声セッションの接続に失敗しました（HTTP ${res.status}）`);
    await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
    // データチャネルが開くまで待つ（開かなければデモモードに切り替える）
    await opened;
  }

  // ---------------- デモモード（Web Speech API） ----------------

  async function say(text: string) {
    upsertLine(uid(), "assistant", text, true);
    speakingRef.current = true;
    setAiSpeaking(true);
    setListening(false);
    await speakText(text);
    speakingRef.current = false;
    setAiSpeaking(false);
  }

  function listen() {
    if (!liveRef.current || modeRef.current !== "demo" || recFatalRef.current) return;
    if (!supportsRecognition()) {
      setMicOk(false);
      return;
    }
    recRef.current?.abort();
    const rec = createRecognizer({
      onInterim: (t) => setInterim(t),
      onFinal: (t) => {
        setInterim("");
        void handleDemoUserText(t);
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

  async function handleDemoUserText(text: string) {
    if (!liveRef.current) return;
    if (busyRef.current) {
      // 応答・読み上げ中の発話は、読み上げを止めて次に処理する（入力を取りこぼさない）
      pendingRef.current = text;
      stopSpeaking();
      return;
    }
    busyRef.current = true;
    recRef.current?.abort();
    setListening(false);
    upsertLine(uid(), "user", text, true);
    try {
      const res = await fetch("/api/agent/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: agentSessionRef.current, text, session: agentSessionObjRef.current }),
      });
      const j = (await res.json()) as {
        ok: boolean;
        reply?: string;
        done?: boolean;
        estimate?: EstimateRequest | null;
        sources?: { title: string }[];
        session?: unknown;
        error?: string;
      };
      if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      if (j.session) agentSessionObjRef.current = j.session;
      setSources((j.sources ?? []).map((s) => s.title));
      if (j.estimate) {
        setLastEstimate(j.estimate);
        estimateIdRef.current = j.estimate.id;
      }
      await say(j.reply ?? "");
      if (j.done) {
        busyRef.current = false;
        await endSession();
        return;
      }
    } catch (e) {
      await say(`申し訳ありません、通信に失敗しました（${(e as Error).message}）。もう一度お話しください。`);
    } finally {
      busyRef.current = false;
    }
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next && liveRef.current) {
      void handleDemoUserText(next);
      return;
    }
    listen();
  }

  async function startDemo() {
    const res = await fetch("/api/agent/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "web_voice" }),
    });
    const j = (await res.json()) as { ok: boolean; sessionId?: string; session?: unknown; greeting?: string; error?: string };
    if (!res.ok || !j.ok || !j.sessionId) throw new Error(j.error ?? "セッションを開始できませんでした");
    agentSessionRef.current = j.sessionId;
    agentSessionObjRef.current = j.session ?? null;
    liveRef.current = true;
    setStatus("live");
    await say(j.greeting ?? `こんにちは。${company}のAI相談員です。ご用件をどうぞ。`);
    listen();
  }

  // ---------------- 共通操作 ----------------

  async function start() {
    setError("");
    setLines([]);
    setSources([]);
    setLastEstimate(null);
    estimateIdRef.current = undefined;
    handledCalls.current = new Set();
    responseActiveRef.current = false;
    recFatalRef.current = false;
    sessionIdRef.current = `voice_${uid()}`;
    setStatus("connecting");
    try {
      const res = await fetch("/api/realtime/session", { method: "POST" });
      const info = (await res.json()) as SessionInfo;
      setReason(info.reason ?? "");
      if (info.mode === "openai") {
        modeRef.current = "openai";
        setMode("openai");
        try {
          await startRealtime(info);
          return;
        } catch (e) {
          const msg = (e as Error).message;
          if (/NotAllowedError|Permission|denied|許可/i.test(msg) || (e as DOMException).name === "NotAllowedError") {
            setError("マイクの使用が許可されませんでした。ブラウザの設定でマイクを許可してから再度お試しください。");
            setStatus("idle");
            return;
          }
          setReason(`Realtime 接続に失敗したためデモモードに切り替えました：${msg}`);
          await endSession(false);
        }
      }
      modeRef.current = "demo";
      setMode("demo");
      await startDemo();
    } catch (e) {
      setError((e as Error).message);
      setStatus("idle");
      liveRef.current = false;
    }
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    streamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
  }

  function submitTyped() {
    const t = typed.trim();
    if (!t || !liveRef.current) return;
    setTyped("");
    if (modeRef.current === "openai") {
      upsertLine(uid(), "user", t, true);
      sendUserText(t);
    } else {
      void handleDemoUserText(t);
    }
  }

  function interruptDemoSpeech() {
    if (modeRef.current === "demo" && speakingRef.current) {
      stopSpeaking();
    }
  }

  async function openEstimate() {
    setEstimateOpen(true);
    if (!estimateInitial.summary) {
      setSummaryLoading(true);
      try {
        const res = await fetch("/api/summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: linesRef.current.map((l) => ({ role: l.role, content: l.text })) }),
        });
        const j = (await res.json()) as { ok: boolean; summary?: string };
        if (j.ok) setEstimateInitial((prev) => ({ ...prev, summary: j.summary ?? "" }));
      } catch {
        // noop
      } finally {
        setSummaryLoading(false);
      }
    }
  }

  function onSubmitted(est: EstimateRequest) {
    setLastEstimate(est);
    estimateIdRef.current = est.id;
    if (modeRef.current === "openai") {
      if (liveRef.current) {
        sendUserText(
          `（システム通知）見積依頼フォームが送信され、受付番号 ${est.id} で登録されました。お客様に短くお礼を伝え、担当者より折り返しご連絡して日程を確定する旨を伝えてください。`,
        );
      }
    } else if (liveRef.current) {
      void (async () => {
        recRef.current?.abort();
        await say(`見積依頼を受付しました。受付番号は ${est.id} です。担当者より折り返しご連絡し、日程を確定いたします。`);
        listen();
      })();
    }
  }

  const statusLabel = (() => {
    if (status === "idle") return "開始ボタンを押して、マイクに向かってお話しください";
    if (status === "connecting") return "接続中…（マイクの使用を許可してください）";
    if (status === "ended") return "会話を終了しました。もう一度開始できます";
    if (aiSpeaking) return mode === "openai" ? "AIが話しています（話しかけると途中でも止まります）" : "AIが話しています（丸をクリックで停止）";
    if (userSpeaking || interim) return "聞き取り中…";
    if (listening || mode === "openai") return "どうぞお話しください";
    return "処理中…";
  })();

  const orbClass =
    aiSpeaking ? "bg-gradient-to-br from-ai-400 to-ai-700" : userSpeaking || interim ? "bg-gradient-to-br from-shu-300 to-shu-500" : "bg-gradient-to-br from-tatami-300 to-tatami-600";

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_1fr]">
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
      <section className="card flex flex-col items-center p-6">
        <div className="flex w-full items-center justify-between">
          <ModeBadge mode={mode} />
          <Badge tone={status === "live" ? "green" : "neutral"}>
            {status === "live" ? "通話中" : status === "connecting" ? "接続中" : status === "ended" ? "終了" : "待機中"}
          </Badge>
        </div>

        <button
          type="button"
          onClick={status === "live" ? interruptDemoSpeech : undefined}
          className="relative mt-10 grid h-48 w-48 place-items-center rounded-full"
          aria-label="音声状態"
        >
          {status === "live" && (aiSpeaking || userSpeaking || interim) ? (
            <>
              <span className={`absolute inset-0 rounded-full opacity-40 animate-pulseRing ${orbClass}`} />
              <span className={`absolute inset-0 rounded-full opacity-30 animate-pulseRing [animation-delay:0.5s] ${orbClass}`} />
            </>
          ) : null}
          <span className={`relative grid h-36 w-36 place-items-center rounded-full text-white shadow-soft transition ${status === "live" ? orbClass : "bg-sumi-300"}`}>
            {status === "connecting" ? <Loader2 className="h-12 w-12 animate-spin" /> : muted ? <MicOff className="h-12 w-12" /> : <Mic className="h-12 w-12" />}
          </span>
        </button>
        <p className="mt-6 min-h-[1.5rem] text-center text-sm text-sumi-600">{statusLabel}</p>
        {interim ? <p className="mt-1 text-center text-xs text-sumi-400">「{interim}」</p> : null}

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {status !== "live" && status !== "connecting" ? (
            <button type="button" className="btn-primary" onClick={start}>
              <Mic className="h-4 w-4" />
              音声相談を開始
            </button>
          ) : (
            <button type="button" className="btn-accent" onClick={() => endSession()}>
              <PhoneOff className="h-4 w-4" />
              終了する
            </button>
          )}
          {status === "live" && mode === "openai" ? (
            <button type="button" className="btn-secondary" onClick={toggleMute}>
              {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              {muted ? "ミュート解除" : "ミュート"}
            </button>
          ) : null}
          <button type="button" className="btn-line" onClick={openEstimate} disabled={status === "connecting"}>
            <ClipboardCheck className="h-4 w-4" />
            見積依頼（内容確認）
          </button>
        </div>

        <form
          className="mt-6 flex w-full max-w-md items-center gap-2"
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
            placeholder={micOk ? "マイクが使えない時はこちらに入力" : "テキストで話しかける"}
            disabled={status !== "live"}
          />
          <button type="submit" className="btn-secondary px-3" disabled={status !== "live" || !typed.trim()} aria-label="送信">
            <Send className="h-4 w-4" />
          </button>
        </form>

        {error ? <p className="mt-4 w-full rounded-xl border border-shu-200 bg-shu-50 px-3 py-2 text-xs text-shu-700">{error}</p> : null}
        {mode === "demo" ? (
          <div className="mt-4 w-full">
            <DemoNotice compact reason={reason || "ブラウザの音声認識（Web Speech API）と音声合成でデモ動作中。APIキー設定後は OpenAI Realtime API（WebRTC）による低遅延・割り込み対応の会話になります。"} />
          </div>
        ) : null}
        {lastEstimate ? (
          <p className="mt-4 w-full rounded-xl bg-tatami-50 px-3 py-2 text-xs text-tatami-700">
            見積依頼を受付しました：{lastEstimate.id}（担当者より折り返しご連絡します）
          </p>
        ) : null}
      </section>

      <section className="card flex h-[560px] flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-washi-200 bg-washi-100/70 px-4 py-3">
          <p className="text-sm font-semibold text-sumi-800">会話の文字起こし</p>
          <span className="text-[11px] text-sumi-400">{mode === "openai" ? "Realtime API（WebRTC）" : "Web Speech API（デモ）"}</span>
        </header>
        <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {lines.length === 0 ? (
            <p className="text-sm text-sumi-400">
              ここに会話が表示されます。例：「6畳の畳の表替えはいくらですか？」「網戸の張替えは即日できますか？」「見積をお願いしたい」
            </p>
          ) : null}
          {lines.map((l) => (
            <div key={l.id} className={`flex ${l.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                data-role={l.role}
                className={`bubble max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
                  l.role === "user" ? "rounded-tr-sm bg-ai-600 text-white" : "rounded-tl-sm border border-washi-200 bg-white text-sumi-800"
                } ${l.final ? "" : "opacity-80"}`}
              >
                {l.text}
              </div>
            </div>
          ))}
        </div>
        {sources.length > 0 ? (
          <div className="flex flex-wrap gap-1 border-t border-washi-200 px-4 py-2">
            {sources.map((s) => (
              <span key={s} className="chip">
                <Sparkles className="h-3 w-3 text-ai-500" />
                参照：{s}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <Modal open={estimateOpen} onClose={() => setEstimateOpen(false)} title="見積依頼（内容の確認・送信）">
        <EstimateForm
          key={`${estimateInitial.name ?? ""}|${estimateInitial.phone ?? ""}|${(estimateInitial.dates ?? []).join(",")}`}
          channel="web_voice"
          sessionId={sessionIdRef.current}
          initial={estimateInitial}
          summaryLoading={summaryLoading}
          lineUrl={lineUrl}
          onSubmitted={onSubmitted}
          onCancel={() => setEstimateOpen(false)}
        />
      </Modal>
    </div>
  );
}
