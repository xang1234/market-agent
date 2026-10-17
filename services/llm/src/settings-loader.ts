import { readFile } from "node:fs/promises";

import {
  buildLlmDeploymentOrder,
  parseLlmEnv,
  parseLlmEnvFileText,
  type LlmEnv,
  type LlmPurpose,
  type LlmSettings,
} from "./channel-config.ts";
import { createDefaultPiLlmChatClient } from "./pi-adapter.ts";
import { createReplayLlmChatClient } from "./replay-client.ts";
import {
  createLlmRouter,
  type LlmChatClient,
  type LlmCompletion,
} from "./router.ts";

export { buildLlmDeploymentOrder };

export type LlmSettingsLoaderEnv = LlmEnv & {
  LLM_SETTINGS_ENV_FILE?: string;
  LLM_REPLAY_FILE?: string;
  /** "true": log model, latency and tokens for every completion (analyst mode, #123). */
  LLM_USAGE_LOG?: string;
};

export async function loadLlmSettingsFromEnv(
  env: LlmSettingsLoaderEnv = process.env,
): Promise<LlmSettings> {
  const envFile = readTrimmed(env.LLM_SETTINGS_ENV_FILE);
  if (envFile === null) {
    return parseLlmEnv(env);
  }

  const fileEnv = parseLlmEnvFileText(await readFile(envFile, "utf8"));
  // The dev shell exports the same file at startup; a key the Settings page has since
  // removed must not come back from that stale copy, so the file alone configures models.
  const shellEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !isModelConfigKey(key)));
  return parseLlmEnv({
    ...shellEnv,
    ...fileEnv,
  });
}

function isModelConfigKey(key: string): boolean {
  return (key.startsWith("LLM_") && !LOADER_CONTROL_KEYS.has(key)) || key.endsWith("LITELLM_MODEL") ||
    key === "LITELLM_FALLBACK_MODELS";
}

const LOADER_CONTROL_KEYS = new Set(["LLM_SETTINGS_ENV_FILE", "LLM_REPLAY_FILE", "LLM_USAGE_LOG"]);

export async function hasConfiguredLlmDeployments(
  env: LlmSettingsLoaderEnv = process.env,
): Promise<boolean> {
  return buildLlmDeploymentOrder(await loadLlmSettingsFromEnv(env)).length > 0;
}

export type LlmRouterFromEnv = ReturnType<typeof createLlmRouter>;

export type CreateLlmRouterFromEnvOptions = {
  createClient?: () => Promise<LlmChatClient> | LlmChatClient;
  purpose?: LlmPurpose;
  /** Where LLM_USAGE_LOG lines go; console.log by default. */
  log?: (line: string) => void;
};

export async function createLlmRouterFromEnv(
  env: LlmSettingsLoaderEnv = process.env,
  options: CreateLlmRouterFromEnvOptions = {},
): Promise<LlmRouterFromEnv | null> {
  const settings = await loadLlmSettingsFromEnv(env);
  const purpose = options.purpose ?? "default";
  if (buildLlmDeploymentOrder(settings, purpose).length === 0) return null;
  const replayFile = readTrimmed(env.LLM_REPLAY_FILE);
  const client = await (
    options.createClient ??
    (replayFile ? () => createReplayLlmChatClient(replayFile) : createDefaultPiLlmChatClient)
  )();
  const log = options.log ?? console.log;
  return createLlmRouter({
    settings,
    purpose,
    client,
    ...(env.LLM_USAGE_LOG?.trim() === "true" ? { onCompletion: (c) => log(formatCompletion(c)) } : {}),
  });
}

// ponytail: tokens only; dollar cost needs per-model prices, which aren't configured.
function formatCompletion(completion: LlmCompletion): string {
  const { channel, model } = completion.deployment;
  if (completion.outcome === "failed") {
    return `[llm] ${channel}/${model} ${completion.latencyMs}ms failed (${completion.code ?? "unknown"})`;
  }
  const usage = completion.usage;
  const tokens = usage
    ? `tokens in=${usage.inputTokens} out=${usage.outputTokens}` +
      (usage.reasoningTokens === undefined ? "" : ` (reasoning=${usage.reasoningTokens})`) +
      ` total=${usage.totalTokens}`
    : "tokens n/a";
  return `[llm] ${channel}/${model} ${completion.latencyMs}ms ${tokens}`;
}

function readTrimmed(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
