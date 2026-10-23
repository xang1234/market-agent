import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import {
  LlmClientError,
  type LlmChatClient,
  type LlmClientExecutionOptions,
  type LlmChatMessage,
  type LlmChatRequest,
  type LlmChatResult,
  LlmProviderError,
  type LlmReasoningLevel,
} from "./router.ts";
import { type LlmApi, type LlmDeployment, LLM_PROTOCOLS } from "./channel-config.ts";

type PiTextContent = {
  type: "text";
  text: string;
};

type PiContentBlock = PiTextContent | Record<string, unknown>;

type PiAssistantMessage = {
  content?: ReadonlyArray<PiContentBlock>;
  stopReason?: string;
  /** The provider's own stop reason, set only when the model ended the turn. */
  rawStopReason?: string;
  errorMessage?: string;
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number; reasoning?: number };
};

// pi-ai sizes the context from each assistant turn's usage (clampMaxTokensToContext),
// so an earlier answer is a whole assistant message: its text, the model, and no usage.
type PiContextMessage =
  | { role: "user"; content: string; timestamp: number }
  | {
    role: "assistant";
    content: ReadonlyArray<PiTextContent>;
    api: LlmApi;
    provider: string;
    model: string;
    usage: typeof NO_USAGE;
    stopReason: "stop";
    timestamp: number;
  };

type PiContext = {
  systemPrompt?: string;
  messages: ReadonlyArray<PiContextMessage>;
};

const NO_USAGE = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }),
});

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
  api: LlmApi;
  provider: string;
  baseUrl: string;
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
  // pi-ai's streamSimple clamps the level and reads "off" as thinking disabled.
  reasoning?: LlmReasoningLevel;
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
  const [pi, completions, anthropic, builtins] = await Promise.all([
    import("@earendil-works/pi-ai"),
    import("@earendil-works/pi-ai/api/openai-completions"),
    import("@earendil-works/pi-ai/api/anthropic-messages"),
    import("@earendil-works/pi-ai/providers/all"),
  ]);
  type StreamSimple = (model: unknown, context: unknown, options: unknown) => { result(): Promise<PiAssistantMessage> };
  const streams: Record<LlmApi, StreamSimple> = {
    "openai-completions": completions.streamSimple as unknown as StreamSimple,
    "anthropic-messages": anthropic.streamSimple as unknown as StreamSimple,
  };
  return createPiLlmChatClient({
    complete: (model, context, options) =>
      streams[model.api](model, pi.normalizeContext(context as never), options).result(),
    catalogModel: createCatalogLookup(
      builtins.getBuiltinProviders().flatMap((provider) => builtins.getBuiltinModels(provider) as PiCatalogEntry[]),
    ),
    clampLevel: (model, level) => pi.clampThinkingLevel(model as never, level) as LlmReasoningLevel,
  });
}

export type PiCatalogEntry = PiCatalogModel & { id: string; baseUrl: string; api: string };

/**
 * Finds a deployment's model in pi-ai's catalog by endpoint and model id, so a channel
 * named anything still finds it. The catalog may list a model under another API (OpenAI's
 * o3 is openai-responses); whether it reasons, its levels and limits still hold, but its
 * compat flags describe that API, so they're kept only when the entry's API is the one
 * the deployment speaks.
 */
export function createCatalogLookup(entries: Iterable<PiCatalogEntry>): (deployment: LlmDeployment) => PiCatalogModel | undefined {
  const catalog = new Map<string, PiCatalogEntry[]>();
  for (const entry of entries) {
    const key = catalogKey(entry.baseUrl, entry.id);
    catalog.set(key, [...catalog.get(key) ?? [], entry]);
  }
  return (deployment) => {
    const listed = catalog.get(catalogKey(deployment.baseUrl, deployment.model)) ?? [];
    const api = LLM_PROTOCOLS[deployment.protocol].api;
    const sameApi = listed.find((entry) => entry.api === api);
    return sameApi ?? (listed[0] && { ...listed[0], compat: undefined });
  };
}

type PiApiProfile = {
  /** Compat flags every model on this API gets. */
  compat: Readonly<Record<string, unknown>>;
  /** For a model the catalog doesn't list: the flags and levels a reasoning (or any) model gets. */
  uncatalogued: (reasoning: boolean) => Pick<PiCatalogModel, "compat" | "thinkingLevelMap">;
  /** OpenCode Go routes and caches a conversation by its x-opencode-session id. */
  sendsSessionHeader: boolean;
};

const API_PROFILES: Record<LlmApi, PiApiProfile> = {
  "openai-completions": {
    compat: { supportsStore: false },
    // pi-ai's default for an unknown reasoning model: OpenAI-style reasoning_effort.
    uncatalogued: (reasoning) => (reasoning ? { compat: { supportsReasoningEffort: true } } : {}),
    sendsSessionHeader: true,
  },
  "anthropic-messages": {
    compat: {},
    // Current Claude models reject temperature (Haiku 5.5 any non-default value) and budget
    // thinking, and have no "minimal" effort. pi-ai's anthropic module reads "off" as an
    // effort (high), and Opus 5.5 can't disable thinking, so both clamp to the lowest effort.
    uncatalogued: (reasoning) => ({
      compat: { supportsTemperature: false, ...(reasoning ? { forceAdaptiveThinking: true } : {}) },
      ...(reasoning ? { thinkingLevelMap: { off: null, minimal: null } } : {}),
    }),
    sendsSessionHeader: false,
  },
};

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
        contextFromRequest(request, model),
        optionsFromDeployment(deployment, request, execution, reasoningFor(model, request, input.clampLevel)),
      );
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        throw providerErrorFromMessage(message);
      }
      return resultFromMessage(message);
    } catch (error) {
      if (error instanceof LlmProviderError) throw error;
      if (isClientDefect(error)) throw new LlmClientError(error.message, { cause: error });
      throw providerErrorFromUnknown(error);
    }
  };
}

