// 声の相談（OpenAI Realtime）のマイクの関所。ブラウザ専用
//
// AI の声が途中で切れないように（OpenAI はマイクに声らしい音が入ると、すぐに AI の音声を止めてしまうため）：
//   ・AI の声が流れている間は、マイクの音を AI に送らない（相づち「はい」・咳・物音・スピーカーからの回り込みで止まらない）
//   ・お客様がはっきり話し続けたら（直近 BARGE_WINDOW_S 秒のうち BARGE_VOICED_S 秒以上、声が出ている）AI を止める（割り込み）。
//     そのとき、送らずにおいた話し始めから送る（「いや、8畳です」の「いや、8畳」が抜けない）。
//     遅れた分は、話の切れ目の静かな部分を飛ばして追いつく
//   ・AI が話し終わったときにお客様が話し始めていたら、その頭から送る
//   ・AI が話しているかは、受信した AI の音声の音で判定する（OpenAI の「再生が終わった」の知らせには頼らない）
// 音の処理は AudioWorklet（音声の処理の専用スレッド。タイマーの間引きの影響を受けない）。
// 使えない環境では、マイクの送信の入り切り（頭は少し抜ける）で同じ判定をする

/**
 * 割り込みの判定：直近 BARGE_WINDOW_S 秒のうち、声が出ている時間が BARGE_VOICED_S 秒以上なら、はっきり話し続けている。
 * 相づち「はい」・咳・物音（短い）や、くり返す短い音（時計・電子音。1 回 20ms でも数えるのは 70ms 程度）では AI を止めない。
 * 言葉の間（「8畳でした。8畳だと…」の「。」）があっても、話していれば数え続ける
 */
// 2026-10-26：50代以上のお客様の短い訂正（「違います」「ちょっと待ってください」。小さめの声も）で、話し始めから 0.4 秒ほどで
// AI を止める（以前の 1 秒中 0.6 秒では、小さめの声の訂正で止まらない・止まるまで 2 秒かかることがあった）。
// 回り込み（AI の声の 0.15〜0.3 倍）・物音のくり返し・電子音では止めないことを gate-sweep で確認。
// 長めの相づち（「うんうん」「はいはい」）では止まることがある → AI は話の続きを短く話す（指示）
const BARGE_WINDOW_S = 0.8;
const BARGE_VOICED_S = 0.4;
/** 声が出ているかを見る、速い包絡線の減り方（10ms あたり。短い音の余韻を長く数えない） */
const FAST_RELEASE = 0.6;
/** AI が話し終わったとき、いまお客様が話している（直近 1 秒に声がこれだけある）なら、その頭から送る */
const SPEAKING_NOW_S = 0.25;
/** 割り込みのとき、話し始めとみなした時点より前から送る長さ（秒。小さい声の出だしが抜けないように） */
const PRE_ROLL_S = 0.35;
/** この長さまでの無音は、ひと続きの発話の中の間とみなす（「いや、……8畳でした」の「いや、」から送る） */
const UTTERANCE_GAP_S = 1.2;
/** 割り込んだあと、この間はマイクをそのまま送る（AI の声が止まるまでの間に、また止めないように） */
const BARGE_HOLD_S = 2;
/** マイクの音量の包絡線の減り方（50ms あたり）。発話の中の短い切れ目（〜0.2 秒）は話し続けているとみなす */
const MIC_RELEASE = 0.6;
/** お客様の声とみなすマイクの音量（RMS。話し声は 0.1〜0.5 程度、小さめの声は 0.02〜。回り込みはブラウザの回り込み除去で小さくなる） */
const MIC_LEVEL = 0.02;
/** AI の声が出ているとみなす音量（受信した音声の RMS。話している間は 0.08〜0.3 程度、無音は 0） */
const AI_LEVEL = 0.01;
/** AI の声が聞こえている間（この時間内に音があれば話し中）。受信した音声を見られないときに、OpenAI の「再生中」の知らせと合わせて使う */
const AI_HANGOVER_S = 0.3;
/**
 * 受信した AI の音声を見られるときは、音で「話し中」を決める：最後に音があってからこの時間までは話し中（文と文の間をつなぐ）。
 * gpt-realtime-2.1 は「再生が終わった」の知らせ（output_audio_buffer.stopped）を送らないため、知らせには頼らない
 */
