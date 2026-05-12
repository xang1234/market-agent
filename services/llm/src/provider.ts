import {
  LlmAuthError,
  LlmBadResponseError,
  LlmRateLimitError,
  LlmTransportError,
} from "./errors.ts";
import type { LlmReasoningEffort } from "./providers/catalog.ts";

export type LlmFetch = (
  input: string | URL,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
  body: ReadableStream<Uint8Array> | null;
}>;

export type LlmChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
};

export type LlmToolSchema = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

export type LlmResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean } };

export type LlmChatRequest = {
  messages: ReadonlyArray<LlmChatMessage>;
  tools?: ReadonlyArray<LlmToolSchema>;
  toolChoice?: "auto" | "required" | "none";
  responseFormat?: LlmResponseFormat;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
};

export type LlmToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type LlmChatCompletion = {
  text: string;
  toolCalls: ReadonlyArray<LlmToolCall>;
  finishReason: string | null;
  usage: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null };
  raw: unknown;
};

export type OpenAiCompatibleProviderConfig = {
  providerId: string;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  reasoningEffort?: LlmReasoningEffort | null;
  supportsReasoningEffort?: boolean;
  fetchImpl?: LlmFetch;
  defaultHeaders?: Record<string, string>;
};

export type LlmProvider = {
  readonly providerId: string;
  readonly model: string;
  chatComplete(request: LlmChatRequest): Promise<LlmChatCompletion>;
};

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly providerId: string;
  readonly model: string;
  readonly #baseUrl: string;
  readonly #apiKey: string | null;
  readonly #reasoningEffort: LlmReasoningEffort | null;
  readonly #supportsReasoningEffort: boolean;
  readonly #fetch: LlmFetch;
  readonly #defaultHeaders: Record<string, string>;

  constructor(config: OpenAiCompatibleProviderConfig) {
    if (typeof config.baseUrl !== "string" || config.baseUrl.trim() === "") {
      throw new Error("baseUrl is required");
    }
    if (typeof config.model !== "string" || config.model.trim() === "") {
      throw new Error("model is required");
    }
    this.providerId = config.providerId;
    this.model = config.model.trim();
    this.#baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.#apiKey = config.apiKey?.trim() ? config.apiKey.trim() : null;
    this.#reasoningEffort = config.reasoningEffort ?? null;
    this.#supportsReasoningEffort = config.supportsReasoningEffort ?? false;
    this.#fetch = config.fetchImpl ?? (globalThis.fetch as unknown as LlmFetch);
    this.#defaultHeaders = config.defaultHeaders ?? {};
    if (typeof this.#fetch !== "function") {
      throw new Error("a fetch implementation is required");
    }
  }

  async chatComplete(request: LlmChatRequest): Promise<LlmChatCompletion> {
    const body = this.#buildRequestBody(request);
    const url = `${this.#baseUrl}/chat/completions`;
    let response: Awaited<ReturnType<LlmFetch>>;
    try {
      response = await this.#fetch(url, {
        method: "POST",
        headers: this.#buildHeaders(),
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (error) {
      throw new LlmTransportError(`transport failed: ${describeError(error)}`, {
        providerId: this.providerId,
        cause: error,
      });
    }

    if (!response.ok) {
      const errorText = await safeText(response);
      const status = response.status;
      if (status === 401 || status === 403) {
        throw new LlmAuthError(`provider rejected credentials (${status})`, {
          status,
          providerId: this.providerId,
          cause: errorText,
        });
      }
      if (status === 429) {
        throw new LlmRateLimitError(`provider rate limited (${status})`, {
          status,
          providerId: this.providerId,
          retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
          cause: errorText,
        });
      }
      throw new LlmTransportError(`provider returned ${status}: ${errorText}`, {
        providerId: this.providerId,
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new LlmBadResponseError(`response was not valid JSON: ${describeError(error)}`, {
        providerId: this.providerId,
        cause: error,
      });
    }
    return parseCompletion(payload, this.providerId);
  }

  #buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...this.#defaultHeaders,
    };
    if (this.#apiKey !== null) {
      headers["authorization"] = `Bearer ${this.#apiKey}`;
    }
    return headers;
  }

  #buildRequestBody(request: LlmChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: request.messages.map((message) => ({ ...message })),
    };
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: tool.type,
        function: { ...tool.function },
      }));
      if (request.toolChoice !== undefined) {
        body.tool_choice = request.toolChoice;
      }
    }
    if (request.responseFormat !== undefined) {
      body.response_format = request.responseFormat;
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens;
    }
    if (
      this.#supportsReasoningEffort &&
      this.#reasoningEffort !== null &&
      this.#reasoningEffort !== "off"
    ) {
      body.reasoning_effort = this.#reasoningEffort;
    }
    return body;
  }
}

function parseCompletion(payload: unknown, providerId: string): LlmChatCompletion {
  if (payload === null || typeof payload !== "object") {
    throw new LlmBadResponseError("response was not an object", { providerId });
  }
  const root = payload as Record<string, unknown>;
  const choices = root.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new LlmBadResponseError("response.choices is missing or empty", { providerId });
  }
  const choice = choices[0] as Record<string, unknown>;
  const message = (choice.message ?? {}) as Record<string, unknown>;
  const text = typeof message.content === "string" ? message.content : "";
  const toolCalls = parseToolCalls(message.tool_calls);
  const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : null;
  const usage = parseUsage(root.usage);
  return Object.freeze({
    text,
    toolCalls,
    finishReason,
    usage,
    raw: payload,
  });
}

function parseToolCalls(value: unknown): ReadonlyArray<LlmToolCall> {
  if (!Array.isArray(value)) return Object.freeze([]);
  const toolCalls: LlmToolCall[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    const fn = (record.function ?? {}) as Record<string, unknown>;
    const name = typeof fn.name === "string" ? fn.name : "";
    const args = typeof fn.arguments === "string" ? fn.arguments : "";
    if (id === "" || name === "") continue;
    toolCalls.push(Object.freeze({ id, name, arguments: args }));
  }
  return Object.freeze(toolCalls);
}

function parseUsage(value: unknown): LlmChatCompletion["usage"] {
  if (value === null || typeof value !== "object") {
    return Object.freeze({ promptTokens: null, completionTokens: null, totalTokens: null });
  }
  const record = value as Record<string, unknown>;
  return Object.freeze({
    promptTokens: nullableNumber(record.prompt_tokens),
    completionTokens: nullableNumber(record.completion_tokens),
    totalTokens: nullableNumber(record.total_tokens),
  });
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  return undefined;
}

async function safeText(response: Awaited<ReturnType<LlmFetch>>): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return String(error);
}
