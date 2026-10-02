import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import {
  type LlmChatClient,
  type LlmClientExecutionOptions,
  type LlmChatMessage,
  type LlmChatRequest,
  type LlmChatResult,
  LlmProviderError,
  type LlmReasoningLevel,
} from "./router.ts";
import type { LlmDeployment } from "./channel-config.ts";

type PiTextContent = {
  type: "text";
  text: string;
};

type PiContentBlock = PiTextContent | Record<string, unknown>;

type PiAssistantMessage = {
  content?: ReadonlyArray<PiContentBlock>;
  stopReason?: string;
  errorMessage?: string;
  usage?: { input?: number; output?: number; totalTokens?: number; reasoning?: number };
};

type PiContext = {
  systemPrompt?: string;
  messages: ReadonlyArray<{
    role: "user" | "assistant";
    content: string;
    timestamp: number;
  }>;
};

// What pi-ai's model catalog knows about a model: whether it reasons, which effort
// levels it supports (and their provider values), and its API quirks.
export type PiCatalogModel = {
  /** pi-ai keys some provider quirks on this id, whatever the channel is called here. */
  provider?: string;
  reasoning: boolean;
  thinkingLevelMap?: Readonly<Record<string, string | null | undefined>>;
  compat?: Readonly<Record<string, unknown>>;
  contextWindow?: number;
  /** The model's output limit; a request for more is capped to it. */
  maxTokens?: number;
};

export type PiModel = {
  id: string;
  name: string;
  api: "openai-completions";
  provider: string;
  baseUrl?: string;
  reasoning: boolean;
  thinkingLevelMap?: PiCatalogModel["thinkingLevelMap"];
  input: Array<"text">;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  compat: Readonly<Record<string, unknown>>;
};

type PiCompleteOptions = {
  apiKey?: string;
  headers?: Record<string, string>;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  reasoning?: Exclude<LlmReasoningLevel, "off">;
};

// Providers see this app by name, not the SDK's generic user agent; OpenCode Go
// requires it, along with a stable per-conversation session id (below).
export const LLM_USER_AGENT = "market-agent/0.1";

const conversation = new AsyncLocalStorage<string>();

/**
 * Runs `fn` with every LLM call made inside it, including async work it starts,
 * tagged as one conversation (a chat thread), so the provider can route and cache
 * the conversation's calls together.
 */
export function withLlmConversation<T>(conversationId: string, fn: () => T): T {
  return conversation.run(conversationId, fn);
}

export type PiComplete = (
  model: PiModel,
  context: PiContext,
  options: PiCompleteOptions,
) => Promise<PiAssistantMessage> | PiAssistantMessage;

export type CreatePiLlmChatClientInput = {
  complete: PiComplete;
  /** The catalog's entry for a deployment's model on its endpoint, if listed. */
  catalogModel?: (deployment: LlmDeployment) => PiCatalogModel | undefined;
  /** The nearest reasoning level the model supports (pi-ai's clampThinkingLevel). */
  clampLevel?: (model: PiModel, level: LlmReasoningLevel) => LlmReasoningLevel;
};

export async function createDefaultPiLlmChatClient(): Promise<LlmChatClient> {
  const [pi, completions, builtins] = await Promise.all([
    import("@earendil-works/pi-ai"),
    import("@earendil-works/pi-ai/api/openai-completions"),
    import("@earendil-works/pi-ai/providers/all"),
  ]);
  type StreamSimple = (model: unknown, context: unknown, options: unknown) => { result(): Promise<PiAssistantMessage> };
  return createPiLlmChatClient({
    complete: (model, context, options) =>
      (completions.streamSimple as unknown as StreamSimple)(model, pi.normalizeContext(context as never), options).result(),
    catalogModel: createCatalogLookup(
      builtins.getBuiltinProviders().flatMap((provider) => builtins.getBuiltinModels(provider) as PiCatalogEntry[]),
    ),
    clampLevel: (model, level) => pi.clampThinkingLevel(model as never, level) as LlmReasoningLevel,
  });
}

export type PiCatalogEntry = PiCatalogModel & { id: string; baseUrl: string; api: string };

