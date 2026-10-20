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
export interface ChatInputMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOptions {
  messages: ChatInputMessage[];
  temperature?: number;
  maxTokens?: number;
  model?: string;
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /** 利用状況の記録用（chat / agent / summarize など） */
  purpose?: string;
}

export interface TokenUsage {
  prompt: number;
  completion: number;
}

function isReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5)/.test(model);
}

function chatBody(o: ChatOptions, stream: boolean): Record<string, unknown> {
  const model = o.model ?? env.chatModel;
  const body: Record<string, unknown> = { model, messages: o.messages, stream };
  if (stream) body.stream_options = { include_usage: true };
  if (isReasoningModel(model)) {
    body.max_completion_tokens = o.maxTokens ?? 1500;
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
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export async function chatCompletion(o: ChatOptions): Promise<string> {
  const res = await post("/chat/completions", chatBody(o, false), undefined, 45_000);
  const json = (await res.json()) as ChatCompletionResponse;
  void recordTokens(o.purpose ?? "chat", { prompt: json.usage?.prompt_tokens ?? 0, completion: json.usage?.completion_tokens ?? 0 });
  return json.choices?.[0]?.message?.content ?? "";
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
  onComplete?: (fullText: string, usage: TokenUsage) => void | Promise<void>,
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
                choices?: { delta?: { content?: string } }[];
                usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
              };
              if (j.usage) {
                usage.prompt = j.usage.prompt_tokens ?? 0;
                usage.completion = j.usage.completion_tokens ?? 0;
              }
              const delta = j.choices?.[0]?.delta?.content;
              if (delta) {
                full += delta;
                controller.enqueue(encoder.encode(delta));
              }
            } catch {
              // 不完全なJSONは無視
            }
          }
        }
      } catch (e) {
        clearTimeout(timer);
        if (full) {
          controller.enqueue(encoder.encode("\n（通信が途中で切断されました）"));
        } else {
          controller.error(e);
          return;
        }
      }
      clearTimeout(timer);
      void recordTokens(o.purpose ?? "chat", usage);
      try {
        await onComplete?.(full, usage);
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
        audio: {
          input: {
            transcription: { model: "gpt-4o-mini-transcribe", language: "ja" },
            turn_detection: { type: "semantic_vad", eagerness: "medium", create_response: true, interrupt_response: true },
            noise_reduction: { type: "near_field" },
          },
          output: { voice },
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
        turn_detection: { type: "server_vad" },
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
