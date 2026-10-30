"use client";

// 声で話す（相談の画面の中のマイク）。OpenAI Realtime（WebRTC）で電話のように話せる。使えない環境ではブラウザの音声認識・読み上げ
//   ・話した内容・AI の答えは、文字の相談と同じ会話（同じ吹き出しの並び）に入る（host.upsert）
//   ・始めるときは、それまでの会話（文字で話した内容を含む）を AI に渡し、聞き直さずに続ける
//   ・接続が切れたら自動で 1 回つなぎ直す（会話の続きから）
//   ・AI の声が途中で切れないように・遠くの話し声を拾わないように、マイクは関所（voice-gate.ts）を通して送る（GPT-Live・Realtime とも）
//   ・確認画面の案内・送信のお礼は一度だけ（声の AI への知らせは一度だけのもの。確認画面は開き直さない）
import { useEffect, useRef, useState } from "react";
import { LINKS } from "@/lib/brand";
import { transcriptForAi, type StoredMessage } from "@/lib/conversation-store";
import { FIELD_LABEL, asksForForm, intakeFields, keepTouched, mergeDraft, missingFields, normalizeDraft, saysFormShown, type IntakeState } from "@/lib/intake";
import { OFFER_AFTER_ANSWER, OFFER_NOT_YET_VOICE, offerDue, offerTooEarly } from "@/lib/offer";
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
import { isPromptEcho } from "@/lib/transcribe";
import type { EstimateRequest, IntakeDraft } from "@/lib/types";
import { uid } from "@/lib/utils";
import { createVoiceGate, unlockAudioContext, type VoiceGate } from "@/lib/voice-gate";

/** 割り込んだ直後に始まった発話は、割り込み（AI を止めて話した）として扱う */
const BARGE_SPEECH_MS = 3000;
/**
 * AI の声が流れ終わったかの見張り（WebRTC の受信の統計の音量）。gpt-realtime-2.1 は「再生が終わった」の知らせを送らず、
 * 受信した音声を音の処理に回せないブラウザもあるため、どちらでも AI の発話の終わりがわかるように
 */
const PLAYBACK_POLL_MS = 250;
const PLAYBACK_LEVEL = 0.01;
const PLAYBACK_TAIL_MS = 1500;

export type VoiceStatus = "idle" | "connecting" | "live" | "ended";
export type VoiceMode = "openai" | "demo";

export interface VoiceHost {
  company: string;
  /** これまでの会話（話し終わったもの）。声を始めるときに AI へ渡す */
  getConversation: () => StoredMessage[];
  /** 声の発言を会話に入れる・更新する（final=false は話している途中。append は届いた文字を足す） */
  upsert: (id: string, role: "user" | "assistant", text: string, final: boolean, append?: boolean) => void;
  remove: (id: string) => void;
  getIntake: () => IntakeState;
  setIntake: (next: IntakeState) => void;
  /** AI が調べた資料の見出し（いま話している答えの根拠） */
  onSources: (titles: string[]) => void;
  /** 見積の確認画面を開く（AI がお名前・ご連絡先・ご希望日時を伺い終えたとき） */
  openEstimate: () => void;
  /** 確認画面がいま開いているか・この相談で送信が済んだ受付（開き直さない・送信の案内をくり返さないため） */
  getEstimateState: () => { open: boolean; submittedId?: string };
  /** 簡易音声モードの受付エージェントが受け付けた */
  onEstimate: (est: EstimateRequest) => void;
  /** 声の会話が一区切りしたとき（会話ログに保存する） */
  onSettled: () => void;
  /** スプレッドシートの読み方の一覧（声の AI がひらがなで書いた字幕を、画面では漢字に戻す） */
  onReadings?: (readings: [string, string][]) => void;
}

interface SessionInfo {
  mode: VoiceMode;
  /** live＝GPT-Live（既定）・realtime＝Realtime API */
  engine?: "live" | "realtime";
  reason?: string;
  clientSecret?: string;
  model?: string;
  api?: "ga" | "beta";
  /** スプレッドシートの読み方の一覧（字幕を漢字に戻す） */
  readings?: [string, string][];
}

/** GPT-Live のデータチャンネルのイベント（使うものだけ） */
interface LiveEvent {
  type: string;
  delta?: string;
  error?: { message?: string; code?: string };
  event?: { type?: string; item?: { type?: string; call_id?: string; name?: string; arguments?: string } };
}

/** お客様が話している間の、AI の相づちだけの発言（会話の吹き出しには残さない） */
const BACKCHANNEL = /^(はい|ええ|うん|なるほど|そうですね|そうなんですね)[、。！!…\s]*$/;
/** この時間、どちらの発言の文字も届かなければ、吹き出しを区切る */
const LIVE_SETTLE_MS = 1500;
/** 文の終わり（ここで切れた AI の吹き出しには、続きを足さない） */
const SENTENCE_END = /[。？！?!」]\s*$/;
/**
 * アプリが確認画面を開いたときの、声の AI への知らせ（最初から聞き直さないように。一畳屋様のご指摘 2026-10-28 EST-20261028-QHOX）。
 * 一度だけの知らせとして渡す（GPT-Live の session.instructions.append は、そのあともずっと指示として残るので、
 * 「送信ボタンを押してください」の案内を何度もくり返した。一畳屋様のご指摘 2026-10-30「このアナウンスが 10 回ぐらい繰り返された」）
 */
const FORM_OPENED_NOTICE =
  "お客様の画面に確認画面を表示しました（会話から読み取った内容が入っています。足りない項目は、お客様が画面で入力できます）。最初から聞き直さないでください。まだ伝えていなければ、画面の内容を確認して送信ボタンを押していただくよう一度だけ短く伝え、そのあとは同じ案内をくり返さずに、お客様が送信されるか話しかけられるまで待ってください。";
/** 確認画面の「ご確認のうえ、送信ボタンを押してください」の案内（声の AI はひらがなの「そうしん」でも話す） */
const FORM_ANNOUNCE = /(?:ご確認|ご覧|確かめ).{0,60}(?:送信|そうしん)|(?:送信|そうしん)(?:ボタン)?.{0,12}(?:押して|お願い)/;
/** AI が確認画面の案内をくり返したときの知らせ */
const FORM_HUSH_NOTICE =
  "確認画面の案内は、もうお伝えしています。同じ案内（画面の内容をご確認ください・送信ボタンを押してください）をくり返さないでください。お客様が送信されるか、話しかけられるまで、黙って待ってください。";
/** 送信が済んだあとに、もう一件のご依頼をはっきり希望された（このときだけ確認画面を開き直す） */
const ANOTHER_REQUEST = /もう一件|もう1件|もう一つ|もう1つ|別の(?:見積|依頼|場所|部屋|工事)|追加で|ほかにも(?:見積|お願い|依頼)|新しく(?:見積|依頼)/;
/** マイクの設定（回り込み・雑音を除く。声だけを拾う設定がある端末では、それも使う） */
const MIC_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, voiceIsolation: true } as MediaTrackConstraints;