// The endpoint a protocol uses when its channel sets no base URL.
const IMPLICIT_BASE_URLS: Readonly<Record<string, string>> = { openai: "https://api.openai.com/v1" };

/**
 * Finds a deployment's model in pi-ai's catalog by endpoint and model id, so a channel
 * named anything still finds it. The catalog may list a model under another API (OpenAI's
 * o3 is openai-responses); whether it reasons, its levels and limits still hold, but its
 * compat flags describe that API, so they're kept only for openai-completions entries,
 * the API every channel speaks here.
 */
export function createCatalogLookup(entries: Iterable<PiCatalogEntry>): (deployment: LlmDeployment) => PiCatalogModel | undefined {
  const catalog = new Map<string, PiCatalogModel>();
  for (const entry of entries) {
    const key = catalogKey(entry.baseUrl, entry.id);
    if (entry.api === "openai-completions") catalog.set(key, entry);
    else if (!catalog.has(key)) catalog.set(key, { ...entry, compat: undefined });
  }
  return (deployment) => {
    const baseUrl = deployment.baseUrl ?? IMPLICIT_BASE_URLS[deployment.protocol];
    return baseUrl === undefined ? undefined : catalog.get(catalogKey(baseUrl, deployment.model));
  };
}

const catalogKey = (baseUrl: string, modelId: string) => `${baseUrl.replace(/\/+$/u, "")}\u0000${modelId}`;

export function createPiLlmChatClient(input: CreatePiLlmChatClientInput): LlmChatClient {
  return async (deployment, requested, execution = {}) => {
    try {
      const known = input.catalogModel?.(deployment);
      // Never ask for more output than the model allows: the provider may reject it.
      // ponytail: unknown models get the request as is; their limit isn't known.
      const request = known?.maxTokens !== undefined && (requested.maxTokens ?? 0) > known.maxTokens
        ? { ...requested, maxTokens: known.maxTokens }
        : requested;
      const model = modelFromDeployment(deployment, request, known);
      const message = await input.complete(
        model,
        contextFromRequest(request),
        optionsFromDeployment(deployment, request, execution, reasoningFor(model, request, input.clampLevel)),
      );
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        throw providerErrorFromMessage(message);
      }
      return resultFromMessage(message);
    } catch (error) {
      if (error instanceof LlmProviderError) throw error;
      throw providerErrorFromUnknown(error);
    }
  };
}

// The catalog describes the model when it lists it; otherwise a model the channel
// config names as reasoning (LLM_<NAME>_REASONING_MODELS) gets pi-ai's default,
// OpenAI-style reasoning_effort, and any other model is treated as non-reasoning.
function modelFromDeployment(deployment: LlmDeployment, request: LlmChatRequest, known: PiCatalogModel | undefined): PiModel {
  const reasoning = known?.reasoning ?? deployment.reasoning === true;
  return {
    id: deployment.model,
    name: `${deployment.channel}/${deployment.model}`,
    api: "openai-completions",
    provider: known?.provider ?? deployment.channel,
    ...(deployment.baseUrl === null ? {} : { baseUrl: deployment.baseUrl }),
    reasoning,
    ...(known?.thinkingLevelMap ? { thinkingLevelMap: known.thinkingLevelMap } : {}),
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: known?.contextWindow ?? 128000,
    maxTokens: request.maxTokens ?? 16384,
    compat: {
      supportsStore: false,
      ...(known === undefined && reasoning ? { supportsReasoningEffort: true } : {}),
      ...known?.compat,
    },
  };
}

// The requested level, moved to the nearest one the model supports (a model that can't
// switch reasoning off gets its lowest). Nothing is sent for a non-reasoning model, or
// when the caller leaves it to the provider.
function reasoningFor(
  model: PiModel,
  request: LlmChatRequest,
  clamp: CreatePiLlmChatClientInput["clampLevel"],
): PiCompleteOptions["reasoning"] {
  if (!model.reasoning || request.reasoning === undefined) return undefined;
  const level = clamp ? clamp(model, request.reasoning) : request.reasoning;
  return level === "off" ? undefined : level;
}

