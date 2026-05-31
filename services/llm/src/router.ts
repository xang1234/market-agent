import {
  buildLlmDeploymentOrder,
  type LlmDeployment,
  type LlmSettings,
} from "./channel-config.ts";

export type LlmChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmChatRequest = {
  messages: ReadonlyArray<LlmChatMessage>;
  temperature?: number;
  maxTokens?: number;
};

export type LlmChatResult = {
  text: string;
};

export type LlmChatClient = (
  deployment: LlmDeployment,
  request: LlmChatRequest,
) => Promise<LlmChatResult> | LlmChatResult;

export type LlmProviderErrorCode =
  | "auth_failed"
  | "model_not_found"
  | "provider_failed"
  | "rate_limited"
  | "timeout";

export type LlmRouterErrorCode =
  | LlmProviderErrorCode
  | "no_deployments"
  | "all_deployments_failed";

export type LlmRouterAttempt = {
  deployment: Pick<LlmDeployment, "channel" | "model">;
  code: LlmProviderErrorCode | "unknown";
  message: string;
};

export type LlmRouterResult = LlmChatResult & {
  deployment: Pick<LlmDeployment, "channel" | "model">;
};

export class LlmProviderError extends Error {
  readonly code: LlmProviderErrorCode;

  constructor(code: LlmProviderErrorCode, message: string) {
    super(message);
    this.name = "LlmProviderError";
    this.code = code;
  }
}

export class LlmRouterError extends Error {
  readonly code: LlmRouterErrorCode;
  readonly attempts: ReadonlyArray<LlmRouterAttempt>;

  constructor(code: LlmRouterErrorCode, message: string, attempts: ReadonlyArray<LlmRouterAttempt>) {
    super(message);
    this.name = "LlmRouterError";
    this.code = code;
    this.attempts = Object.freeze([...attempts]);
  }
}

export type CreateLlmRouterInput = {
  settings: LlmSettings;
  client: LlmChatClient;
};

export function createLlmRouter(input: CreateLlmRouterInput): {
  complete(request: LlmChatRequest): Promise<LlmRouterResult>;
} {
  const deployments = buildLlmDeploymentOrder(input.settings);
  return Object.freeze({
    async complete(request) {
      if (deployments.length === 0) {
        throw new LlmRouterError("no_deployments", "no enabled LLM deployments configured", []);
      }

      const attempts: LlmRouterAttempt[] = [];
      for (const deployment of deployments) {
        try {
          const result = await input.client(deployment, request);
          return Object.freeze({
            ...result,
            deployment: Object.freeze({
              channel: deployment.channel,
              model: deployment.model,
            }),
          });
        } catch (error) {
          const attempt = attemptFromError(deployment, error);
          attempts.push(attempt);
          if (isTerminalProviderCode(attempt.code)) {
            throw new LlmRouterError(attempt.code, attempt.message, attempts);
          }
        }
      }

      throw new LlmRouterError("all_deployments_failed", "all LLM deployments failed", attempts);
    },
  });
}

function attemptFromError(deployment: LlmDeployment, error: unknown): LlmRouterAttempt {
  const providerError = error instanceof LlmProviderError ? error : null;
  return Object.freeze({
    deployment: Object.freeze({
      channel: deployment.channel,
      model: deployment.model,
    }),
    code: providerError?.code ?? "unknown",
    message: error instanceof Error ? error.message : "unknown LLM provider failure",
  });
}

function isTerminalProviderCode(code: LlmProviderErrorCode | "unknown"): code is "auth_failed" | "model_not_found" {
  return code === "auth_failed" || code === "model_not_found";
}