/** GPT-Live の文字起こしから、声でない音の印（[hum] など）を除く（届き途中の「[hu」も隠す） */
function liveCaption(text: string): string {
  return text
    .replace(/\[[^\]\n]{0,24}\]/g, "")
    .replace(/\[[^\]\n]{0,24}$/, "")
    .replace(/[ \t]{2,}/g, " ");
}

interface RtEvent {
  type: string;
  item_id?: string;
  transcript?: string;
  delta?: string;
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
  /** 2 回聞き直しても正しく聞き取れなかった項目（確認画面の「修正」から入力していただく） */
  unsure_fields?: string[];
  /** check_address：お客様が発音した町名の読み */
  town_reading?: string | null;
}

/** 英語の技術的なエラー文はお客様向けの言葉に置き換える */
function friendlyError(message?: string): string {
  const m = (message ?? "").trim();
  if (m && /[ぁ-んァ-ン一-龯]/.test(m)) return m;
  return "音声の接続で問題が発生しました。もう一度マイクのボタンを押すか、文字で入力してください。";
}

/** 音声の接続の問題を管理画面の「エラー履歴」に記録する（失敗しても何もしない） */
function reportError(where: string, message: string) {
  void fetch("/api/errors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "realtime", where, message }) }).catch(() => undefined);
}

/**
 * 伺い済みの内容（声を始めるときに AI へ渡し、聞き直さないようにする）。
 * お客様がいま違う内容をおっしゃったら、そちらに置き換える（以前に伺った住所を AI が言い張らないように：
 * 2026-10-26 一畳屋様のご指摘「坪井と伝えても水前寺ですねと返され、訂正しても直らない」）
 */
function knownInfo(d: IntakeDraft): string {
  const parts = [
    d.name ? `${FIELD_LABEL.name}：${d.name}` : "",
    d.address ? `${FIELD_LABEL.address}：${d.address}` : "",
    d.phone ? `${FIELD_LABEL.phone}：${d.phone}` : "",
    d.dates.length ? `${FIELD_LABEL.dates}：${d.dates.join("、")}` : "",
  ].filter(Boolean);
  return parts.length
    ? `\n見積依頼のために以前に伺った内容（同じことは聞き直さない。お客様がいま違う内容をおっしゃったら、必ずそちらに置き換え、以前の内容は使わない）：${parts.join("／")}`
    : "";
}

export function useVoiceSession(host: VoiceHost, initialMode: VoiceMode) {
  const hostRef = useRef(host);
  hostRef.current = host;
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [mode, setMode] = useState<VoiceMode>(initialMode);
  const [reason, setReason] = useState("");
  const [interim, setInterim] = useState("");
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [micOk, setMicOk] = useState(true);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  // AI の声を流せなかった（ブラウザが音を出すのを止めた）：画面の「音を出す」を押していただく（一畳屋様のご指摘 2026-10-30「音が出ない（エクスペリア）」）
  const [audioBlocked, setAudioBlocked] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<Recognizer | null>(null);
  const liveRef = useRef(false);
  const modeRef = useRef<VoiceMode>(initialMode);
  const busyRef = useRef(false);
  const speakingRef = useRef(false);
  const conversationIdRef = useRef(""); // 会話ログの ID（簡易音声モードの受付エージェントにも同じ ID を使う）
  const agentSessionRef = useRef("");
  const agentSessionObjRef = useRef<unknown>(null); // 簡易音声モード：セッションを往復させる（サーバーレス対策）
  const handledCalls = useRef<Set<string>>(new Set());
  const responseActiveRef = useRef(false); // Realtime：モデルが応答中か
  const recFatalRef = useRef(false); // 簡易音声モード：音声認識が使えない環境では自動再開しない
  const pendingRef = useRef<string | null>(null); // 簡易音声モード：応答中に入力された発話
  const reconnectRef = useRef(0); // 自動のつなぎ直し（開始ごとに 1 回まで）
  const userEndedRef = useRef(false);
  // 割り込みの判定（AI の声が、相づち「はい」・咳・雑音・スピーカーの回り込みで途切れないように）
  const aiAudioRef = useRef(false);
  const aiAudioSinceRef = useRef(0);
  const playbackTimerRef = useRef<number | undefined>(undefined);
  const speechRef = useRef<{ duringAi: boolean; bargedIn: boolean } | null>(null);
  const ignoredItemsRef = useRef<Set<string>>(new Set());
  const pendingCreateRef = useRef(false);
  const mutedRef = useRef(false);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const gateRef = useRef<VoiceGate | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastBargeRef = useRef(-1e9);
  // 話している途中の発言（確定したら会話に残す・文字にならなかったら消す）
  const userItemsRef = useRef<Set<string>>(new Set());
  // GPT-Live：どの仕組みで話しているか・いまの吹き出し・あいさつ・終了の知らせ
  const engineRef = useRef<"live" | "realtime">("realtime");
  const liveTurnRef = useRef<{
    user: { id: string; last: number } | null;
    ai: { id: string; last: number; text: string; overUser: boolean; closeOnGap?: boolean } | null;
  }>({ user: null, ai: null });
  const liveSettleRef = useRef<number | undefined>(undefined);
  const userSpeakingTimerRef = useRef<number | undefined>(undefined);
  const liveGreetingRef = useRef("");
  const liveStartedRef = useRef<(() => void) | null>(null);
  const liveClosedRef = useRef<(() => void) | null>(null);
  const lastProposeRef = useRef(-1e9);
  // AI が確認画面の案内を話した回数・最後の時刻（くり返したら、くり返さないよう知らせる）
  const formSaidRef = useRef<{ count: number; at: number; hushedAt: number }>({ count: 0, at: -1e9, hushedAt: -1e9 });
  // スタッフ紹介のページのリンクを会話の記録に出したか（通話ごとに一度）
  const staffLinkRef = useRef(false);
  // GPT-Live：お客様の発言の文字（「画面を出して」で確認画面を開くため）
  const userTextRef = useRef<Map<string, string>>(new Map());
  const lastUserRef = useRef<{ id: string; endedAt: number } | null>(null);
  const lastAiRef = useRef<{ id: string; text: string; endedAt: number } | null>(null);

  useEffect(() => {
    warmUpVoices();
    return () => {
      void end(false);
      void audioCtxRef.current?.close().catch(() => undefined);
      audioCtxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendEvent = (ev: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") dc.send(JSON.stringify(ev));
  };

  /**
   * 声の AI に、いまの状況を一度だけ伝える（話させはしない）。GPT-Live は session.thinking.append、Realtime は会話の中の知らせ。
   * session.instructions.append は使わない（そのあともずっと指示として残り、同じ案内をくり返すため）
   */
  function contextNote(text: string) {
    if (modeRef.current !== "openai") return;
    if (engineRef.current === "live") sendEvent({ type: "session.thinking.append", event_id: uid(), delegation_id: null, content: text });
    else sendEvent({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text }] } });
  }

  /**
   * AI がスタッフ紹介のページ（会社・店舗案内）を案内した：声ではアドレスを読まないので、会話の記録にリンクを出す（一度だけ。
   * 一畳屋様のご要望 2026-10-30「スタッフのことを聞かれたらスタッフ紹介ページのリンク貼る」）
   */
  function staffLink(text: string) {
    if (staffLinkRef.current || !/会社・店舗案内|会社店舗案内|スタッフ(?:の)?紹介/.test(text)) return;
    if (hostRef.current.getConversation().some((m) => m.content.includes(LINKS.staff))) return;
    staffLinkRef.current = true;
    hostRef.current.upsert(uid(), "assistant", `スタッフの紹介（会社・店舗案内）：${LINKS.staff}`, true);
  }

  /** AI の声を流す（流せなければ「音を出す」のボタンを出す） */
  function playRemote(stream: MediaStream) {
    const a = audioRef.current;
    if (!a) return;
    if (a.srcObject !== stream) a.srcObject = stream;
    a.muted = false;
    a.play()
      .then(() => setAudioBlocked(false))
      .catch(() => setAudioBlocked(true));
  }

  /**
   * 「声で話す」を押した直後に、AI の声を流す要素を一度動かしておく（スマホのブラウザは、押した操作の中でないと
   * 音を出させないことがある。あとから届く AI の声は、この要素でそのまま流れる）
   */
  function primeAudio() {
    const a = audioRef.current;
    if (!a) return;
    a.muted = false;
    a.volume = 1;
    try {
      if (!a.srcObject && audioCtxRef.current) a.srcObject = audioCtxRef.current.createMediaStreamDestination().stream;
      void a.play().catch(() => undefined);
    } catch {
      // 動かせなくても、AI の声が届いたときにもう一度流す
    }
  }

  /** 画面の「音を出す」：押した操作の中で、もう一度 AI の声を流す */
  function resumeAudio() {
    void audioCtxRef.current?.resume().catch(() => undefined);
    const a = audioRef.current;
    if (!a) return;
    a.muted = false;
    a.volume = 1;
    a.play()
      .then(() => setAudioBlocked(false))
      .catch(() => setAudioBlocked(true));
  }

  function bargeIn() {
    lastBargeRef.current = performance.now();
    if (speechRef.current) speechRef.current.bargedIn = true;
    interruptAi();
  }

  function stopGate() {
    window.clearInterval(playbackTimerRef.current);
    playbackTimerRef.current = undefined;
    gateRef.current?.close();
    gateRef.current = null;
  }

  /** AI の声が流れている・流れ終わった（OpenAI の知らせ・関所が聞いた音・受信の統計のどれからでも） */
  function setAiAudio(on: boolean) {
    if (aiAudioRef.current === on) return;
    aiAudioRef.current = on;
    if (on) aiAudioSinceRef.current = performance.now();
    gateRef.current?.setAiPlaying(on);
    setAiSpeaking(on);
  }

  /** 受信の統計で AI の声の音量を見張る（関所が受信した音声を聞けない環境・「再生が終わった」の知らせが来ない場合の補い） */
  function watchPlayback(pc: RTCPeerConnection) {
    window.clearInterval(playbackTimerRef.current);
    let prev: { energy: number; duration: number } | null = null;
    let lastHeard = -1e9;
    playbackTimerRef.current = window.setInterval(() => {
      if (pcRef.current !== pc) return;
      pc.getStats()
        .then((stats) => {
          stats.forEach((r: { type?: string; kind?: string; totalAudioEnergy?: number; totalSamplesDuration?: number }) => {
            if (r.type !== "inbound-rtp" || r.kind !== "audio" || typeof r.totalAudioEnergy !== "number" || typeof r.totalSamplesDuration !== "number") return;
            const cur = { energy: r.totalAudioEnergy, duration: r.totalSamplesDuration };
            if (prev && cur.duration > prev.duration && Math.sqrt((cur.energy - prev.energy) / (cur.duration - prev.duration)) > PLAYBACK_LEVEL) lastHeard = performance.now();
            prev = cur;
          });
          const now = performance.now();
          const audible = now - lastHeard < PLAYBACK_TAIL_MS;
          // AI の声が届いているのに流れていない（ブラウザが止めた）：もう一度流す。流せなければ「音を出す」のボタンを出す
          const a = audioRef.current;
          if (audible && a?.srcObject && a.paused) {
            a.play()
              .then(() => setAudioBlocked(false))
              .catch(() => setAudioBlocked(true));
          }
          if (audible && !aiAudioRef.current) setAiAudio(true);
          else if (!audible && aiAudioRef.current && now - aiAudioSinceRef.current > PLAYBACK_TAIL_MS) setAiAudio(false);
        })
        .catch(() => undefined);
    }, PLAYBACK_POLL_MS);
  }

  /** 声を終える（会話はそのまま。文字で続けられる） */
  async function end(settle = true) {
    // GPT-Live：話し途中の吹き出しを確定し、終了を伝えて（使った時間の確定のため）少し待つ
    if (engineRef.current === "live") {
      window.clearTimeout(liveSettleRef.current);
      finishLiveUser();
      finishLiveAi();
      if (dcRef.current?.readyState === "open") {
        const closed = new Promise<void>((resolve) => {
          liveClosedRef.current = resolve;
        });
        sendEvent({ type: "session.close", event_id: uid() });
        await Promise.race([closed, new Promise((r) => setTimeout(r, 2500))]);
      }
    }
    liveRef.current = false;
    pendingRef.current = null;
    stopGate();
    remoteStreamRef.current = null;
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
    // 話している途中で終えた発言（文字になっていない「…」）は消す
    userItemsRef.current.forEach((id) => hostRef.current.remove(id));
    userItemsRef.current.clear();
    userTextRef.current.clear();
    setAiSpeaking(false);
    setListening(false);
    setUserSpeaking(false);
    setInterim("");
    setStartedAt(null);
    setAudioBlocked(false);
    setStatus((s) => (s === "idle" ? "idle" : "ended"));
    if (settle) hostRef.current.onSettled();
  }

  // ---------------- OpenAI Realtime (WebRTC) ----------------

  async function toolOutput(name: string, argsJson: string): Promise<string> {
    let args: ToolArgs = {};
    try {
      args = JSON.parse(argsJson || "{}") as ToolArgs;
    } catch {
      args = {};
    }
    if (name === "search_knowledge") {
      try {
        const intake = hostRef.current.getIntake();
        const conv = hostRef.current.getConversation();
        const busy = intake.active || intake.ready || Boolean(hostRef.current.getEstimateState().submittedId);
        const due = offerDue(conv, args.query ?? "", busy);
        const early = !due && offerTooEarly(conv, args.query ?? "", busy);
        const res = await fetch("/api/knowledge/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: args.query ?? "", k: 4, ...(early ? { offer: "not_yet" } : {}) }),
        });
        const j = (await res.json()) as { answer?: string; hits?: { title: string; content: string; from?: string }[]; sources?: { title: string }[] };
        const hits = j.hits ?? [];
        hostRef.current.onSources((j.sources?.length ? j.sources : hits).map((h) => h.title));
        // 2回目以降の答えで、まだ提案していなければ、答えのあとに無料の訪問見積もりを提案してもらう。最初の答えでは提案しない（offer.ts）
        const offer = early ? { offer_note: OFFER_NOT_YET_VOICE } : due ? { after_answer: OFFER_AFTER_ANSWER } : {};
        // answer（資料の全体を確かめて作った回答・料金表の計算など）があればそれを話す。なければ関係する資料だけを渡す
        return JSON.stringify(
          j.answer
            ? { answer: j.answer, ...offer }
            : {
                results: hits.map((h) => ({ from: h.from, title: h.title, content: h.content })),
                note: hits.length === 0 ? "該当する資料がありません。推測せず、担当者からの折り返しを案内してください。" : undefined,
                ...(hits.length ? offer : {}),
              },
        );
      } catch (e) {
        return JSON.stringify({ error: (e as Error).message });
      }
    }
    if (name === "check_address") {
      // ご住所の町名が熊本県・大牟田市の町名の一覧にあるか（なければ、その市区町村の町名を読みの近い順に）
      try {
        const res = await fetch("/api/address/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: args.address ?? "", town_reading: args.town_reading ?? null }),
        });
        return JSON.stringify(await res.json());
      } catch (e) {
        return JSON.stringify({ error: (e as Error).message, note: "確かめられなかったので、聞き取ったご住所のまま復唱してください" });
      }
    }
    if (name === "propose_estimate_request") {
      const est = hostRef.current.getEstimateState();
      // 送信が済んだ：確認画面を開き直さない（開き直した画面からもう一度送信され、同じ受付が 2 件届いた。一畳屋様のご指摘 2026-10-30）。
      // お客様が、もう一件のご依頼をはっきり希望されたときだけ開く
      const lastUser = [...hostRef.current.getConversation()].reverse().find((m) => m.role === "user")?.content ?? "";
      if (est.submittedId && !ANOTHER_REQUEST.test(lastUser.normalize("NFKC"))) {
        return JSON.stringify({
          ok: false,
          message: `見積依頼は、すでにお客様が送信済みです（受付番号 ${est.submittedId}）。確認画面を出し直したり、送信の案内をくり返したりしないでください。ほかにご質問がないかだけ、短く伺ってください。`,
        });
      }
      // AI が伺った内容を下書きに入れて確認画面を開く（足りない項目・ご相談内容の要約は会話全体から読み取って補う）
      const heard = normalizeDraft({ name: args.name, address: args.address, phone: args.phone, dates: args.preferred_dates, summary: args.summary });
      const cur = hostRef.current.getIntake();
      // 2 回聞き直しても聞き取れなかった項目：確認画面で「修正」から入力していただく（お客様がもう直した項目は除く）
      const unsure = intakeFields(args.unsure_fields).filter((f) => !cur.touched?.includes(f));
      const draft = keepTouched(mergeDraft(cur.draft, heard), cur.draft, cur.touched);
      const next: IntakeState = { ...cur, active: false, ready: true, draft, unsure };
      // もう同じ内容の確認画面が出ている：開き直さず、案内もくり返させない
      const same = est.open && cur.ready && sameDraft(cur.draft, draft) && (cur.unsure ?? []).join() === unsure.join();
      hostRef.current.setIntake(next);
      if (same) {
        return JSON.stringify({
          ok: true,
          message: "確認画面は、もう同じ内容で表示されています。同じ案内はくり返さず、お客様が送信されるか、話しかけられるまで待ってください。",
        });
      }
      hostRef.current.openEstimate();
      const missing = missingFields(next.draft).map((f) => FIELD_LABEL[f]);
      const fix = unsure.length
        ? `${unsure.map((f) => FIELD_LABEL[f]).join("・")}は正確に聞き取れなかったため、画面の${unsure.map((f) => `${FIELD_LABEL[f]}の「修正」ボタン`).join("・")}を押して、正確な内容を入力していただくよう、お願いしてください。`
        : "";
      return JSON.stringify({
        ok: true,
        message: missing.length
          ? `画面に確認画面を表示しました。${missing.join("・")}はまだ伺えていないので、お客様に伺うか、画面で入力していただくよう短く案内してください。${fix}この案内は一度だけにして、くり返さないでください。`
          : `画面に確認画面を表示しました。${fix}お客様に、内容を確認して（修正があれば直して）送信ボタンを押すよう、一度だけ短く案内してください。日程は確定ではなく、担当者よりお電話でご相談して決めることも伝えてください。案内のあとは、くり返さずに、お客様が送信されるか話しかけられるまで待ってください。`,
      });
    }
    return JSON.stringify({ error: `unknown tool: ${name}` });
  }

  /** 応答が完了したら、関数呼び出しを処理して結果を返し、続きの応答を依頼する（応答中に response.create を送らない） */
  async function handleResponseDone(ev: RtEvent) {
    responseActiveRef.current = false;
    const calls = (ev.response?.output ?? []).filter((it) => it.type === "function_call" && it.call_id && it.name && !handledCalls.current.has(it.call_id));
    if (calls.length === 0) {
      if (pendingCreateRef.current) {
        pendingCreateRef.current = false;
        sendEvent({ type: "response.create" });
      }
      hostRef.current.onSettled();
      return;
    }
    calls.forEach((c) => handledCalls.current.add(c.call_id!));
    const outputs = await Promise.all(calls.map((c) => toolOutput(c.name!, c.arguments ?? "{}")));
    calls.forEach((c, i) => {
      sendEvent({ type: "conversation.item.create", item: { type: "function_call_output", call_id: c.call_id, output: outputs[i] } });
    });
    pendingCreateRef.current = false;
    sendEvent({ type: "response.create" });
  }

  function interruptAi() {
    if (responseActiveRef.current) sendEvent({ type: "response.cancel" });
    if (aiAudioRef.current) sendEvent({ type: "output_audio_buffer.clear" });
  }

  function requestResponse() {
    if (responseActiveRef.current) {
      pendingCreateRef.current = true;
      return;
    }
    sendEvent({ type: "response.create" });
  }

  function sendUserText(text: string) {
    interruptAi();
    sendEvent({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
    requestResponse();
  }

  function dropUserItem(id: string) {
    userItemsRef.current.delete(id);
    hostRef.current.remove(id);
  }

  function handleServerEvent(ev: RtEvent) {
    const h = hostRef.current;
    switch (ev.type) {
      case "response.created":
        responseActiveRef.current = true;
        break;
      case "input_audio_buffer.committed": {
        if (!ev.item_id) break;
        const s = speechRef.current;
        speechRef.current = null;
        // AI が話している間の短い音（相づち・咳・雑音）で、AI がまだ話し続けているなら聞き流す（会話からも消す）
        if (s?.duringAi && !s.bargedIn && (aiAudioRef.current || responseActiveRef.current)) {
          ignoredItemsRef.current.add(ev.item_id);
          sendEvent({ type: "conversation.item.delete", item_id: ev.item_id });
          break;
        }
        userItemsRef.current.add(ev.item_id);
        h.upsert(ev.item_id, "user", "…", false);
        requestResponse();
        break;
      }
      case "conversation.item.input_audio_transcription.delta":
        if (ev.item_id && !ignoredItemsRef.current.has(ev.item_id) && userItemsRef.current.has(ev.item_id)) h.upsert(ev.item_id, "user", ev.delta ?? "", false, true);
        break;
      case "conversation.item.input_audio_transcription.completed": {
        if (!ev.item_id || ignoredItemsRef.current.has(ev.item_id)) break;
        const text = ev.transcript?.trim() ?? "";
        // 雑音で、文字起こしが手がかりの文をなぞっただけ：お客様の発言ではないので、会話から消す
        if (isPromptEcho(text)) {
          ignoredItemsRef.current.add(ev.item_id);
          sendEvent({ type: "conversation.item.delete", item_id: ev.item_id });
          dropUserItem(ev.item_id);
          break;
        }
        if (text) {
          userItemsRef.current.delete(ev.item_id);
          h.upsert(ev.item_id, "user", text, true);
          // 「画面を出して」：AI の返事を待たずに、アプリが確認画面を開く
          if (asksForForm(text)) openFormByApp();
        } else dropUserItem(ev.item_id);
        break;
      }
      case "conversation.item.input_audio_transcription.failed":
        if (ev.item_id) dropUserItem(ev.item_id);
        break;
      case "input_audio_buffer.speech_started":
        setUserSpeaking(true);
        speechRef.current = { duringAi: aiAudioRef.current || responseActiveRef.current, bargedIn: performance.now() - lastBargeRef.current < BARGE_SPEECH_MS };
        break;
      case "input_audio_buffer.speech_stopped":
        setUserSpeaking(false);
        break;
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta":
        if (ev.item_id) h.upsert(ev.item_id, "assistant", ev.delta ?? "", false, true);
        break;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        if (ev.item_id) h.upsert(ev.item_id, "assistant", ev.transcript ?? "", true);
        staffLink(ev.transcript ?? "");
        break;
      case "output_audio_buffer.started":
        setAiAudio(true);
        break;
      // 「再生が終わった」（stopped）は gpt-realtime-2.1 では届かない。終わりは関所が聞いた音・受信の統計でも判定する
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        setAiAudio(false);
        break;
      case "response.done":
        void handleResponseDone(ev);
        break;
      case "error": {
        const code = ev.error?.code ?? "";
        if (code === "response_cancel_not_active" || code === "conversation_already_has_active_response") break;
        if (/not_found|invalid_item|item_id/i.test(`${code} ${ev.error?.message ?? ""}`)) break;
        reportError("声の相談（AIとの通信）", `${code ? `${code}: ` : ""}${ev.error?.message ?? ""}`);
        setError(friendlyError(ev.error?.message));
        break;
      }
      default:
        break;
    }
  }

  async function startRealtime(info: SessionInfo) {
    const prior = hostRef.current.getConversation();
    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    pc.ontrack = (e) => {
      playRemote(e.streams[0]);
      remoteStreamRef.current = e.streams[0];
      gateRef.current?.watchRemote(e.streams[0]);
    };
    const ms = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
    streamRef.current = ms;
    stopGate();
    const gate = await createVoiceGate(audioCtxRef.current, ms, { onBargeIn: bargeIn, onAiAudio: setAiAudio });
    gateRef.current = gate;
    if (mutedRef.current) gate.setMuted(true);
    if (remoteStreamRef.current) gate.watchRemote(remoteStreamRef.current);
    pc.addTrack(gate.track, ms);
    watchPlayback(pc);
    const dc = pc.createDataChannel("oai-events");
    dcRef.current = dc;
    dc.onmessage = (e) => {
      try {
        handleServerEvent(JSON.parse(e.data as string) as RtEvent);
      } catch {
        // 解析できないイベントは無視
      }
    };
    dc.onopen = () => {
      liveRef.current = true;
      setStatus("live");
      setStartedAt(Date.now());
      setListening(true);
      if (prior.length) {
        // それまでの会話（文字で話した内容を含む）を渡して、聞き直さずに続ける
        sendEvent({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "system",
            content: [
              {
                type: "input_text",
                text: `これまでのお客様との相談内容です（最後のご質問まで回答済み）。この続きとして対応し、同じことを聞き直したり、前の回答を繰り返したりしないでください。\n${transcriptForAi(prior)}${knownInfo(hostRef.current.getIntake().draft)}`,
              },
            ],
          },
        });
        sendEvent({
          type: "response.create",
          response: {
            instructions:
              "お客様が声での相談に切り替えたところです（それまでの会話は文字で続いていた場合もあります）。「はい、声でどうぞ。続きを伺います。」のように一言だけ伝えて、お客様のお話を待ってください。前の回答は繰り返さず、この発話ではツールも使わないでください。",
          },
        });
        return;
      }
      sendEvent({
        type: "response.create",
        response: { instructions: `「こんにちは、畳の${hostRef.current.company}のAI相談員です。畳や襖、障子、網戸のことなら何でもお聞きください。」のように、短く挨拶してご用件を伺ってください。` },
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
    const url = info.api === "beta" ? `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}` : `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`;
    const headers: Record<string, string> = { Authorization: `Bearer ${info.clientSecret ?? ""}`, "Content-Type": "application/sdp" };
    if (info.api === "beta") headers["OpenAI-Beta"] = "realtime=v1";
    const res = await fetch(url, { method: "POST", body: offer.sdp, headers });
    if (!res.ok) throw new Error(`音声セッションの接続に失敗しました（HTTP ${res.status}）`);
    await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
    await opened;
  }

  /** 通話中に接続が切れたとき：1 回だけ自動でつなぎ直す（それまでの会話の続きから） */
  async function handleDrop() {
    reportError("声の相談（通話中に切断）", `接続が切れました（自動のつなぎ直し${reconnectRef.current < 1 ? "を実行" : "は済み・お客様の操作待ち"}）`);
    await end(true);
    if (reconnectRef.current < 1) {
      reconnectRef.current += 1;
      setReconnecting(true);
      await start(true);
      setReconnecting(false);
      return;
    }
    setError("音声の接続が切れました。もう一度マイクのボタンを押すと、これまでの会話の続きからお話しできます。");
  }

  // ---------------- GPT-Live（WebRTC。聞きながら話せる声のモデル） ----------------
  // 割り込み・相づち・話し終わりの判断は GPT-Live がする。マイクは関所（voice-gate.ts）を通して送る：AI の説明中の「あ」「う」などの
  // 短い声・物音では AI の説明が途切れないように（はっきり話し続けたら、話し始めから送る）、遠くの人の話し声・テレビ・ほかの人の電話の声は
  // 送らないように（一畳屋様のご指摘 2026-10-30）。割り込むかどうかは、届いた声で GPT-Live が決める（関所は AI を止めない）。
  // 事実と見積依頼の確認画面は、委任先のモデルが search_knowledge・propose_estimate_request を呼び、ブラウザが実行する

  /** お客様の発言の吹き出しを確定する（すぐに続きを話したら、同じ吹き出しに戻す：lastUserRef） */
  function finishLiveUser() {
    const t = liveTurnRef.current;
    const u = t.user;
    if (!u) return;
    t.user = null;
    userItemsRef.current.delete(u.id);
    lastUserRef.current = { id: u.id, endedAt: performance.now() };
    hostRef.current.upsert(u.id, "user", "", true, true);
    // 「画面を出して」：AI の返事を待たずに、アプリが確認画面を開く
    if (asksForForm(userTextRef.current.get(u.id) ?? "")) openFormByApp();
  }

  /**
   * アプリが確認画面を開く（AI が「確認画面を表示しました」と話したのに表示の依頼がなかった・お客様が「画面を出して」とおっしゃった）。
   * 会話から読み取った内容で開き、声の AI には表示したことを一度だけ伝える（最初から聞き直さないように）。
   * もう開いている・送信が済んだときは何もしない（一畳屋様のご指摘 2026-10-30：AI の「確認画面が表示されています」の案内で
   * 確認画面を開き直し、その知らせで AI がまた案内する、をくり返していた（10 回ほど）。開き直した確認画面から 2 回目の送信も届いた）
   */
  function openFormByApp() {
    const est = hostRef.current.getEstimateState();
    if (est.open || est.submittedId) return;
    if (performance.now() - lastProposeRef.current < 8000) return;
    lastProposeRef.current = performance.now();
    hostRef.current.openEstimate();
    contextNote(FORM_OPENED_NOTICE);
  }

  /**
   * AI が確認画面のことを話した：開いていなければ開く。確認画面が開いている（送信が済んだ）のに、「ご確認のうえ送信ボタンを」の
   * 案内を少し前にもしていたら、くり返さないよう一度だけ知らせる（「画面に表示しますね」のような、これから表示する一言は数えない）
   */
  function onFormTalk(text: string) {
    const now = performance.now();
    const said = formSaidRef.current;
    const est = hostRef.current.getEstimateState();
    if (FORM_ANNOUNCE.test(text.normalize("NFKC")) && (est.open || est.submittedId)) {
      if (said.count >= 1 && now - said.at < 120_000 && now - said.hushedAt > 60_000) {
        said.hushedAt = now;
        contextNote(FORM_HUSH_NOTICE);
      }
      said.count += 1;
      said.at = now;
    }
    if (!hostRef.current.getIntake().ready) openFormByApp();
  }

  /** AI の発言の吹き出しを確定する（お客様が話している間の相づちだけなら残さない） */
  function finishLiveAi() {
    const t = liveTurnRef.current;
    const a = t.ai;
    if (!a) return;
    t.ai = null;
    const shown = liveCaption(a.text).trim();
    if (!shown || (a.overUser && BACKCHANNEL.test(shown))) {
      hostRef.current.remove(a.id);
      return;
    }
    lastAiRef.current = { id: a.id, text: a.text, endedAt: performance.now() };
    hostRef.current.upsert(a.id, "assistant", "", true, true);
    staffLink(shown);
    // 「確認画面を表示しました」「画面に表示しますね」と話したのに、確認画面の表示の依頼がなかった：会話から読み取って確認画面を開く
    // （「後ほど画面でご確認いただく」のような、これから先の話では開かない。案内をくり返したら、くり返さないよう知らせる）
    if (saysFormShown(liveCaption(a.text))) onFormTalk(liveCaption(a.text));
    hostRef.current.onSettled();
  }

  /** 文字起こしの断片を、話した人ごとの吹き出しに足す（相手が話し始めたら、前の吹き出しを確定する） */
  function onLiveTranscript(role: "user" | "assistant", delta: string) {
    if (!delta) return;
    const t = liveTurnRef.current;
    const h = hostRef.current;
    const now = performance.now();
    if (role === "user") {
      setUserSpeaking(true);
      window.clearTimeout(userSpeakingTimerRef.current);
      userSpeakingTimerRef.current = window.setTimeout(() => setUserSpeaking(false), 700);
      if (t.ai && now - t.ai.last > 600) finishLiveAi();
      if (!t.user) {
        // 言葉の間（「わかりました。……ありがとうございます」）で区切れただけで、AI が話していなければ、前の吹き出しに続ける
        const prev = lastUserRef.current;
        if (prev && now - prev.endedAt < 4000) {
          t.user = { id: prev.id, last: now };
          userItemsRef.current.add(prev.id);
          h.upsert(prev.id, "user", delta, false, true);
        } else {
          t.user = { id: uid(), last: now };
          userItemsRef.current.add(t.user.id);
          h.upsert(t.user.id, "user", delta.replace(/^[\s、。,.]+/, ""), false);
        }
        lastUserRef.current = null;
      } else {
        t.user.last = now;
        h.upsert(t.user.id, "user", delta, false, true);
      }
      userTextRef.current.set(t.user.id, `${userTextRef.current.get(t.user.id) ?? ""}${delta}`);
    } else {
      if (t.user && now - t.user.last > 600) finishLiveUser();
      // AI が話し始めたら、お客様の次の発言は新しい吹き出しにする
      if (!t.user) lastUserRef.current = null;
      // 文字の入力の前から話していた内容（あいさつなど）を話し終えたら、答えは新しい吹き出しにする
      if (t.ai?.closeOnGap && now - t.ai.last > 700) {
        finishLiveAi();
        lastAiRef.current = null;
      }
      if (!t.ai) {
        // 文の途中で、お客様の相づち（「はい」）に区切られただけなら、前の吹き出しに続ける
        const prev = lastAiRef.current;
        t.ai =
          prev && now - prev.endedAt < 3000 && !SENTENCE_END.test(liveCaption(prev.text))
            ? { id: prev.id, last: now, text: prev.text + delta, overUser: Boolean(t.user) }
            : { id: uid(), last: now, text: delta, overUser: Boolean(t.user) };
        lastAiRef.current = null;
      } else {
        t.ai.last = now;
        t.ai.text += delta;
      }
      h.upsert(t.ai.id, "assistant", liveCaption(t.ai.text), false);
    }
    window.clearTimeout(liveSettleRef.current);
    liveSettleRef.current = window.setTimeout(() => {
      finishLiveUser();
      finishLiveAi();
    }, LIVE_SETTLE_MS);
  }

  /** 委任先のモデルが関数を呼んだ：実行して結果を返し、続きを依頼する */
  async function onLiveBackendEvent(inner: LiveEvent["event"]) {
    // 委任先が確認画面の表示を始めた：引数（ご相談内容の要約など）を書き終えるのを待たずに、確認画面を開く
    // （一畳屋様のご指摘 2026-10-28「確認画面を出すといってフリーズ」。会話で伺った内容はすぐに入り、要約などはあとから入る）
    if (inner?.type === "response.output_item.added" && inner.item?.type === "function_call" && inner.item.name === "propose_estimate_request") {
      // 送信が済んだ・もう開いている：ここでは開かない（関数の結果で、送信済み・同じ内容かを確かめる）
      const est = hostRef.current.getEstimateState();
      if (est.submittedId || est.open) return;
      lastProposeRef.current = performance.now();
      hostRef.current.openEstimate();
      return;
    }
    if (inner?.type !== "response.output_item.done" || inner.item?.type !== "function_call") return;
    const it = inner.item;
    if (!it.call_id || !it.name || handledCalls.current.has(it.call_id)) return;
    handledCalls.current.add(it.call_id);
    if (it.name === "propose_estimate_request") lastProposeRef.current = performance.now();
    const output = await toolOutput(it.name, it.arguments ?? "{}");
    sendEvent({ type: "response.item.create", event_id: uid(), item: { type: "function_call_output", call_id: it.call_id, output } });
    sendEvent({ type: "response.create", event_id: uid() });
  }

  function handleLiveEvent(ev: LiveEvent) {
    switch (ev.type) {
      case "session.started":
        liveRef.current = true;
        setStatus("live");
        setStartedAt(Date.now());
        setListening(true);
        liveStartedRef.current?.();
        // あいさつ（または「続きを伺います」）：開始時の指示と同じ内容を、もう一度伝える（GPT-Live の決まったやり方）
        if (liveGreetingRef.current) sendEvent({ type: "session.commentary.append", event_id: uid(), delegation_id: null, content: liveGreetingRef.current });
        break;
      case "session.input_transcript.delta":
        onLiveTranscript("user", ev.delta ?? "");
        break;
      case "session.output_transcript.delta":
        onLiveTranscript("assistant", ev.delta ?? "");
        break;
      case "response.event":
        void onLiveBackendEvent(ev.event);
        break;
      case "session.closed":
        liveClosedRef.current?.();
        break;
      case "error": {
        const code = ev.error?.code ?? "";
        reportError("声の相談（GPT-Live との通信）", `${code ? `${code}: ` : ""}${ev.error?.message ?? ""}`);
        // 委任先の設定の確かめ・追加の指示の失敗などは会話を続けられるので、お客様には出さない
        if (/fatal|session_expired|unauthorized|invalid_api_key/i.test(code)) setError(friendlyError(ev.error?.message));
        break;
      }
      default:
        break;
    }
  }

  async function startLive() {
    const prior = hostRef.current.getConversation();
    liveTurnRef.current = { user: null, ai: null };
    lastUserRef.current = null;
    lastAiRef.current = null;
    lastProposeRef.current = -1e9;
    formSaidRef.current = { count: 0, at: -1e9, hushedAt: -1e9 };
    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    pc.ontrack = (e) => {
      playRemote(e.streams[0]);
      remoteStreamRef.current = e.streams[0];
      gateRef.current?.watchRemote(e.streams[0]);
    };
    const ms = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
    streamRef.current = ms;
    for (const track of ms.getAudioTracks()) track.enabled = !mutedRef.current;
    // マイクは関所を通して送る（割り込みの判断は GPT-Live。関所は AI を止めない）
    stopGate();
    const gate = await createVoiceGate(audioCtxRef.current, ms, { onBargeIn: () => undefined, onAiAudio: setAiAudio });
    gateRef.current = gate;
    if (mutedRef.current) gate.setMuted(true);
    if (remoteStreamRef.current) gate.watchRemote(remoteStreamRef.current);
    pc.addTrack(gate.track, ms);
    // AI が話しているか（画面の表示）は、受信した音声の音量で見る
    watchPlayback(pc);
    const dc = pc.createDataChannel("oai-events");
    dcRef.current = dc;
    dc.onmessage = (e) => {
      try {
        handleLiveEvent(JSON.parse(e.data as string) as LiveEvent);
      } catch {
        // 解析できないイベントは無視
      }
    };
    const started = new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error("音声接続がタイムアウトしました")), 20000);
      liveStartedRef.current = () => {
        window.clearTimeout(t);
        liveStartedRef.current = null;
        resolve();
      };
    });
    const dropped = () => {
      if (liveRef.current && !userEndedRef.current) void handleDrop();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") dropped();
    };
    dc.onclose = dropped;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // 接続の候補（ICE）が集まるまで待ってから申し込む（GPT-Live の決まったやり方）
    if (pc.iceGatheringState !== "complete") {
      await new Promise<void>((resolve) => {
        const t = window.setTimeout(resolve, 5000);
        const on = () => {
          if (pc.iceGatheringState !== "complete") return;
          window.clearTimeout(t);
          pc.removeEventListener("icegatheringstatechange", on);
          resolve();
        };
        pc.addEventListener("icegatheringstatechange", on);
      });
    }
    const res = await fetch("/api/live/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sdp: pc.localDescription?.sdp ?? offer.sdp, history: prior.map((m) => ({ role: m.role, content: m.content })), draft: hostRef.current.getIntake().draft }),
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; transport?: { sdp?: string }; greeting?: string; error?: string };
    if (!res.ok || !j.transport?.sdp) throw new Error(j.error ?? `GPT-Live の接続に失敗しました（HTTP ${res.status}）`);
    liveGreetingRef.current = j.greeting ?? "";
    await pc.setRemoteDescription({ type: "answer", sdp: j.transport.sdp });
    await started;
  }

  // ---------------- 簡易音声モード（ブラウザの音声認識・読み上げ） ----------------

  async function say(text: string) {
    hostRef.current.upsert(uid(), "assistant", text, true);
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

  async function handleDemoUserText(text: string, alreadyShown = false) {
    if (!liveRef.current) return;
    if (busyRef.current) {
      pendingRef.current = text;
      stopSpeaking();
      return;
    }
    busyRef.current = true;
    recRef.current?.abort();
    setListening(false);
    if (!alreadyShown) hostRef.current.upsert(uid(), "user", text, true);
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
      if (j.draft) {
        const heard = normalizeDraft(j.draft);
        const cur = hostRef.current.getIntake();
        hostRef.current.setIntake({ ...cur, ready: j.formReady === true || cur.ready, draft: keepTouched(mergeDraft(cur.draft, heard), cur.draft, cur.touched) });
      }
      if (j.formReady) hostRef.current.openEstimate();
      hostRef.current.onSources((j.sources ?? []).map((s) => s.title));
      if (j.estimate) hostRef.current.onEstimate(j.estimate);
      await say(j.reply ?? "");
      hostRef.current.onSettled();
      if (j.done) {
        busyRef.current = false;
        await end();
        return;
      }
    } catch {
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
    const prior = hostRef.current.getConversation();
    const res = await fetch("/api/agent/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "web_voice", sessionId: conversationIdRef.current, history: prior.map((m) => ({ role: m.role, content: m.content })), draft: hostRef.current.getIntake().draft }),
    });
    const j = (await res.json()) as { ok: boolean; sessionId?: string; session?: unknown; greeting?: string; error?: string };
    if (!res.ok || !j.ok || !j.sessionId) throw new Error(j.error ?? "セッションを開始できませんでした");
    agentSessionRef.current = j.sessionId;
    agentSessionObjRef.current = j.session ?? null;
    liveRef.current = true;
    setStatus("live");
    setStartedAt(Date.now());
    await say(prior.length ? "はい、声でどうぞ。続きを伺います。" : (j.greeting ?? `こんにちは。${hostRef.current.company}のAI相談員です。ご用件をどうぞ。`));
    listen();
  }

  // ---------------- 操作 ----------------

  /** 声を始める（それまでの会話の続きから）。auto は接続が切れたあとの自動のつなぎ直し */
  async function start(auto = false, conversationId = "") {
    // 音の処理（マイクの関所）と AI の声を流す要素は、押した直後に動かしておく（iPhone・Android などは、あとからでは始められないことがある）
    audioCtxRef.current = unlockAudioContext(audioCtxRef.current);
    primeAudio();
    setAudioBlocked(false);
    staffLinkRef.current = false;
    if (conversationId) conversationIdRef.current = conversationId;
    lastBargeRef.current = -1e9;
    setError("");
    if (!auto) reconnectRef.current = 0;
    userEndedRef.current = false;
    handledCalls.current = new Set();
    responseActiveRef.current = false;
    aiAudioRef.current = false;
    speechRef.current = null;
    pendingCreateRef.current = false;
    ignoredItemsRef.current = new Set();
    recFatalRef.current = false;
    setStatus("connecting");
    const micDenied = (e: unknown) => /NotAllowedError|Permission|denied|許可/i.test((e as Error).message) || (e as DOMException).name === "NotAllowedError";
    const deny = async () => {
      await end(false);
      setStatus("idle");
      setError("マイクの使用が許可されませんでした。ブラウザの設定でマイクを許可してから、もう一度お試しください（文字での入力はそのまま使えます）。");
    };
    try {
      const res = await fetch("/api/realtime/session", { method: "POST" });
      let info = (await res.json()) as SessionInfo;
      setReason(info.reason ?? "");
      hostRef.current.onReadings?.(info.readings ?? []);
      // GPT-Live（既定）。つながらなければ Realtime API、それも使えなければ簡易音声モード
      if (info.mode === "openai" && info.engine === "live") {
        modeRef.current = "openai";
        setMode("openai");
        engineRef.current = "live";
        try {
          await startLive();
          return;
        } catch (e) {
          if (micDenied(e)) return await deny();
          reportError("声の相談の接続（GPT-Live から Realtime API に切り替え）", (e as Error).message);
          await end(false);
          engineRef.current = "realtime";
          setStatus("connecting");
          info = (await (await fetch("/api/realtime/session?engine=realtime", { method: "POST" })).json()) as SessionInfo;
        }
      }
      if (info.mode === "openai") {
        modeRef.current = "openai";
        setMode("openai");
        engineRef.current = "realtime";
        try {
          await startRealtime(info);
          return;
        } catch (e) {
          const msg = (e as Error).message;
          if (micDenied(e)) return await deny();
          setReason(`Realtime 接続に失敗したため簡易音声モードに切り替えました：${msg}`);
          reportError("声の相談の接続（簡易音声モードに切り替え）", msg);
          await end(false);
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

  function stop() {
    userEndedRef.current = true;
    void end();
  }

  function toggleMute() {
    const next = !mutedRef.current;
    setMuted(next);
    mutedRef.current = next;
    streamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    gateRef.current?.setMuted(next);
    if (modeRef.current === "openai" && engineRef.current === "live") sendEvent({ type: next ? "session.input_audio.mute" : "session.input_audio.unmute", event_id: uid() });
  }

  /** 声で話している間に文字で入力した内容（会話には呼び出し側が入れる） */
  function sendText(text: string) {
    if (!liveRef.current) return;
    if (modeRef.current === "openai" && engineRef.current === "live") {
      // GPT-Live：文字の入力は委任先のモデルにそのまま渡し（入力どおりの文字で調べ・確認画面に使い、その結果を AI が話す）、
      // 声のモデルにも知らせる（知らせないと、文字で入力されたお名前などを声で聞き直す）
      const t = liveTurnRef.current;
      finishLiveUser();
      lastUserRef.current = null;
      if (t.ai) {
        // 話し途中（あいさつの途中など）なら、話し終えてから区切る
        if (performance.now() - t.ai.last > 700) finishLiveAi();
        else t.ai.closeOnGap = true;
      }
      lastAiRef.current = null;
      sendEvent({ type: "session.thinking.append", event_id: uid(), delegation_id: null, content: `お客様が画面の入力欄に文字で入力しました（書かれたとおりで正確）：「${text}」` });
      sendEvent({ type: "response.item.create", event_id: uid(), item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
      sendEvent({ type: "response.create", event_id: uid() });
      return;
    }
    if (modeRef.current === "openai") sendUserText(text);
    else void handleDemoUserText(text, true);
  }

  /**
   * システムからの知らせ（見積依頼が送信された など）。Realtime では AI に伝えてひと言話してもらい、
   * 簡易音声モードでは spoken をそのまま読み上げる
   */
  function notify(instruction: string, spoken: string, fact = "") {
    if (!liveRef.current) return;
    if (modeRef.current === "openai" && engineRef.current === "live") {
      // 状況（送信済み など）は一度だけの知らせで渡し、話す内容は一度だけ話してもらう（session.instructions.append は、
      // そのあともずっと指示として残り、同じことを何度も話す原因になるため使わない）
      if (fact) contextNote(fact);
      sendEvent({ type: "session.commentary.append", event_id: uid(), delegation_id: null, content: instruction });
    } else if (modeRef.current === "openai") sendUserText(`（システム通知）${instruction}`);
    else
      void (async () => {
        recRef.current?.abort();
        await say(spoken);
        listen();
      })();
  }

  /** 簡易音声モードで読み上げ中なら止める */
  function interruptSpeech() {
    if (modeRef.current === "demo" && speakingRef.current) stopSpeaking();
  }

  return {
    audioRef,
    status,
    live: status === "live",
    mode,
    reason,
    interim,
    aiSpeaking,
    listening,
    userSpeaking,
    muted,
    error,
    setError,
    micOk,
    startedAt,
    reconnecting,
    audioBlocked,
    resumeAudio,
    start,
    stop,
    toggleMute,
    sendText,
    notify,
    interruptSpeech,
  };
}

/** 確認画面に入る内容が同じか（お名前・ご住所・お電話番号・ご希望日・ご相談内容） */
function sameDraft(a: IntakeDraft, b: IntakeDraft): boolean {
  const t = (s?: string) => (s ?? "").trim();
  return t(a.name) === t(b.name) && t(a.address) === t(b.address) && t(a.phone) === t(b.phone) && t(a.summary) === t(b.summary) && a.dates.join("|") === b.dates.join("|");
}
