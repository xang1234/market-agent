// Exits 0 when the LLM settings yield at least one deployable model, loaded exactly as the
// services load them (loadLlmSettingsFromEnv, LLM_SETTINGS_ENV_FILE included); otherwise
// prints why and exits 1. dev-shell's live modes (DEV_MODE=analyst|data, #123) run this so
// a broken LLM config fails at startup, not at the first chat turn.
// Needs no npm packages: it runs before dev-shell installs anything.
import { buildLlmDeploymentOrder, loadLlmSettingsFromEnv } from "../src/settings-loader.ts";

let settings;
try {
  settings = await loadLlmSettingsFromEnv(process.env);
} catch (error) {
  // e.g. a missing LLM_SETTINGS_ENV_FILE, which the services would also fail to read.
  console.error(
    `no deployable LLM: could not load LLM settings (LLM_SETTINGS_ENV_FILE=${process.env.LLM_SETTINGS_ENV_FILE ?? ""}): ` +
      (error instanceof Error ? error.message : String(error)),
  );
  process.exit(1);
}

const deployments = buildLlmDeploymentOrder(settings);
if (deployments.length === 0) {
  console.error("no deployable LLM: LITELLM_MODEL must name a configured LLM_CHANNELS channel and model");
  for (const issue of settings.issues) console.error(`  - ${issue}`);
  process.exit(1);
}
console.log(`LLM deployments: ${deployments.map((d) => `${d.channel}/${d.model}`).join(", ")}`);
