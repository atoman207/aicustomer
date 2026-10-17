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
  const rec = new Ctor();
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

let currentAudio: HTMLAudioElement | null = null;

export function stopSpeaking(): void {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.src = "";
    } catch {
      // noop
    }
    currentAudio = null;
  }
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

function pickJapaneseVoice(): SpeechSynthesisVoice | undefined {
  if (typeof speechSynthesis === "undefined") return undefined;
  const voices = speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang.replace("_", "-").startsWith("ja") && /Google|Nanami|Ayumi|Kyoko|O-Ren|Haruka|Ichiro|Sayaka/i.test(v.name)) ??
    voices.find((v) => v.lang.replace("_", "-").startsWith("ja"))
  );
}

/**
 * テキスト読み上げ。OpenAI TTS（/api/tts）が使えればそれを、なければブラウザ音声合成を使う
 */
export async function speakText(text: string, opts: { preferServer?: boolean } = {}): Promise<"openai" | "browser" | "none"> {
  stopSpeaking();
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "none";
  if (opts.preferServer !== false) {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean }),
      });
      if (res.status === 200) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        await new Promise<void>((resolve, reject) => {
          const a = new Audio(url);
          currentAudio = a;
          a.onended = () => {
            URL.revokeObjectURL(url);
            resolve();
          };
          a.onerror = () => reject(new Error("audio playback error"));
          a.play().catch(reject);
        });
        currentAudio = null;
        return "openai";
      }
    } catch {
      // ブラウザ合成へフォールバック
    }
  }
  if (typeof speechSynthesis === "undefined") return "none";
  await new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = "ja-JP";
    u.rate = 1.0;
    u.pitch = 1.0;
    const v = pickJapaneseVoice();
    if (v) u.voice = v;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
  return "browser";
}

/** 音声合成の声一覧は遅延ロードされるため、事前に呼んで温めておく */
export function warmUpVoices(): void {
  if (typeof speechSynthesis === "undefined") return;
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}
