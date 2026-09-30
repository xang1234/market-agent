import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";

const CLI = join(import.meta.dirname, "..", "scripts", "check-deployments.ts");

function run(env: Record<string, string>) {
  return spawnSync(process.execPath, ["--experimental-strip-types", CLI], {
    env: { PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
  });
}

test("check-deployments passes when the settings yield a deployable model", () => {
  const result = run({
    LLM_CHANNELS: "openai",
    LLM_OPENAI_PROTOCOL: "openai",
    LLM_OPENAI_MODELS: "gpt-4.1",
    LITELLM_MODEL: "openai/gpt-4.1",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /openai\/gpt-4\.1/);
});

test("check-deployments fails, with the parser's issues, when LITELLM_MODEL names no configured channel", () => {
  const result = run({ LITELLM_MODEL: "openai/gpt-4.1" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no deployable LLM/);
  assert.match(result.stderr, /LITELLM_MODEL/);
});

test("check-deployments fails on a missing LLM_SETTINGS_ENV_FILE, as the services would", () => {
  // The services read this file on every model call; a missing one fails them with ENOENT.
  const result = run({
    LLM_SETTINGS_ENV_FILE: "/nonexistent/.env.dev",
    LLM_CHANNELS: "openai",
    LLM_OPENAI_PROTOCOL: "openai",
    LLM_OPENAI_MODELS: "gpt-4.1",
    LITELLM_MODEL: "openai/gpt-4.1",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /LLM_SETTINGS_ENV_FILE.*\/nonexistent\/\.env\.dev/);
});
