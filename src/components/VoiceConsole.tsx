"use client";

// 声で AI 相談（お客様向け）。OpenAI Realtime（WebRTC）で電話のように話せる。使えない環境ではブラウザの音声認識・読み上げで動作
//   ・会話はこの端末と会話ログ（管理画面）に毎回保存。接続が切れたら自動で 1 回つなぎ直し、それでもだめなら「続きから話す」で再開
//   ・文字の相談と同じ会話として保存するので、「文字で続ける」で /chat に切り替えても続きから（逆も同じ）
//   ・見積のご希望には、AI がお名前・ご住所・お電話番号・ご希望日時を伺い、そろったら確認画面を表示する（お客様は確認して送信するだけ）
//     「見積依頼」ボタンを押したときも、会話の内容（文字の相談で伺った内容を含む）とご相談内容の要約が入った確認画面になる
import { CheckCircle2, ClipboardCheck, Keyboard, Loader2, MessageSquareText, MessagesSquare, Mic, MicOff, PhoneOff, RotateCcw, Send, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import AiAvatar from "./chat/AiAvatar";
import RichText from "./chat/RichText";
import EstimateForm, { type EstimateFormEdits } from "./EstimateForm";
import { Modal } from "./ui";
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
import { clearConversation, loadConversation, saveConversation, transcriptForAi, type StoredMessage } from "@/lib/conversation-store";
import { FIELD_LABEL, emptyDraft, keepTouched, mergeDraft, missingFields, normalizeDraft, type IntakeState } from "@/lib/intake";
import type { ChatMessage, EstimateRequest, IntakeDraft } from "@/lib/types";
import { uid } from "@/lib/utils";

type Status = "idle" | "connecting" | "live" | "ended";
type Mode = "openai" | "demo";

interface Line {
  id: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
  /** 文字の相談で話した内容（文字 → 声に切り替えたとき） */
  channel?: "text" | "voice";
  at?: number;
}

/** 保存・AI に渡す発言（話し終わったものだけ） */
function doneLines(lines: Line[]): Line[] {
  return lines.filter((l) => l.final && l.text.trim() && l.text !== "…");
}

function toStored(lines: Line[]): StoredMessage[] {
  return doneLines(lines).map((l) => ({ id: l.id, role: l.role, content: l.text, at: l.at, channel: l.channel ?? "voice" }));
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

/** 英語の技術的なエラー文はお客様向けの言葉に置き換える */
function friendlyError(message?: string): string {
  const m = (message ?? "").trim();
  if (m && /[ぁ-んァ-ン一-龯]/.test(m)) return m;
  return "音声の接続で問題が発生しました。もう一度「音声相談を開始」を押すか、下の入力欄から文字でお話しください。";
}

/** 音声の接続の問題を管理画面の「エラー履歴」に記録する（失敗しても何もしない） */
function reportError(where: string, message: string) {
  void fetch("/api/errors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "realtime", where, message }) }).catch(() => undefined);
}

const emptyIntake = (): IntakeState => ({ active: false, draft: emptyDraft() });

/** 伺い済みの内容（つなぎ直したときに AI へ渡し、聞き直さないようにする） */
function knownInfo(d: IntakeDraft): string {
  const parts = [
    d.name ? `${FIELD_LABEL.name}：${d.name}` : "",
    d.address ? `${FIELD_LABEL.address}：${d.address}` : "",
    d.phone ? `${FIELD_LABEL.phone}：${d.phone}` : "",
    d.dates.length ? `${FIELD_LABEL.dates}：${d.dates.join("、")}` : "",
  ].filter(Boolean);
  return parts.length ? `\n見積依頼のために伺い済みの内容（聞き直さない）：${parts.join("／")}` : "";
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
  // 見積依頼で伺った内容の下書き（文字の相談と共有し、この端末に会話と一緒に保存）
  const [intake, setIntake] = useState<IntakeState>(emptyIntake);
  const [draftLoading, setDraftLoading] = useState(false);
  const intakeRef = useRef(intake);
  intakeRef.current = intake;
  const [lastEstimate, setLastEstimate] = useState<EstimateRequest | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [micOk, setMicOk] = useState(true);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);

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
  const restoredRef = useRef(false);
  const reconnectRef = useRef(0); // 自動のつなぎ直し（開始ごとに 1 回まで）
  const userEndedRef = useRef(false);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const dirtyRef = useRef(false);
  const savedSigRef = useRef("");

  useEffect(() => {
    linesRef.current = lines;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    if (!restoredRef.current) return;
    // この端末に保存（文字の相談と共通）＋会話ログにも保存（接続が切れても残る）
    const stored = toStored(lines);
    if (!stored.length) return;
    // 話している途中（文字が少しずつ届く間）は保存しない。発言が確定したときだけ保存する
    const sig = `${stored.length}|${stored[stored.length - 1].id}|${stored[stored.length - 1].content.length}`;
    if (sig === savedSigRef.current) return;
    savedSigRef.current = sig;
    if (!sessionIdRef.current) sessionIdRef.current = `voice_${uid()}`;
    saveConversation({ id: sessionIdRef.current, estimateId: estimateIdRef.current, intake: intakeRef.current, messages: stored });
    if (stored.some((m) => m.channel === "voice")) {
      dirtyRef.current = true;
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => void saveTranscript(), 1500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  // 伺った内容が変わったら保存（文字の相談に切り替えても確認画面に入る）
  useEffect(() => {
    if (!restoredRef.current || !sessionIdRef.current) return;
    const stored = toStored(linesRef.current);
    if (stored.length) saveConversation({ id: sessionIdRef.current, estimateId: estimateIdRef.current, intake, messages: stored });
  }, [intake]);

  // 通話時間の表示
  useEffect(() => {
    if (status !== "live") {
      if (status !== "ended") setStartedAt(null);
      return;
    }
    const t0 = Date.now();
    setStartedAt((prev) => prev ?? t0);
    setNow(t0);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    warmUpVoices();
    // 前回の会話（文字の相談を含む）があれば表示して、続きから話せるようにする
    const saved = loadConversation();
    if (saved) {
      sessionIdRef.current = saved.id;
      estimateIdRef.current = saved.estimateId;
      const restored: Line[] = saved.messages.map((m) => ({ id: m.id, role: m.role, text: m.content, final: true, channel: m.channel ?? "text", at: m.at }));
      linesRef.current = restored;
      setLines(restored);
      if (saved.intake) {
        intakeRef.current = saved.intake;
        setIntake(saved.intake);
      }
    }
    restoredRef.current = true;
    return () => {
      window.clearTimeout(saveTimerRef.current);
      // 保存待ちの会話ログはページを離れるときに送る
      if (dirtyRef.current && sessionIdRef.current) {
        try {
          const body = JSON.stringify({ id: sessionIdRef.current, channel: "web_voice", messages: transcriptMessages(), estimateId: estimateIdRef.current, meta: { mode: modeRef.current } });
          navigator.sendBeacon?.("/api/conversations", new Blob([body], { type: "application/json" }));
        } catch {
          // noop
        }
      }
      void endSession(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upsertLine = useCallback((id: string, role: Line["role"], text: string, final: boolean, append = false) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.id === id);
      if (idx < 0) return [...prev, { id, role, text, final, channel: "voice", at: Date.now() }];
      const copy = [...prev];
      copy[idx] = { ...copy[idx], text: append ? copy[idx].text + text : text, final };
      return copy;
    });
  }, []);

  const sendEvent = (ev: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") dc.send(JSON.stringify(ev));
  };

  const transcriptMessages = (): ChatMessage[] =>
    doneLines(linesRef.current).map((l) => ({ role: l.role, content: l.text, at: l.at ? new Date(l.at).toISOString() : undefined }));

  const saveTranscript = async () => {
    const msgs = transcriptMessages();
    if (!sessionIdRef.current || msgs.length === 0) return;
    dirtyRef.current = false;
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
      // AI が伺った内容を下書きに入れて確認画面を開く（足りない項目・ご相談内容の要約は会話全体から読み取って補う）
      const heard = normalizeDraft({ name: args.name, address: args.address, phone: args.phone, dates: args.preferred_dates, summary: args.summary });
      const cur = intakeRef.current;
      const next: IntakeState = { ...cur, active: false, ready: true, draft: keepTouched(mergeDraft(cur.draft, heard), cur.draft, cur.touched) };
      intakeRef.current = next;
      setIntake(next);
      void openEstimate();
      const missing = missingFields(next.draft).map((f) => FIELD_LABEL[f]);
      output = JSON.stringify({
        ok: true,
        message: missing.length
          ? `画面に確認画面を表示しました。${missing.join("・")}はまだ伺えていないので、お客様に伺うか、画面で入力していただくよう短く案内してください。`
          : "画面に確認画面を表示しました。お客様に、内容を確認して（修正があれば直して）送信ボタンを押すよう短く案内してください。日程は確定ではなく、担当者よりお電話でご相談して決めることも伝えてください。",
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
            if (idx < 0) return [...prev, { id: ev.item_id!, role: "user", text: ev.delta ?? "", final: false, channel: "voice", at: Date.now() }];
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
        reportError("声の相談（AIとの通信）", `${code ? `${code}: ` : ""}${ev.error?.message ?? ""}`);
        setError(friendlyError(ev.error?.message));
        break;
      }
      default:
        break;
    }
  }

  async function startRealtime(info: SessionInfo) {
    const prior = toStored(linesRef.current);
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
      if (prior.length) {
        // 接続が切れたあと・文字の相談からの続き：それまでの会話を渡して、聞き直さずに続ける
        sendEvent({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "system",
            content: [
              {
                type: "input_text",
                text: `これまでのお客様との相談内容です（最後のご質問まで回答済み）。この続きとして対応し、同じことを聞き直したり、前の回答を繰り返したりしないでください。\n${transcriptForAi(prior)}${knownInfo(intakeRef.current.draft)}`,
              },
            ],
          },
        });
        sendEvent({
          type: "response.create",
          response: {
            instructions:
              "接続し直したところです。「お待たせしました。先ほどの続きからお伺いします。」と一言だけ伝えて、お客様のお話を待ってください。前の回答は繰り返さず、この発話ではツールも使わないでください。",
          },
        });
        return;
      }
      sendEvent({
        type: "response.create",
        response: {
          instructions: `「こんにちは、畳の${company}のAI相談員です。畳や襖、障子、網戸のことなら何でもお聞きください。」のように、短く挨拶してご用件を伺ってください。`,
        },
      });
    };
    const dropped = () => {
      if (liveRef.current && !userEndedRef.current) void handleDrop();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") dropped();
    };
    dc.onclose = dropped;
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

  /** 通話中に接続が切れたとき：会話を保存して 1 回だけ自動でつなぎ直す（それまでの会話の続きから） */
  async function handleDrop() {
    reportError("声の相談（通話中に切断）", `接続が切れました（自動のつなぎ直し${reconnectRef.current < 1 ? "を実行" : "は済み・お客様の操作待ち"}）`);
    await endSession(true);
    if (reconnectRef.current < 1) {
      reconnectRef.current += 1;
      setReconnecting(true);
      await start(true);
      setReconnecting(false);
      return;
    }
    setError("音声の接続が切れました。「続きから話す」を押すと、これまでの会話の続きからお話しできます。");
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
        draft?: IntakeDraft;
        formReady?: boolean;
        sources?: { title: string }[];
        session?: unknown;
        error?: string;
      };
      if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      if (j.session) agentSessionObjRef.current = j.session;
      // 伺った内容を下書きに入れ、そろったら確認画面を表示する（受付はお客様が画面で送信したとき）
      if (j.draft) {
        const heard = normalizeDraft(j.draft);
        const cur = intakeRef.current;
        const next: IntakeState = { ...cur, ready: j.formReady === true || cur.ready, draft: keepTouched(mergeDraft(cur.draft, heard), cur.draft, cur.touched) };
        intakeRef.current = next;
        setIntake(next);
      }
      if (j.formReady) void openEstimate();
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
      void e;
      await say("申し訳ありません、通信がうまくいきませんでした。もう一度お話しください。");
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
    const prior = toStored(linesRef.current);
    const res = await fetch("/api/agent/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 続きから：同じ会話ログの ID と、それまでの会話を渡す（伺い済みの内容もあわせて）
      body: JSON.stringify({
        channel: "web_voice",
        sessionId: sessionIdRef.current,
        history: prior.map((m) => ({ role: m.role, content: m.content })),
        draft: intakeRef.current.draft,
      }),
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

  /** 新しい相談にする（この端末に保存した会話も消す） */
  function newConversation() {
    if (doneLines(linesRef.current).length && !window.confirm("これまでの会話を消して、新しい相談を始めますか？")) return false;
    clearConversation();
    linesRef.current = [];
    setLines([]);
    setSources([]);
    setLastEstimate(null);
    setIntake(emptyIntake());
    intakeRef.current = emptyIntake();
    estimateIdRef.current = undefined;
    sessionIdRef.current = "";
    setStatus("idle");
    setError("");
    return true;
  }

  /** 開始（それまでの会話があれば続きから）。auto は接続が切れたあとの自動のつなぎ直し */
  async function start(auto = false) {
    setError("");
    if (!auto) reconnectRef.current = 0;
    userEndedRef.current = false;
    setSources([]);
    handledCalls.current = new Set();
    responseActiveRef.current = false;
    recFatalRef.current = false;
    if (!sessionIdRef.current) sessionIdRef.current = `voice_${uid()}`;
    setStartedAt(null);
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
          reportError("声の相談の接続（簡易音声モードに切り替え）", msg);
          await endSession(false);
        }
      }
      modeRef.current = "demo";
      setMode("demo");
      await startDemo();
    } catch (e) {
      setError(friendlyError((e as Error).message));
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

  /**
   * 確認画面を開く。伺った内容はすぐに表示し、足りない項目・ご相談内容（要約）は会話全体から読み取って入れる
   * （AI がすべて伺い、要約のあとに会話が増えていなければ読み取り直さない）
   */
  async function openEstimate() {
    setEstimateOpen(true);
    const history = transcriptMessages().map((m) => ({ role: m.role, content: m.content }));
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
      const j = (await res.json()) as { ok: boolean; draft?: IntakeDraft };
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
    estimateIdRef.current = est.id;
    // 次のご依頼のために、お名前・ご連絡先だけ残す（ご希望日時・ご相談内容は新しく伺う）
    const prev = intakeRef.current.draft;
    const next: IntakeState = { active: false, draft: { name: prev.name, address: prev.address, phone: prev.phone, dates: [] } };
    intakeRef.current = next;
    setIntake(next);
    if (sessionIdRef.current) saveConversation({ id: sessionIdRef.current, estimateId: est.id, intake: next, messages: toStored(linesRef.current) });
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

  const fallback = initialMode === "openai" && mode === "demo" && Boolean(reason);
  const live = status === "live";
  const hasHistory = doneLines(lines).length > 0;
  const talking = live && (aiSpeaking || userSpeaking || Boolean(interim));

  const statusLabel = (() => {
    if (status === "connecting") return reconnecting ? "接続し直しています…" : "接続しています…";
    if ((status === "idle" || status === "ended") && hasHistory) return status === "ended" ? "会話を終了しました。続きから話せます" : "前回の会話の続きからお話しできます";
    if (status === "idle") return "「音声相談を開始」を押して、話しかけてください";
    if (status === "ended") return "会話を終了しました。もう一度開始できます";
    if (aiSpeaking) return "AIがお話ししています";
    if (userSpeaking || interim) return "聞き取っています…";
    if (listening || mode === "openai") return "どうぞ、お話しください";
    if (!micOk) return "下の入力欄から、文字で話しかけてください";
    return "回答を準備しています…";
  })();

  const statusHint = (() => {
    if (status === "connecting") return reconnecting ? "これまでの会話は残っています。少しお待ちください" : "マイクの使用を求められたら「許可」を押してください";
    if (!live && hasHistory) return "これまでの会話は右側（スマホでは下）に残っています。文字で続けることもできます";
    if (!live) return "通話料はかかりません。静かな場所でお使いください";
    if (aiSpeaking) return mode === "openai" ? "途中で話しかけると、AIは話をやめて聞き取ります" : "丸をタップすると読み上げを止められます";
    if (userSpeaking || interim) return "話し終わると、AIがお答えします";
    return "例：「6畳の畳の表替えはいくら？」「見積をお願いしたい」";
  })();

  const orb = !live
    ? status === "connecting"
      ? "bg-ichi-green/60"
      : "bg-sumi-300"
    : aiSpeaking
      ? "bg-gradient-to-br from-ichi-green to-ichi-theme"
      : userSpeaking || interim
        ? "bg-gradient-to-br from-[#f2b705] to-[#d98c00]"
        : "bg-gradient-to-br from-[#6fb35a] to-ichi-green";

  const clock = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const clockLabel = `${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]" data-mode={mode} data-status={status}>
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
      <section className="card flex flex-col items-center rounded-2xl px-5 pb-6 pt-5 sm:px-8" aria-label="声でAI相談">
        <div className="flex w-full items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm font-bold text-ichi-theme">
            <AiAvatar size="h-8 w-8" />
            一畳屋 AI相談員
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
              live ? "bg-ichi-green text-white" : status === "connecting" ? "bg-ichi-cream text-ichi-theme" : "bg-sumi-100 text-sumi-500"
            }`}
            aria-live="polite"
          >
            {live ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> : null}
            {live ? `通話中 ${clockLabel}` : status === "connecting" ? "接続中" : status === "ended" ? "終了" : "待機中"}
          </span>
        </div>

        <button
          type="button"
          onClick={live ? interruptDemoSpeech : undefined}
          className={`relative mt-8 grid h-48 w-48 place-items-center rounded-full ${live && mode === "demo" ? "cursor-pointer" : "cursor-default"}`}
          aria-label={statusLabel}
          tabIndex={live && mode === "demo" ? 0 : -1}
        >
          {talking ? (
            <>
              <span className={`absolute inset-2 rounded-full opacity-40 animate-pulseRing ${orb}`} />
              <span className={`absolute inset-2 rounded-full opacity-30 animate-pulseRing [animation-delay:0.55s] ${orb}`} />
            </>
          ) : live ? (
            <span className={`absolute inset-4 rounded-full opacity-20 animate-pulse ${orb}`} />
          ) : null}
          <span className={`relative grid h-36 w-36 place-items-center rounded-full text-white shadow-lift transition-colors duration-300 ${orb}`}>
            {status === "connecting" ? (
              <Loader2 className="h-12 w-12 animate-spin" />
            ) : talking ? (
              <span className="flex h-12 items-center gap-1.5" aria-hidden>
                {[0, 0.15, 0.3, 0.45, 0.6].map((d) => (
                  <span key={d} className="h-full w-1.5 origin-center animate-voiceBar rounded-full bg-white/95" style={{ animationDelay: `${d}s` }} />
                ))}
              </span>
            ) : muted ? (
              <MicOff className="h-12 w-12" />
            ) : (
              <Mic className="h-12 w-12" />
            )}
          </span>
        </button>

        <p className="mt-5 min-h-[1.75rem] text-center text-base font-bold text-sumi-800">{statusLabel}</p>
        <p className="mt-0.5 min-h-[1.25rem] text-center text-xs text-sumi-500">{statusHint}</p>
        {interim ? <p className="mt-2 max-w-sm text-center text-sm text-sumi-500">「{interim}」</p> : null}

        <div className="mt-6 flex w-full max-w-sm flex-col items-stretch gap-2.5">
          {status === "idle" || status === "ended" ? (
            <button type="button" className="btn-primary py-3.5 text-base" onClick={() => void start()}>
              <Mic className="h-5 w-5" />
              {hasHistory ? "続きから話す" : "音声相談を開始"}
            </button>
          ) : status === "connecting" ? (
            <button type="button" className="btn-primary py-3.5 text-base" disabled>
              <Loader2 className="h-5 w-5 animate-spin" />
              {reconnecting ? "接続し直しています…" : "接続しています…"}
            </button>
          ) : (
            <div className="flex gap-2.5">
              {mode === "openai" ? (
                <button type="button" className="btn-secondary flex-1 py-3" onClick={toggleMute} aria-pressed={muted}>
                  {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  {muted ? "ミュート解除" : "ミュート"}
                </button>
              ) : null}
              <button
                type="button"
                className="btn-accent flex-1 py-3"
                onClick={() => {
                  userEndedRef.current = true;
                  void endSession();
                }}
              >
                <PhoneOff className="h-4 w-4" />
                終了する
              </button>
            </div>
          )}
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-ichi-red px-5 py-2.5 text-sm font-bold text-ichi-red transition hover:bg-shu-50 disabled:opacity-50"
            onClick={openEstimate}
            disabled={status === "connecting"}
          >
            <ClipboardCheck className="h-4 w-4" />
            見積依頼（内容確認）
          </button>
          {hasHistory ? (
            <div className="flex items-center justify-center gap-4 pt-0.5 text-xs font-bold">
              <Link
                href="/chat"
                className="inline-flex items-center gap-1 text-ichi-green underline-offset-2 hover:underline"
                onClick={() => {
                  // 会話はこの端末に保存済み。通話中なら終了してから文字の相談へ
                  userEndedRef.current = true;
                  if (liveRef.current) void endSession();
                }}
              >
                <MessageSquareText className="h-3.5 w-3.5" />
                この続きを文字で相談する
              </Link>
              {!live && status !== "connecting" ? (
                <button type="button" className="inline-flex items-center gap-1 text-sumi-500 underline-offset-2 hover:underline" onClick={newConversation}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  新しい相談にする
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <form
          className="mt-5 flex w-full max-w-sm items-center gap-2 rounded-full border border-sumi-200 bg-white py-1 pl-4 pr-1 transition focus-within:border-ichi-green has-[:disabled]:bg-sumi-50"
          onSubmit={(e) => {
            e.preventDefault();
            submitTyped();
          }}
        >
          <Keyboard className="h-4 w-4 shrink-0 text-sumi-400" />
          <input
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[16px] text-sumi-800 outline-none placeholder:text-sumi-400 disabled:cursor-not-allowed sm:text-sm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={micOk ? "マイクが使えないときは、ここに文字で入力" : "テキストで話しかける"}
            disabled={!live}
            aria-label="文字で話しかける"
          />
          <button type="submit" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ichi-green text-white disabled:bg-sumi-200" disabled={!live || !typed.trim()} aria-label="送信">
            <Send className="h-3.5 w-3.5" />
          </button>
        </form>

        {error ? <p className="mt-4 w-full max-w-sm rounded-xl border border-shu-200 bg-shu-50 px-3 py-2 text-xs leading-relaxed text-shu-700">{error}</p> : null}
        {fallback ? (
          <p className="mt-3 w-full max-w-sm rounded-xl bg-ichi-cream px-3 py-2 text-xs leading-relaxed text-sumi-600" title={reason}>
            音声の接続が不安定なため、簡易音声モードでお話ししています（聞き取りの精度が下がる場合があります）。
          </p>
        ) : null}
        {lastEstimate ? (
          <p className="mt-4 flex w-full max-w-sm items-start gap-1.5 rounded-xl bg-ichi-cream px-3 py-2 text-xs text-ichi-theme">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            お見積りのご依頼を受付しました（受付番号：{lastEstimate.id}）。担当者より折り返しご連絡します。
          </p>
        ) : null}

        {!live && status !== "connecting" && !hasHistory ? (
          <ol className="mt-6 grid w-full gap-2 border-t border-sumi-100 pt-5 text-xs text-sumi-600 sm:grid-cols-3">
            {[
              { icon: Mic, t: "「音声相談を開始」を押す" },
              { icon: ShieldCheck, t: "マイクの使用を「許可」する" },
              { icon: MessagesSquare, t: "電話のように話しかける" },
            ].map((s, i) => (
              <li key={s.t} className="flex items-center gap-2.5 rounded-xl bg-[#fbfaf5] px-3 py-2.5 sm:flex-col sm:text-center">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ichi-cream text-ichi-green">
                  <s.icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="mr-1 font-bold text-ichi-green">{i + 1}.</span>
                  {s.t}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </section>

      <section className="card flex h-[440px] flex-col overflow-hidden rounded-2xl lg:h-auto lg:min-h-[600px]" aria-label="会話の内容">
        <header className="flex items-center justify-between gap-2 border-b border-black/[0.06] px-4 py-3">
          <p className="text-sm font-bold text-sumi-800">会話の内容</p>
          <span className="text-[11px] text-sumi-400">話した内容は文字でも表示されます</span>
        </header>
        <div ref={listRef} role="log" aria-live="polite" className="flex-1 space-y-4 overflow-y-auto bg-[#fbfaf5] px-4 py-4">
          {lines.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-ichi-cream text-ichi-green">
                <MessagesSquare className="h-6 w-6" />
              </span>
              <p className="mt-3 text-sm font-bold text-sumi-700">ここに会話が表示されます</p>
              <p className="mt-1 text-xs leading-relaxed text-sumi-500">
                たとえば「6畳の畳の表替えはいくらですか？」
                <br />
                「網戸の張替えは何日かかりますか？」「見積をお願いしたい」
              </p>
            </div>
          ) : null}
          {lines.map((l, i) => {
            const textEnds = l.channel === "text" && lines[i + 1] && lines[i + 1].channel !== "text";
            const divider = textEnds ? (
              <p key={`${l.id}-handoff`} className="flex items-center gap-2 text-[11px] font-bold text-ichi-green" data-handoff>
                <span className="h-px flex-1 bg-ichi-green/25" />
                <Mic className="h-3.5 w-3.5" />
                ここから声の相談
                <span className="h-px flex-1 bg-ichi-green/25" />
              </p>
            ) : null;
            const tag =
              l.channel === "text" ? (
                <span className="mt-1 inline-flex items-center gap-0.5 text-[10px] text-sumi-400" data-channel="text">
                  <MessageSquareText className="h-3 w-3" />
                  文字の相談
                </span>
              ) : null;
            const bubble =
              l.role === "user" ? (
              <div key={l.id} className="flex flex-col items-end">
                <div
                  data-role="user"
                  className={`bubble max-w-[85%] rounded-2xl rounded-tr-md bg-ichi-green px-4 py-2.5 text-[15px] leading-relaxed text-white shadow-sm ${l.final ? "" : "opacity-75"}`}
                >
                  {l.text}
                </div>
                {tag}
              </div>
            ) : (
              <div key={l.id} className="flex gap-2.5">
                <span className="mt-0.5">
                  <AiAvatar size="h-8 w-8" />
                </span>
                <div
                  data-role="assistant"
                  className={`bubble min-w-0 max-w-[85%] rounded-2xl rounded-tl-md border border-black/[0.06] bg-white px-4 py-2.5 text-[15px] leading-relaxed text-sumi-800 shadow-sm ${l.final ? "" : "opacity-80"}`}
                >
                  <RichText text={l.text} />
                  {tag}
                </div>
              </div>
            );
            return divider ? [bubble, divider] : bubble;
          })}
        </div>
        {sources.length > 0 ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-black/[0.06] px-4 py-2 text-[11px] text-sumi-400">
            {sources.slice(0, 3).map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-ichi-green" />
                参考：{s.replace(/^.*｜/, "")}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <Modal open={estimateOpen} onClose={() => setEstimateOpen(false)} title="見積依頼（内容の確認・送信）">
        <EstimateForm
          channel="web_voice"
          sessionId={sessionIdRef.current}
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
