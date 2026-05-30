import { readFile } from "node:fs/promises";

import {
  buildLlmDeploymentOrder,
  parseLlmEnv,
  parseLlmEnvFileText,
  type LlmEnv,
  type LlmSettings,
} from "./channel-config.ts";
import { createDefaultPiLlmChatClient } from "./pi-adapter.ts";
import {
  createLlmRouter,
  type LlmChatClient,
} from "./router.ts";

export { buildLlmDeploymentOrder };

export type LlmSettingsLoaderEnv = LlmEnv & {
  LLM_SETTINGS_ENV_FILE?: string;
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
};

export async function createLlmRouterFromEnv(
  env: LlmSettingsLoaderEnv = process.env,
  options: CreateLlmRouterFromEnvOptions = {},
): Promise<LlmRouterFromEnv | null> {
  const settings = await loadLlmSettingsFromEnv(env);
  if (buildLlmDeploymentOrder(settings).length === 0) return null;
  const client = await (options.createClient ?? createDefaultPiLlmChatClient)();
  return createLlmRouter({ settings, client });
}

function readTrimmed(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