const AI_TAIL_S = 1.2;
/** 遅れを取り戻すとき、静かな部分を最大でこの倍率で飛ばす（話している部分は飛ばさない） */
const CATCH_UP = 6;
/**
 * 遠くの話し声を送らない（一畳屋様のご指摘 2026-10-30「遠くで違う人の会話を途中で拾われた。同じ部屋の離れた場所での電話の会話も」）：
 * お客様がマイクの近くで話す声の大きさを覚えておき、その NEAR_RATIO 倍より小さい音（遠くの人の声・テレビ・ほかの人の電話）は、
 * お客様の声とみなさない（送らない・割り込みにしない）。小さめの声のお客様も止めないよう、求める大きさは NEAR_MAX まで。
 * 覚えた大きさは NEAR_HALF_LIFE 秒ごとに半分に戻す（お客様がスマホから離れても、ずっと聞こえないままにならない）
 */
// 2026-10-30 の gate-near（同じ声の音量を区間ごとに変えて入れる）：0.35・0.09 で、お客様の声より 18dB 小さい声（3m ほど離れた人）は
// ほぼ送らず（送った割合 0〜7%）、お客様の 10dB 小さめの声も 92〜100% 送る。gate-sweep（割り込み・相づち・回り込み）は変わらず
const NEAR_RATIO = 0.35;
const NEAR_MAX = 0.09;
/** お客様の声の大きさを覚える速さ（秒） */
const NEAR_TAU_S = 1.5;
const NEAR_HALF_LIFE_S = 20;
/** お客様の声が途切れてから、この時間は送り続ける（言葉の終わり・小さくなる語尾を切らない） */
const NEAR_HANG_S = 0.35;

export interface VoiceGate {
  /** OpenAI に送るマイクの音声 */
  track: MediaStreamTrack;
  kind: "worklet" | "toggle";
  /** OpenAI からの「AI の音声を再生中」の知らせ（output_audio_buffer.started〜stopped/cleared。受信した音声を見られないときに使う） */
  setAiPlaying(on: boolean): void;
  setMuted(on: boolean): void;
  /** 受信した AI の音声（音量で「いま AI が話しているか」を見る） */
  watchRemote(stream: MediaStream): void;
  close(): void;
}

interface Options {
  /** お客様がはっきり話し続けた：AI を止める */
  onBargeIn: () => void;
  /** AI の声が流れ始めた・流れ終わった（受信した音声の音で判定。文と文の間の短い無音では終わりにしない） */
  onAiAudio?: (on: boolean) => void;
}

/** 関所の設定（AudioWorklet に渡す。試験でも同じ値を使う） */
export const GATE_OPTIONS = {
  bargeWindow: BARGE_WINDOW_S,
  bargeVoiced: BARGE_VOICED_S,
  fastRelease: FAST_RELEASE,
  speakingNow: SPEAKING_NOW_S,
  preRoll: PRE_ROLL_S,
  gap: UTTERANCE_GAP_S,
  bargeHold: BARGE_HOLD_S,
  release: MIC_RELEASE,
  micLevel: MIC_LEVEL,
  aiLevel: AI_LEVEL,
  aiHangover: AI_HANGOVER_S,
  aiTail: AI_TAIL_S,
  catchUp: CATCH_UP,
  nearRatio: NEAR_RATIO,
  nearMax: NEAR_MAX,
  nearTau: NEAR_TAU_S,
  nearHalfLife: NEAR_HALF_LIFE_S,
  nearHang: NEAR_HANG_S,
};

