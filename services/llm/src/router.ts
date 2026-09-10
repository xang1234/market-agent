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

export type LlmClientExecutionOptions = {
  signal?: AbortSignal;
};

export type LlmChatClient = (
  deployment: LlmDeployment,
  request: LlmChatRequest,
  options?: LlmClientExecutionOptions,
) => Promise<LlmChatResult> | LlmChatResult;

export type LlmExecutionControls = {
  signal?: AbortSignal;
  maxAttempts?: number;
  beforeAttempt?: (attempt: { index: number; channel: string; model: string }) => Promise<void>;
  executeAttempt?: (
    attempt: { index: number; channel: string; model: string },
    dispatch: (signal?: AbortSignal) => Promise<LlmChatResult>,
  ) => Promise<LlmChatResult>;
};

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

export type ControlledRouter = {
  complete(request: LlmChatRequest, controls?: LlmExecutionControls): Promise<LlmRouterResult>;
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

export function createLlmRouter(input: CreateLlmRouterInput): ControlledRouter {
  const deployments = buildLlmDeploymentOrder(input.settings);
  return Object.freeze({
    async complete(request, controls = {}) {
      if (deployments.length === 0) {
        throw new LlmRouterError("no_deployments", "no enabled LLM deployments configured", []);
      }

      const maximumAttempts = maxAttemptsFor(deployments.length, controls.maxAttempts);
      const attempts: LlmRouterAttempt[] = [];
      for (const [index, deployment] of deployments.entries()) {
        if (index >= maximumAttempts) break;
        throwIfAborted(controls.signal);
        const attempt = Object.freeze({ index, channel: deployment.channel, model: deployment.model });
        await controls.beforeAttempt?.(attempt);
        throwIfAborted(controls.signal);
        try {
          const dispatch = async (attemptSignal?: AbortSignal): Promise<LlmChatResult> => {
            const signal = combineSignals(controls.signal, attemptSignal);
            throwIfAborted(signal);
            try {
              const result = await input.client(deployment, request, { signal });
              if (controls.signal?.aborted) throw abortReason(controls.signal);
              if (signal?.aborted) throw new LlmProviderError("timeout", "LLM provider attempt timed out");
              return result;
            } catch (error) {
              if (controls.signal?.aborted) throw abortReason(controls.signal);
              if (error instanceof ProviderDispatchError) throw error;
              throw new ProviderDispatchError(error);
            }
          };
          const result = controls.executeAttempt === undefined
            ? await dispatch()
            : await controls.executeAttempt(attempt, dispatch);
          return Object.freeze({
            ...result,
            deployment: Object.freeze({
              channel: deployment.channel,
              model: deployment.model,
            }),
          });
        } catch (error) {
          if (!(error instanceof ProviderDispatchError)) throw error;
          const providerAttempt = attemptFromError(deployment, error.cause);
          attempts.push(providerAttempt);
          if (isTerminalProviderCode(providerAttempt.code)) {
            throw new LlmRouterError(providerAttempt.code, providerAttempt.message, attempts);
          }
        }
      }

      throw new LlmRouterError("all_deployments_failed", "all LLM deployments failed", attempts);
    },
  });
}

class ProviderDispatchError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("LLM provider dispatch failed");
    this.name = "ProviderDispatchError";
    this.cause = cause;
  }
}

function maxAttemptsFor(deploymentCount: number, requested: number | undefined): number {
  if (requested === undefined) return deploymentCount;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new RangeError("maxAttempts must be a positive integer");
  }
  return Math.min(deploymentCount, requested);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("LLM request aborted", "AbortError");
}

function combineSignals(primary: AbortSignal | undefined, secondary: AbortSignal | undefined): AbortSignal | undefined {
  if (primary === undefined) return secondary;
  if (secondary === undefined || secondary === primary) return primary;
  return AbortSignal.any([primary, secondary]);
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
