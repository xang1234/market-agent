// Exits 0 when the env (plus LLM_SETTINGS_ENV_FILE, if that file exists) yields at least
// one deployable LLM, as the services will build it; otherwise prints the settings
// issues and exits 1. dev-shell's live modes (DEV_MODE=analyst|data, #123) run this so a
// set-but-broken LITELLM_MODEL fails at startup, not at the first chat turn.
// Needs no npm packages: it runs before dev-shell installs anything.
import { existsSync } from "node:fs";

import { buildLlmDeploymentOrder, loadLlmSettingsFromEnv } from "../src/settings-loader.ts";

const env = { ...process.env };
if (env.LLM_SETTINGS_ENV_FILE && !existsSync(env.LLM_SETTINGS_ENV_FILE)) {
  delete env.LLM_SETTINGS_ENV_FILE;
}

const settings = await loadLlmSettingsFromEnv(env);
const deployments = buildLlmDeploymentOrder(settings);
if (deployments.length === 0) {
  console.error("no deployable LLM: LITELLM_MODEL must name a configured LLM_CHANNELS channel and model");
  for (const issue of settings.issues) console.error(`  - ${issue}`);
  process.exit(1);
}
console.log(`LLM deployments: ${deployments.map((d) => `${d.channel}/${d.model}`).join(", ")}`);
