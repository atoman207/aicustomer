// OpenAI REST API の薄いラッパー（SDK非依存・サーバー専用）
import { env } from "./env";
import { recordTokens } from "./usage";

const base = () => env.openaiBaseUrl;

export class OpenAIError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "OpenAIError";
    this.status = status;
  }
}

/**
 * 回答のモデル（OPENAI_ANSWER_MODEL）で答えられなかったときに、いつものモデル（OPENAI_CHAT_MODEL）で答え直してよいか：
 *   混み合っている（429）・一時的な障害（5xx）に加えて、この API キーではそのモデルを使えない（403・404）・設定が合わない（400）とき。
 *   API キーが正しくない（401）は、どのモデルでも同じなので答え直さない
 */
export function canRetryWithChatModel(e: unknown): boolean {
  return e instanceof OpenAIError && (e.status === 429 || e.status >= 500 || e.status === 400 || e.status === 403 || e.status === 404);
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${env.openaiKey}`, "Content-Type": "application/json", ...extra };
}

async function post(path: string, body: unknown, extra?: Record<string, string>, timeoutMs = 30_000): Promise<Response> {
  if (!env.hasOpenAI) throw new OpenAIError("OPENAI_API_KEY が設定されていません", 401);
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      method: "POST",
      headers: headers(extra),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = (e as Error).name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new OpenAIError(`OpenAI API がタイムアウトしました（${Math.round(timeoutMs / 1000)}秒）`, 504);
    }
    throw new OpenAIError(`OpenAI API に接続できません: ${(e as Error).message}`, 502);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OpenAIError(`OpenAI API error ${res.status}: ${text.slice(0, 600)}`, res.status);
  }
  return res;
}

export type ChatRole = "system" | "user" | "assistant";
/** 文字以外（PDF・画像）を渡すときの内容（Chat Completions の content parts） */
export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };
export interface ChatInputMessage {
  role: ChatRole;
  content: string | ChatContentPart[];
}

export interface ChatOptions {
  messages: ChatInputMessage[];
  temperature?: number;
  maxTokens?: number;
  model?: string;
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /** 利用状況の記録用（chat / agent / summarize など） */
  purpose?: string;
  /** 既定 45 秒（資料の解析など時間がかかるものは長めに） */
  timeoutMs?: number;
  /** 推論するモデル（gpt-5 系・o 系）の考える深さ（none / low / medium / high）。未指定はモデルの既定 */
  reasoningEffort?: string;
}

export interface TokenUsage {
  prompt: number;
  completion: number;
}

function isReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5|gpt-6)/.test(model);
}

/**
 * モデルが受け付ける考える深さにそろえる。gpt-6 系（gpt-6-astra・gpt-6.1-sol など）は none・minimal を受け付けず low からなので、
 * none・minimal は low にする（2026-10 時点の API の仕様）
 */
export function reasoningEffortFor(model: string, effort?: string): string | undefined {
  if (!effort) return undefined;
  if (/^gpt-6/.test(model) && (effort === "none" || effort === "minimal")) return "low";
  return effort;
}

function chatBody(o: ChatOptions, stream: boolean): Record<string, unknown> {
  const model = o.model ?? env.chatModel;
  const body: Record<string, unknown> = { model, messages: o.messages, stream };
  if (stream) body.stream_options = { include_usage: true };
  if (isReasoningModel(model)) {
    // 推論の分も出力のトークンに数えられるので、上限は多めに
    const effort = reasoningEffortFor(model, o.reasoningEffort);
    body.max_completion_tokens = Math.max(o.maxTokens ?? 1500, 1500) + (effort && effort !== "none" ? 4000 : 0);
    if (effort) body.reasoning_effort = effort;
  } else {
    body.temperature = o.temperature ?? 0.3;
    body.max_tokens = o.maxTokens ?? 800;
  }
  if (o.jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: o.jsonSchema.name, strict: true, schema: o.jsonSchema.schema },
    };
  }
  return body;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** 回答の文と、終わり方（stop＝最後まで書けた・length＝長さの上限で切れた など） */
export async function chatCompletionResult(o: ChatOptions): Promise<{ text: string; finish: string }> {
  const res = await post("/chat/completions", chatBody(o, false), undefined, o.timeoutMs ?? 45_000);
  const json = (await res.json()) as ChatCompletionResponse;
  void recordTokens(o.purpose ?? "chat", { prompt: json.usage?.prompt_tokens ?? 0, completion: json.usage?.completion_tokens ?? 0 });
  return { text: json.choices?.[0]?.message?.content ?? "", finish: json.choices?.[0]?.finish_reason ?? "" };
}

export async function chatCompletion(o: ChatOptions): Promise<string> {
  return (await chatCompletionResult(o)).text;
}

export async function chatCompletionJson<T>(
  o: ChatOptions & { jsonSchema: NonNullable<ChatOptions["jsonSchema"]> },
): Promise<T> {
  const text = await chatCompletion(o);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new OpenAIError(`モデル応答のJSON解析に失敗しました: ${text.slice(0, 200)}`, 502);
  }
}

/**
 * テキスト差分だけを流す ReadableStream を返す。
 * 注意：pull 方式 + AbortSignal.timeout + pipeThrough の組み合わせは Next.js の Node ランタイムで
 * 応答がヘッダー送出前に止まる事象を確認したため、push 方式（start 内で読み切る）＋明示的な
 * AbortController タイマーで実装し、完了時の全文は onComplete で通知する。
 */
export async function streamChatCompletion(
  o: ChatOptions,
  /** finish：stop＝最後まで書けた・length＝長さの上限で切れた・cut＝通信が途中で切れた */
  onComplete?: (fullText: string, usage: TokenUsage, hidden: string, finish: string) => void | Promise<void>,
  /**
   * 出力の先頭の、この印まで（資料から引用した根拠など）はお客様に送らない。onComplete には印のあとだけを渡す。
   * 印が出なかったときは onMissing(全文) を送る
   */
  hide?: { until: string; onMissing: (all: string) => string },
): Promise<ReadableStream<Uint8Array>> {
  if (!env.hasOpenAI) throw new OpenAIError("OPENAI_API_KEY が設定されていません", 401);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 55_000);
  let res: Response;
  try {
    res = await fetch(`${base()}/chat/completions`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(chatBody(o, true)),
      signal: ac.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new OpenAIError(`OpenAI API に接続できません: ${(e as Error).message}`, 502);
  }
  if (!res.ok) {
    clearTimeout(timer);
    const text = await res.text().catch(() => "");
    throw new OpenAIError(`OpenAI API error ${res.status}: ${text.slice(0, 600)}`, res.status);
  }
  if (!res.body) {
    clearTimeout(timer);
    throw new OpenAIError("ストリーム応答がありません", 502);
  }
  const upstream = res.body;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      let buffer = "";
      let full = "";
      const usage: TokenUsage = { prompt: 0, completion: 0 };
      // 印（hide.until）より前は送らずにためておく。印のあとは空白を除いてから送り始める
      let shownFrom = hide ? -1 : 0;
      let lead = Boolean(hide);
      let sent = "";
      let finish = "";
      const emit = (s: string) => {
        let text = s;
        if (lead) {
          text = text.replace(/^\s+/, "");
          if (!text) return;
          lead = false;
        }
        sent += text;
        controller.enqueue(encoder.encode(text));
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const data = t.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const j = JSON.parse(data) as {
                choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
                usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
              };
              if (j.choices?.[0]?.finish_reason) finish = j.choices[0].finish_reason;
              if (j.usage) {
                usage.prompt = j.usage.prompt_tokens ?? 0;
                usage.completion = j.usage.completion_tokens ?? 0;
              }
              const delta = j.choices?.[0]?.delta?.content;
              if (delta) {
                full += delta;
                if (shownFrom >= 0) emit(delta);
                else if (hide) {
                  const i = full.indexOf(hide.until);
                  if (i >= 0) {
                    shownFrom = i + hide.until.length;
                    emit(full.slice(shownFrom));
                  }
                }
              }
            } catch {
              // 不完全なJSONは無視
            }
          }
        }
      } catch (e) {
        clearTimeout(timer);
        finish = "cut";
        if (sent) {
          controller.enqueue(encoder.encode("\n（通信が途中で切断されました）"));
        } else if (!full) {
          controller.error(e);
          return;
        }
      }
      clearTimeout(timer);
      // 印が出なかった（形式どおりでない・途中で切れた）：根拠の部分を除いた残りを送る
      if (hide && shownFrom < 0) emit(hide.onMissing(full));
      void recordTokens(o.purpose ?? "chat", usage);
      try {
        await onComplete?.(sent.trim(), usage, hide ? full.slice(0, shownFrom >= 0 ? shownFrom - hide.until.length : full.length) : "", finish);
      } catch {
        // 完了処理の失敗は応答に影響させない
      }
      controller.close();
    },
    cancel() {
      clearTimeout(timer);
      ac.abort();
    },
  });
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await post("/embeddings", { model: env.embeddingModel, input: texts }, undefined, 20_000);
  const json = (await res.json()) as { data: { embedding: number[]; index: number }[]; usage?: { prompt_tokens?: number } };
  void recordTokens("embedding", { embedding: json.usage?.prompt_tokens ?? 0 });
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function synthesizeSpeech(
  text: string,
  opts: { voice?: string; instructions?: string; format?: "mp3" | "wav" } = {},
): Promise<ArrayBuffer> {
  const body: Record<string, unknown> = {
    model: env.ttsModel,
    voice: opts.voice ?? env.ttsVoice,
    input: text,
    response_format: opts.format ?? "mp3",
  };
  if (opts.instructions && /tts/.test(env.ttsModel)) body.instructions = opts.instructions;
  const res = await post("/audio/speech", body, undefined, 30_000);
  void recordTokens("tts", {});
  return res.arrayBuffer();
}

export interface RealtimeSecret {
  value: string;
  expiresAt: number;
  model: string;
  api: "ga" | "beta";
}

/** Realtime API 用の一時キー（ephemeral key）を発行。GAエンドポイント→旧β版の順に試す */
/**
 * 声の相談の話し終わりの判定。応答の開始と割り込みはブラウザ側（useVoiceSession・voice-gate.ts）で行う
 * （サーバーに任せると、AI が話している間の相づち「はい」や雑音でも AI の声が止まり、途中で切れて聞こえるため）
 *   semantic：話の内容から話し終わりを判断（「えっと…」「8畳で、…」のような言葉の途中の間で区切らない）
 *   server  ：無音が 0.65 秒続いたら話し終わり
 */
export function realtimeTurnDetection() {
  return env.realtimeTurn === "semantic"
    ? ({ type: "semantic_vad", eagerness: "auto", create_response: false, interrupt_response: false } as const)
    : ({ type: "server_vad", threshold: 0.6, prefix_padding_ms: 300, silence_duration_ms: 650, create_response: false, interrupt_response: false } as const);
}

/** 文字起こしの設定（新しいモデルは languages で言語を指定する） */
function transcriptionConfig() {
  const model = env.transcribeModel;
  return /^gpt-(live-)?transcribe$/.test(model) ? { model, languages: ["ja"] } : { model, language: "ja" };
}


export async function createRealtimeSecret(opts: {
  instructions: string;
  tools: unknown[];
  voice?: string;
}): Promise<RealtimeSecret> {
  const model = env.realtimeModel;
  const voice = opts.voice ?? env.realtimeVoice;
  let gaError: OpenAIError | null = null;
  try {
    const res = await post(
      "/realtime/client_secrets",
      {
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        type: "realtime",
        model,
        instructions: opts.instructions,
        tools: opts.tools,
        tool_choice: "auto",
        // gpt-realtime-2 系は話す前に考える。深く考えるほど、答える前・話の途中の無言が長くなる（既定 minimal）
        ...(/^gpt-realtime-2/.test(model) ? { reasoning: { effort: env.realtimeReasoning } } : {}),
        audio: {
          input: {
            // 文字起こし：言葉の手がかり（prompt）は渡さない（雑音のときに手がかりの文をそのまま返し、
            //   お客様が言っていない言葉が会話に入ることがあるため。雑音のある試験で誤りも増えた）
            transcription: transcriptionConfig(),
            // AI の声が途中で切れないように：割り込み（AI の発話を止める）と応答の開始はブラウザが判断する
            //   （voice-gate.ts：AI が話している間の短い音＝相づち・咳・雑音・スピーカーの回り込みでは止めない）
            //   雑音除去はスマホ・ノート PC のスピーカー利用（far_field）向け
            turn_detection: realtimeTurnDetection(),
            noise_reduction: { type: "far_field" },
          },
          output: { voice, speed: env.realtimeSpeed },
        },
      },
      },
      undefined,
      15_000,
    );
    const json = (await res.json()) as { value: string; expires_at: number };
    void recordTokens("realtime_session", {});
    return { value: json.value, expiresAt: json.expires_at, model, api: "ga" };
  } catch (e) {
    if (!(e instanceof OpenAIError) || (e.status !== 404 && e.status !== 400)) throw e;
    gaError = e;
  }
  try {
    const res = await post(
      "/realtime/sessions",
      {
        model,
        voice,
        instructions: opts.instructions,
        tools: opts.tools,
        tool_choice: "auto",
        input_audio_transcription: { model: "whisper-1", language: "ja" },
        turn_detection: realtimeTurnDetection(),
        input_audio_noise_reduction: { type: "far_field" },
      },
      { "OpenAI-Beta": "realtime=v1" },
      15_000,
    );
    const json = (await res.json()) as { client_secret: { value: string; expires_at: number } };
    return { value: json.client_secret.value, expiresAt: json.client_secret.expires_at, model, api: "beta" };
  } catch {
    throw gaError;
  }
}

export async function verifyOpenAI(): Promise<{ ok: boolean; detail: string }> {
  if (!env.hasOpenAI) return { ok: false, detail: "OPENAI_API_KEY 未設定（デモモードで動作中）" };
  try {
    const res = await fetch(`${base()}/models/${encodeURIComponent(env.chatModel)}`, {
      headers: headers(),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true, detail: `接続OK（${env.chatModel}）` };
    const t = await res.text();
    return { ok: false, detail: `HTTP ${res.status}: ${t.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}