// The catalog describes the model when it lists it; otherwise a model the channel
// config names as reasoning (LLM_<NAME>_REASONING_MODELS) gets its API's guess, and
// any other model is treated as non-reasoning.
function modelFromDeployment(deployment: LlmDeployment, request: LlmChatRequest, known: PiCatalogModel | undefined): PiModel {
  // With no level requested the model is declared non-reasoning, so pi-ai sends nothing
  // and the provider default applies; for a reasoning model pi-ai would read a missing
  // level as "off" (e.g. DeepSeek's thinking: disabled), changing callers that never asked.
  const reasoning = request.reasoning !== undefined && (known?.reasoning ?? deployment.reasoning === true);
  const api = LLM_PROTOCOLS[deployment.protocol].api;
  const described = known ?? API_PROFILES[api].uncatalogued(reasoning);
  return {
    id: deployment.model,
    name: `${deployment.channel}/${deployment.model}`,
    api,
    provider: known?.provider ?? deployment.channel,
    baseUrl: deployment.baseUrl,
    reasoning,
    ...(described.thinkingLevelMap ? { thinkingLevelMap: described.thinkingLevelMap } : {}),
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: known?.contextWindow ?? 128000,
    maxTokens: request.maxTokens ?? 16384,
    compat: { ...API_PROFILES[api].compat, ...described.compat },
  };
}

// The requested level, moved to the nearest one the model supports (a model that can't
// switch reasoning off gets its lowest). An explicit "off" goes through, so pi-ai
// disables thinking in the model's own format. Nothing is sent for a non-reasoning
// model, or when the caller leaves it to the provider.
function reasoningFor(
  model: PiModel,
  request: LlmChatRequest,
  clamp: CreatePiLlmChatClientInput["clampLevel"],
): PiCompleteOptions["reasoning"] {
  if (!model.reasoning || request.reasoning === undefined) return undefined;
  return clamp ? clamp(model, request.reasoning) : request.reasoning;
}

function contextFromRequest(request: LlmChatRequest, model: PiModel): PiContext {
  const systemPrompt = messagesByRole(request.messages, "system").join("\n\n").trim();
  const timestamp = Date.now();
  const messages = request.messages
    .filter(isConversationMessage)
    .map((message): PiContextMessage => Object.freeze(message.role === "user"
      ? { role: "user", content: message.content, timestamp }
      : {
        role: "assistant",
        content: Object.freeze([Object.freeze({ type: "text" as const, text: message.content })]),
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: NO_USAGE,
        stopReason: "stop",
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
    // ponytail: every OpenAI-protocol provider gets x-opencode-session (others ignore an
    // opaque thread id). A call outside any conversation (a title, a channel test) is its own.
    headers: {
      "User-Agent": LLM_USER_AGENT,
      ...(API_PROFILES[LLM_PROTOCOLS[deployment.protocol].api].sendsSessionHeader
        ? { "x-opencode-session": conversation.getStore() ?? randomUUID() }
        : {}),
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
  // pi-ai reports cached prompt tokens apart from `input`; they're still input.
  const inputTokens = usage.input + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  return Object.freeze({
    text,
    ...truncated,
    usage: Object.freeze({
      inputTokens,
      outputTokens: usage.output,
      totalTokens: usage.totalTokens ?? inputTokens + usage.output,
      ...(typeof usage.reasoning === "number" ? { reasoningTokens: usage.reasoning } : {}),
    }),
  });
}

function providerErrorFromMessage(message: PiAssistantMessage): LlmProviderError {
  const text = message.errorMessage ?? "LLM provider returned an error response";
  // The model itself declined (a Claude refusal, a content filter): another model may
  // answer, whatever the explanation says ("unauthorized access" is not an auth failure).
  if (message.rawStopReason !== undefined) return new LlmProviderError("provider_failed", text);
  return providerErrorFromText(text);
}

function providerErrorFromUnknown(error: unknown): LlmProviderError {
  const status = statusFromError(error);
  const message = error instanceof Error ? error.message : "LLM provider request failed";
  // pi-ai passes an Anthropic error on as text, so its error type is all that carries the status.
  if (status === 401 || status === 403 || /auth|api key|unauthori[sz]ed|forbidden|permission_error/iu.test(message)) {
    return new LlmProviderError("auth_failed", message);
  }
  if (status === 404 || /model.*(not found|missing|does not exist)|unknown model|not_found_error/iu.test(message)) {
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

// A built-in error thrown out of complete() is pi-ai's own code failing: pi-ai reports a
// failure after the request is sent as a message with stopReason "error", not a throw.
// ponytail: fetch's own "fetch failed" TypeError is the network, so it stays a provider failure.
function isClientDefect(error: unknown): error is Error {
  return (error instanceof TypeError || error instanceof ReferenceError || error instanceof RangeError) &&
    statusFromError(error) === null && error.message !== "fetch failed";
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
