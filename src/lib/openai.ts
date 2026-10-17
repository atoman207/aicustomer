// OpenAI REST API の薄いラッパー（SDK非依存・サーバー専用）
import { env } from "./env";

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

async function post(path: string, body: unknown, extra?: Record<string, string>): Promise<Response> {
  if (!env.hasOpenAI) throw new OpenAIError("OPENAI_API_KEY が設定されていません", 401);
  const res = await fetch(`${base()}${path}`, { method: "POST", headers: headers(extra), body: JSON.stringify(body) });
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
}

function isReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5)/.test(model);
}

function chatBody(o: ChatOptions, stream: boolean): Record<string, unknown> {
  const model = o.model ?? env.chatModel;
  const body: Record<string, unknown> = { model, messages: o.messages, stream };
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
}

export async function chatCompletion(o: ChatOptions): Promise<string> {
  const res = await post("/chat/completions", chatBody(o, false));
  const json = (await res.json()) as ChatCompletionResponse;
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

/** テキスト差分だけを流す ReadableStream を返す */
export async function streamChatCompletion(o: ChatOptions): Promise<ReadableStream<Uint8Array>> {
  const res = await post("/chat/completions", chatBody(o, true));
  if (!res.body) throw new OpenAIError("ストリーム応答がありません", 502);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const data = t.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
          const delta = j.choices?.[0]?.delta?.content;
          if (delta) controller.enqueue(encoder.encode(delta));
        } catch {
          // 不完全なJSONは無視
        }
      }
    },
    cancel() {
      reader.cancel().catch(() => undefined);
    },
  });
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await post("/embeddings", { model: env.embeddingModel, input: texts });
  const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
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
  const res = await post("/audio/speech", body);
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
    const res = await post("/realtime/client_secrets", {
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
    });
    const json = (await res.json()) as { value: string; expires_at: number };
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
    const res = await fetch(`${base()}/models/${encodeURIComponent(env.chatModel)}`, { headers: headers() });
    if (res.ok) return { ok: true, detail: `接続OK（${env.chatModel}）` };
    const t = await res.text();
    return { ok: false, detail: `HTTP ${res.status}: ${t.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}
