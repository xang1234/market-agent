import {
  type LlmChatClient,
  type LlmChatMessage,
  type LlmChatRequest,
  type LlmChatResult,
  LlmProviderError,
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
};

type PiContext = {
  systemPrompt?: string;
  messages: ReadonlyArray<{
    role: "user" | "assistant";
    content: string;
  }>;
};

type PiModel = {
  id: string;
  name: string;
  api: "openai-completions";
  provider: string;
  baseUrl?: string;
  reasoning: false;
  input: Array<"text">;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  compat: {
    supportsStore: false;
  };
};

type PiCompleteOptions = {
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
};

export type PiComplete = (
  model: PiModel,
  context: PiContext,
  options: PiCompleteOptions,
) => Promise<PiAssistantMessage> | PiAssistantMessage;

export type CreatePiLlmChatClientInput = {
  complete: PiComplete;
};

export async function createDefaultPiLlmChatClient(): Promise<LlmChatClient> {
  const pi = await import("@earendil-works/pi-ai");
  return createPiLlmChatClient({
    complete: pi.complete as unknown as PiComplete,
  });
}

export function createPiLlmChatClient(input: CreatePiLlmChatClientInput): LlmChatClient {
  return async (deployment, request) => {
    try {
      const message = await input.complete(
        modelFromDeployment(deployment, request),
        contextFromRequest(request),
        optionsFromDeployment(deployment, request),
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

function modelFromDeployment(deployment: LlmDeployment, request: LlmChatRequest): PiModel {
  return {
    id: deployment.model,
    name: `${deployment.channel}/${deployment.model}`,
    api: "openai-completions",
    provider: deployment.channel,
    ...(deployment.baseUrl === null ? {} : { baseUrl: deployment.baseUrl }),
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 128000,
    maxTokens: request.maxTokens ?? 16384,
    compat: {
      supportsStore: false,
    },
  };
}

function contextFromRequest(request: LlmChatRequest): PiContext {
  const systemPrompt = messagesByRole(request.messages, "system").join("\n\n").trim();
  const messages = request.messages
    .filter(isConversationMessage)
    .map((message) => Object.freeze({
      role: message.role,
      content: message.content,
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

function optionsFromDeployment(deployment: LlmDeployment, request: LlmChatRequest): PiCompleteOptions {
  return Object.freeze({
    ...(deployment.apiKeys[0] ? { apiKey: deployment.apiKeys[0] } : {}),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
  });
}

function resultFromMessage(message: PiAssistantMessage): LlmChatResult {
  const text = (message.content ?? [])
    .filter(isPiTextContent)
    .map((block) => block.text)
    .join("\n")
    .trim();
  return Object.freeze({ text });
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
