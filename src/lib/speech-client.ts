// ブラウザ側の音声ユーティリティ（音声認識 Web Speech API／読み上げ）
// クライアントコンポーネントからのみ import すること

interface RecognitionAlternativeLike {
  transcript: string;
}
interface RecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: RecognitionAlternativeLike;
}
interface RecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResultLike };
}
interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function supportsRecognition(): boolean {
  return recognitionCtor() !== null;
}

/** 再試行しても直らない音声認識エラー（自動再開を止めてテキスト入力に切り替える） */
export function isFatalRecognitionError(error: string): boolean {
  return ["not-allowed", "service-not-allowed", "network", "audio-capture", "language-not-supported", "bad-grammar"].includes(error);
}

export function recognitionErrorMessage(error: string): string {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "マイクの使用が許可されていません。ブラウザの設定でマイクを許可するか、下の入力欄から文字でお話しください。";
    case "audio-capture":
      return "マイクが見つかりません。マイクを接続するか、下の入力欄から文字でお話しください。";
    case "network":
      return "音声認識サービスに接続できません。下の入力欄から文字でお話しください。";
    default:
      return "このブラウザでは音声認識を使えません。下の入力欄から文字でお話しください。";
  }
}

export interface Recognizer {
  start(): void;
  stop(): void;
  abort(): void;
}

export function createRecognizer(handlers: {
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
}): Recognizer | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  let rec: RecognitionLike;
  try {
    rec = new Ctor();
  } catch {
    return null;
  }
  rec.lang = "ja-JP";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let stopped = false;
  rec.onresult = (e) => {
    let interim = "";
    let final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0]?.transcript ?? "";
      else interim += r[0]?.transcript ?? "";
    }
    if (interim) handlers.onInterim?.(interim);
    if (final.trim()) handlers.onFinal(final.trim());
  };
  rec.onend = () => {
    if (!stopped) handlers.onEnd?.();
  };
  rec.onerror = (e) => handlers.onError?.(e.error);
  return {
    start: () => {
      stopped = false;
      try {
        rec.start();
      } catch {
        // 連続 start は例外になるため無視
      }
    },
    stop: () => {
      stopped = true;
      try {
        rec.stop();
      } catch {
        // noop
      }
    },
    abort: () => {
      stopped = true;
      try {
        rec.abort();
      } catch {
        // noop
      }
    },
  };
}

// ---------------- 読み上げ ----------------

let currentAudio: HTMLAudioElement | null = null;
let cancelCurrent: (() => void) | null = null;

/** 再生中の読み上げを止め、待機中の speakText をすぐに完了させる */
export function stopSpeaking(): void {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.removeAttribute("src");
      currentAudio.load();
    } catch {
      // noop
    }
    currentAudio = null;
  }
  if (typeof speechSynthesis !== "undefined") {
    try {
      speechSynthesis.cancel();
    } catch {
      // noop
    }
  }
  const c = cancelCurrent;
  cancelCurrent = null;
  c?.();
}

/** 日本語の女性の声（自然に聞こえる順。Edge の Nanami・Apple の Kyoko／O-Ren・Chrome の Google 日本語 など） */
const JA_FEMALE_VOICES = [/Nanami/i, /Kyoko/i, /O-?Ren/i, /Google/i, /Mayu|Aoi|Shiori/i, /Haruka/i, /Ayumi/i, /Sayaka/i];
/** 男性の声は選ばない（AI 相談員は女性の声） */
const JA_MALE_VOICES = /Ichiro|Keita|Otoya|Daichi|Naoki|Hattori/i;

function pickJapaneseVoice(): SpeechSynthesisVoice | undefined {
  if (typeof speechSynthesis === "undefined") return undefined;
  const ja = speechSynthesis.getVoices().filter((v) => v.lang.replace("_", "-").startsWith("ja"));
  // 同じ名前なら、より自然な「Natural」「Online」「Premium」「Enhanced」の声を先に
  const better = (v: SpeechSynthesisVoice) => (/Natural|Online|Premium|Enhanced/i.test(v.name) ? 0 : 1);
  for (const re of JA_FEMALE_VOICES) {
    const v = ja.filter((x) => re.test(x.name)).sort((a, b) => better(a) - better(b))[0];
    if (v) return v;
  }
  return ja.find((v) => !JA_MALE_VOICES.test(v.name)) ?? ja[0];
}