/** AudioWorklet の処理（音声の処理の専用スレッドで動く。試験のために書き出す） */
export const GATE_PROCESSOR = `
class VoiceGate extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.c = options.processorOptions;
    this.n = 128;
    this.size = Math.ceil((sampleRate * 8) / this.n) * this.n;
    this.ring = new Float32Array(this.size);
    this.loud = new Uint8Array(this.size / this.n);
    this.w = 0;
    this.lag = 0;
    this.env = 0;
    this.fenv = 0;
    this.win = new Uint8Array(Math.max(1, Math.round((this.c.bargeWindow * sampleRate) / this.n)));
    this.wi = 0;
    this.wsum = 0;
    this.utter = 0;
    this.quiet = 1e9;
    this.aiFlag = false;
    this.lastAi = -1e9;
    this.remoteLive = false;
    this.aiWas = false;
    this.hold = -1e9;
    this.muted = false;
    this.gated = false;
    this.decay = Math.pow(this.c.release, this.n / sampleRate / 0.05);
    this.fdecay = Math.pow(this.c.fastRelease, this.n / sampleRate / 0.01);
    // お客様がマイクの近くで話す声の大きさ（遠くの話し声を送らないため）
    this.near = 0;
    this.nearDecay = this.c.nearHalfLife > 0 ? Math.pow(0.5, this.n / sampleRate / this.c.nearHalfLife) : 1;
    this.nearK = this.c.nearTau > 0 ? Math.min(1, this.n / sampleRate / this.c.nearTau) : 1;
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if ("ai" in m) this.aiFlag = !!m.ai;
      if ("muted" in m) this.muted = !!m.muted;
    };
  }
  rms(a) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * a[i];
    return Math.sqrt(s / a.length);
  }
  backlog() {
    // いまの発話の話し始め（短い間をはさんだ前の言葉も含む）から送る。長くても 6 秒まで
    const blocks = Math.ceil((Math.min(this.utter + this.c.preRoll, 6) * sampleRate) / this.n) - 1;
    return Math.max(0, Math.min(blocks * this.n, this.size - 2 * this.n));
  }
  readAt(lag) {
    return (this.cur - lag + this.size) % this.size;
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    const n = this.n;
    const c = this.c;
    const t = currentTime;
    const mic = inputs[0] && inputs[0][0];
    const ai = inputs[1] && inputs[1][0];
    if (ai && this.rms(ai) > c.aiLevel) {
      this.lastAi = t;
      this.remoteLive = true;
    }
    // AI が話しているか：受信した AI の音声が届いていれば音で（最後の音から aiTail 秒まで）、
    // 届いていない環境（受信した音声を音の処理に回せないブラウザ）では OpenAI の知らせで決める
    const aiTalking = this.remoteLive ? t - this.lastAi < c.aiTail : this.aiFlag || t - this.lastAi < c.aiHangover;
    if (aiTalking !== this.aiWas) {
      this.aiWas = aiTalking;
      if (this.remoteLive) this.port.postMessage({ type: "ai", on: aiTalking });
    }
    // マイクの音を輪のバッファに書く
    this.cur = this.w;
    if (mic) this.ring.set(mic, this.cur);
    else this.ring.fill(0, this.cur, this.cur + n);
    const level = mic ? this.rms(mic) : 0;
    const dt = n / sampleRate;
    // お客様の声とみなす大きさ：お客様の声の大きさの nearRatio 倍（nearMax まで）。それより小さい音は遠くの話し声など
    const thr = c.nearRatio > 0 ? Math.max(c.micLevel, Math.min(this.near * c.nearRatio, c.nearMax)) : c.micLevel;
    // 遅い包絡線（loud）：言葉の短い切れ目は「話し中」。送り始める位置（utter）と、追いつくときに飛ばしてよい静かな部分の判定に使う
    this.env = Math.max(level, this.env * this.decay);
    const loud = this.env > thr;
    // お客様の声の大きさを覚える（いま覚えている大きさの半分より大きい声だけで。遠くの小さな声では上げない）
    if (c.nearRatio > 0) {
      this.near *= this.nearDecay;
      if (this.env > c.micLevel && this.env > this.near * 0.5) this.near += (Math.min(this.env, 0.5) - this.near) * this.nearK;
    }
    this.loud[this.cur / n] = loud ? 1 : 0;
    if (loud) {
      if (this.quiet >= c.gap) this.utter = 0;
      this.quiet = 0;
      this.utter += dt;
    } else {
      this.quiet += dt;
      if (this.quiet < c.gap) this.utter += dt;
    }
    // 速い包絡線（voiced）：いま声が出ているか。直近 bargeWindow 秒のうち声が出ている時間（割り込みの判定）
    this.fenv = Math.max(level, this.fenv * this.fdecay);
    const v = this.fenv > thr ? 1 : 0;
    this.wsum += v - this.win[this.wi];
    this.win[this.wi] = v;
    this.wi = (this.wi + 1) % this.win.length;
    const voiced = this.wsum * dt;
    this.w = (this.cur + n) % this.size;
    if (aiTalking && t > this.hold) {
      if (voiced < c.bargeVoiced) {
        // AI が話している：送らない
        this.gated = true;
        this.lag = 0;
        out.fill(0);
        return true;
      }
      // はっきり話し続けている：AI を止めて、話し始めから送る
      this.hold = t + c.bargeHold;
      this.gated = false;
      this.lag = this.backlog();
      this.port.postMessage({ type: "barge" });
    } else if (this.gated) {
      // AI が話し終わった：お客様が話し始めていたら、その頭から送る（くり返す短い物音だけなら送らない）
      this.gated = false;
      this.lag = loud && voiced >= c.speakingNow ? this.backlog() : 0;
    }
    if (this.muted) {
      this.lag = 0;
      out.fill(0);
      return true;
    }
    // お客様が話していない間（遠くの話し声・テレビ・ほかの人の電話の声だけ）は送らない
    if (c.nearRatio > 0 && this.lag === 0 && this.quiet >= c.nearHang) {
      out.fill(0);
      return true;
    }
    // 遅れている間は、静かな部分を飛ばして追いつく（話している部分は飛ばさない）
    for (let k = 1; k < c.catchUp && this.lag > 0 && !this.loud[this.readAt(this.lag) / n]; k++) this.lag -= n;
    const r = this.readAt(this.lag);
    out.set(this.ring.subarray(r, r + n));
    return true;
  }
}
registerProcessor("voice-gate", VoiceGate);
`;