function contextFromRequest(request: LlmChatRequest): PiContext {
  const systemPrompt = messagesByRole(request.messages, "system").join("\n\n").trim();
  const timestamp = Date.now();
  const messages = request.messages
    .filter(isConversationMessage)
    .map((message) => Object.freeze({
      role: message.role,
      content: message.content,
      timestamp,
    }));
  return Object.freeze({
    ...(systemPrompt.length === 0 ? {} : { systemPrompt }),
    messages: Object.freeze(messages),
  });
}

function isConversationMessage(
  message: LlmChatMessage,
): message is LlmChatMessage & { role: "user" | "assistant" } {
  return message.role === "user" || message.role === "assistant";
}

function optionsFromDeployment(
  deployment: LlmDeployment,
  request: LlmChatRequest,
  execution: LlmClientExecutionOptions,
  reasoning: PiCompleteOptions["reasoning"],
): PiCompleteOptions {
  return Object.freeze({
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(deployment.apiKeys[0] ? { apiKey: deployment.apiKeys[0] } : {}),
    // ponytail: sent to every provider (others ignore x-opencode-session; it's an opaque
    // thread id). A call outside any conversation (a title, a channel test) is its own.
    headers: {
      "User-Agent": LLM_USER_AGENT,
      "x-opencode-session": conversation.getStore() ?? randomUUID(),
    },
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
    ...(execution.signal === undefined ? {} : { signal: execution.signal }),
  });
}

function resultFromMessage(message: PiAssistantMessage): LlmChatResult {
  const text = (message.content ?? [])
    .filter(isPiTextContent)
    .map((block) => block.text)
    .join("\n")
    .trim();
  // A reply that hit maxTokens can look complete; callers decide whether to show it.
  const truncated = message.stopReason === "length" ? { truncated: true } : {};
  const usage = message.usage;
  if (usage === undefined || typeof usage.input !== "number" || typeof usage.output !== "number") {
    return Object.freeze({ text, ...truncated });
  }
  return Object.freeze({
    text,
    ...truncated,
    usage: Object.freeze({
      inputTokens: usage.input,
      outputTokens: usage.output,
      totalTokens: usage.totalTokens ?? usage.input + usage.output,
      ...(typeof usage.reasoning === "number" ? { reasoningTokens: usage.reasoning } : {}),
    }),
  });
}

function providerErrorFromMessage(message: PiAssistantMessage): LlmProviderError {
  return providerErrorFromText(message.errorMessage ?? "LLM provider returned an error response");
}

function providerErrorFromUnknown(error: unknown): LlmProviderError {
  const status = statusFromError(error);
  const message = error instanceof Error ? error.message : "LLM provider request failed";
  if (status === 401 || status === 403 || /auth|api key|unauthori[sz]ed|forbidden/iu.test(message)) {
    return new LlmProviderError("auth_failed", message);
  }
  if (status === 404 || /model.*(not found|missing|does not exist)|unknown model/iu.test(message)) {
    return new LlmProviderError("model_not_found", message);
  }
  if (status === 429 || /rate limit|too many requests/iu.test(message)) {
    return new LlmProviderError("rate_limited", message);
  }
  if (/timeout|timed out|abort/iu.test(message)) {
    return new LlmProviderError("timeout", message);
  }
  return new LlmProviderError("provider_failed", message);
}

function providerErrorFromText(message: string): LlmProviderError {
  return providerErrorFromUnknown(new Error(message));
}

function statusFromError(error: unknown): number | null {
  if (error === null || typeof error !== "object") return null;
  const status = (error as { status?: unknown; statusCode?: unknown }).status ??
    (error as { statusCode?: unknown }).statusCode;
  return typeof status === "number" && Number.isInteger(status) ? status : null;
}

function messagesByRole(messages: ReadonlyArray<LlmChatMessage>, role: LlmChatMessage["role"]): string[] {
  return messages
    .filter((message) => message.role === role)
    .map((message) => message.content.trim())
    .filter((content) => content.length > 0);
}

function isPiTextContent(block: PiContentBlock): block is PiTextContent {
  return block.type === "text" && typeof (block as { text?: unknown }).text === "string";
}