/** 声の一覧は遅れて読み込まれることがあるため最大 1 秒待ってから、日本語の声があるか確かめる */
async function ensureJapaneseVoice(): Promise<boolean> {
  if (pickJapaneseVoice()) return true;
  await new Promise<void>((resolve) => {
    const t = window.setTimeout(resolve, 1000);
    speechSynthesis.addEventListener(
      "voiceschanged",
      () => {
        window.clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
  return Boolean(pickJapaneseVoice());
}

/** Chrome は長い発話を途中で止めることがあるため、文単位に分割する */
function splitSentences(text: string): string[] {
  const parts = text.match(/[^。！？!?\n]+[。！？!?]?/g) ?? [text];
  const out: string[] = [];
  let buf = "";
  for (const p of parts.map((s) => s.trim()).filter(Boolean)) {
    if ((buf + p).length > 90 && buf) {
      out.push(buf);
      buf = p;
    } else {
      buf += p;
    }
  }
  if (buf) out.push(buf);
  return out;
}

interface SpeakControl {
  isCancelled: () => boolean;
  /** 中断されたときに呼ぶ関数を登録（戻り値で解除） */
  onCancel: (fn: () => void) => () => void;
}

function speakBrowserSentence(sentence: string, ctl: SpeakControl): Promise<void> {
  return new Promise<void>((resolve) => {
    if (ctl.isCancelled()) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(safety);
      off();
      resolve();
    };
    const off = ctl.onCancel(finish);
    // 音声が無い環境などで onend が来ない場合の保険（文字数に応じた上限で必ず進める）
    const safety = window.setTimeout(finish, Math.min(20000, 1500 + sentence.length * 220));
    try {
      const u = new SpeechSynthesisUtterance(sentence);
      u.lang = "ja-JP";
      u.rate = 1.0;
      u.pitch = 1.0;
      const v = pickJapaneseVoice();
      if (v) u.voice = v;
      u.onend = finish;
      u.onerror = finish;
      speechSynthesis.speak(u);
    } catch {
      finish();
    }
  });
}

function playServerAudio(blob: Blob, ctl: SpeakControl): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (ctl.isCancelled()) return resolve(true);
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    currentAudio = a;
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      window.clearTimeout(safety);
      off();
      URL.revokeObjectURL(url);
      if (currentAudio === a) currentAudio = null;
      resolve(ok);
    };
    const off = ctl.onCancel(() => finish(true));
    // 再生が終わらない場合の保険（長さが分かれば長さ＋2秒、分からなければ 60 秒）
    let safety = window.setTimeout(() => finish(true), 60000);
    a.onloadedmetadata = () => {
      if (Number.isFinite(a.duration) && a.duration > 0) {
        window.clearTimeout(safety);
        safety = window.setTimeout(() => finish(true), a.duration * 1000 + 2000);
      }
    };
    a.onended = () => finish(true);
    a.onerror = () => finish(false);
    a.play().catch(() => finish(false)); // 自動再生が拒否された場合はブラウザ音声へ
  });
}

/**
 * テキスト読み上げ。OpenAI TTS（/api/tts）が使えればそれを、なければブラウザ音声合成を使う。
 * どの環境でも必ず完了する（stopSpeaking() でも即完了）。
 */
export async function speakText(text: string, opts: { preferServer?: boolean } = {}): Promise<"openai" | "browser" | "none"> {
  stopSpeaking();
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "none";
  let cancelled = false;
  const wakers = new Set<() => void>();
  const ctl: SpeakControl = {
    isCancelled: () => cancelled,
    onCancel: (fn) => {
      wakers.add(fn);
      return () => {
        wakers.delete(fn);
      };
    },
  };
  const isCancelled = ctl.isCancelled;
  cancelCurrent = () => {
    cancelled = true;
    [...wakers].forEach((w) => w());
    wakers.clear();
  };

  if (opts.preferServer !== false) {
    try {
      const ac = new AbortController();
      const t = window.setTimeout(() => ac.abort(), 20000);
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean }),
        signal: ac.signal,
      });
      window.clearTimeout(t);
      if (isCancelled()) return "none";
      if (res.status === 200) {
        const played = await playServerAudio(await res.blob(), ctl);
        if (played || isCancelled()) {
          if (cancelCurrent && !isCancelled()) cancelCurrent = null;
          return "openai";
        }
      }
    } catch {
      // ブラウザ音声合成へ
    }
  }
  if (isCancelled()) return "none";
  if (typeof speechSynthesis === "undefined") {
    cancelCurrent = null;
    return "none";
  }
  // 日本語の声が無い端末では読み上げず、文字表示だけで進める（英語の声で読ませない・待たせない）
  if (!(await ensureJapaneseVoice())) {
    cancelCurrent = null;
    return "none";
  }
  for (const sentence of splitSentences(clean)) {
    if (isCancelled()) break;
    await speakBrowserSentence(sentence, ctl);
  }
  if (!isCancelled()) cancelCurrent = null;
  return "browser";
}

/** 音声合成の声一覧は遅延ロードされるため、事前に呼んで温めておく */
export function warmUpVoices(): void {
  if (typeof speechSynthesis === "undefined") return;
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}
