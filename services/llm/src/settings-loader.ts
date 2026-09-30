import { readFile } from "node:fs/promises";

import {
  buildLlmDeploymentOrder,
  parseLlmEnv,
  parseLlmEnvFileText,
  type LlmEnv,
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
  return parseLlmEnv({
    ...env,
    ...fileEnv,
  });
}

export async function hasConfiguredLlmDeployments(
  env: LlmSettingsLoaderEnv = process.env,
): Promise<boolean> {
  return buildLlmDeploymentOrder(await loadLlmSettingsFromEnv(env)).length > 0;
}

export type LlmRouterFromEnv = ReturnType<typeof createLlmRouter>;

export type CreateLlmRouterFromEnvOptions = {
  createClient?: () => Promise<LlmChatClient> | LlmChatClient;
  /** Where LLM_USAGE_LOG lines go; console.log by default. */
  log?: (line: string) => void;
};

export async function createLlmRouterFromEnv(
  env: LlmSettingsLoaderEnv = process.env,
  options: CreateLlmRouterFromEnvOptions = {},
): Promise<LlmRouterFromEnv | null> {
  const settings = await loadLlmSettingsFromEnv(env);
  if (buildLlmDeploymentOrder(settings).length === 0) return null;
  const replayFile = readTrimmed(env.LLM_REPLAY_FILE);
  const client = await (
    options.createClient ??
    (replayFile ? () => createReplayLlmChatClient(replayFile) : createDefaultPiLlmChatClient)
  )();
  const log = options.log ?? console.log;
  return createLlmRouter({
    settings,
    client,
    ...(env.LLM_USAGE_LOG?.trim() === "true" ? { onCompletion: (c) => log(formatCompletion(c)) } : {}),
  });
}

// ponytail: tokens only; dollar cost needs per-model prices, which aren't configured.
function formatCompletion(completion: LlmCompletion): string {
  const { channel, model } = completion.deployment;
  const tokens = completion.usage
    ? `tokens in=${completion.usage.inputTokens} out=${completion.usage.outputTokens} total=${completion.usage.totalTokens}`
    : "tokens n/a";
  return `[llm] ${channel}/${model} ${completion.latencyMs}ms ${tokens}`;
}

function readTrimmed(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