const rmsOf = (a: AnalyserNode, buf: Float32Array<ArrayBuffer>) => {
  a.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
};

/** AudioWorklet の関所（ctx は「開始」を押したときに作って動かしておく。動いていなければ使わない） */
async function workletGate(ctx: AudioContext, mic: MediaStream, opts: Options): Promise<VoiceGate> {
  if (ctx.state !== "running") await ctx.resume();
  if (ctx.state !== "running" || !ctx.audioWorklet) throw new Error("AudioWorklet を使えません");
  const url = URL.createObjectURL(new Blob([GATE_PROCESSOR], { type: "application/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const node = new AudioWorkletNode(ctx, "voice-gate", {
    numberOfInputs: 2,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
    processorOptions: GATE_OPTIONS,
  });
  node.port.onmessage = (e) => {
    const m = e.data as { type?: string; on?: boolean };
    if (m?.type === "barge") opts.onBargeIn();
    else if (m?.type === "ai") opts.onAiAudio?.(m.on === true);
  };
  const src = ctx.createMediaStreamSource(mic);
  src.connect(node, 0, 0);
  const dest = ctx.createMediaStreamDestination();
  node.connect(dest);
  const track = dest.stream.getAudioTracks()[0];
  let remote: MediaStreamAudioSourceNode | null = null;
  return {
    track,
    kind: "worklet",
    setAiPlaying: (on) => node.port.postMessage({ ai: on }),
    setMuted: (on) => {
      node.port.postMessage({ muted: on });
      track.enabled = !on;
    },
    watchRemote(stream) {
      if (remote) return;
      try {
        remote = ctx.createMediaStreamSource(stream);
        remote.connect(node, 0, 1);
      } catch {
        // 見張れない環境では、AI の声の判定に OpenAI からの知らせだけを使う
      }
    },
    close() {
      try {
        src.disconnect();
        remote?.disconnect();
        node.port.onmessage = null;
        node.disconnect();
        track.stop();
      } catch {
        // noop
      }
    },
  };
}

/** AudioWorklet が使えない環境：マイクの送信を入り切りする（割り込みの頭は少し抜ける） */
function toggleGate(ctx: AudioContext | null, mic: MediaStream, opts: Options): VoiceGate {
  const track = mic.getAudioTracks()[0];
  let aiPlaying = false;
  let muted = false;
  let aiNode: AnalyserNode | null = null;
  let micNode: AnalyserNode | null = null;
  let clone: MediaStreamTrack | null = null;
  const buf = new Float32Array(1024);
  if (ctx) {
    try {
      // マイクの複製で音量を見る（AI に送る方を止めても、お客様の声は見張れるように）
      clone = track.clone();
      clone.enabled = true;
      micNode = ctx.createAnalyser();
      micNode.fftSize = 1024;
      ctx.createMediaStreamSource(new MediaStream([clone])).connect(micNode);
    } catch {
      micNode = null;
    }
  }
  let lastAi = -1e9;
  let remoteLive = false;
  let aiWas = false;
  let hold = -1e9;
  let last = performance.now();
  // 直近 BARGE_WINDOW_S 秒の「声が出ていた時間」（タイマーは間引かれることがあるので、実際に経った時間で数える）
  let voicedTicks: { at: number; dt: number }[] = [];
  const timer = window.setInterval(() => {
    const now = performance.now();
    const dt = Math.min(now - last, 250) / 1000;
    last = now;
    if (aiNode && rmsOf(aiNode, buf) > AI_LEVEL) {
      lastAi = now;
      remoteLive = true;
    }
    // AudioWorklet の関所と同じ：受信した AI の音声が届いていれば音で、届いていなければ OpenAI の知らせで決める
    const aiTalking = remoteLive ? now - lastAi < AI_TAIL_S * 1000 : aiPlaying || now - lastAi < AI_HANGOVER_S * 1000;
    if (aiTalking !== aiWas) {
      aiWas = aiTalking;
      if (remoteLive) opts.onAiAudio?.(aiTalking);
    }
    if (aiTalking && now > hold) {
      if (track.enabled) track.enabled = false;
      if (micNode && rmsOf(micNode, buf) > MIC_LEVEL) voicedTicks.push({ at: now, dt });
      voicedTicks = voicedTicks.filter((x) => now - x.at <= BARGE_WINDOW_S * 1000);
      if (voicedTicks.reduce((s, x) => s + x.dt, 0) >= BARGE_VOICED_S) {
        voicedTicks = [];
        hold = now + BARGE_HOLD_S * 1000;
        opts.onBargeIn();
        if (!muted) track.enabled = true;
      }
    } else {
      voicedTicks = [];
      if (!track.enabled && !muted) track.enabled = true;
    }
  }, 50);
  return {
    track,
    kind: "toggle",
    setAiPlaying: (on) => {
      aiPlaying = on;
    },
    setMuted: (on) => {
      muted = on;
      track.enabled = !on;
    },
    watchRemote(stream) {
      if (!ctx || aiNode) return;
      try {
        aiNode = ctx.createAnalyser();
        aiNode.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(aiNode);
      } catch {
        aiNode = null;
      }
    },
    close() {
      window.clearInterval(timer);
      clone?.stop();
    },
  };
}

/** マイクの関所を作る（ctx：「開始」を押したときに作った AudioContext。なければ入り切りだけ） */
export async function createVoiceGate(ctx: AudioContext | null, mic: MediaStream, opts: Options): Promise<VoiceGate> {
  if (ctx) {
    try {
      return await workletGate(ctx, mic, opts);
    } catch {
      // 入り切りの方式にする
    }
  }
  return toggleGate(ctx, mic, opts);
}

/** 「開始」を押したときに呼ぶ（iPhone などは、押した直後でないと音の処理を始められない） */
export function unlockAudioContext(prev: AudioContext | null): AudioContext | null {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    const ctx = prev && prev.state !== "closed" ? prev : new Ctx();
    void ctx.resume().catch(() => undefined);
    return ctx;
  } catch {
    return null;
  }
}
