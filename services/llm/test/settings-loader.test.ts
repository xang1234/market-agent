import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildLlmDeploymentOrder,
  createLlmRouterFromEnv,
  loadLlmSettingsFromEnv,
} from "../src/settings-loader.ts";

test("loadLlmSettingsFromEnv merges shell env with LLM_SETTINGS_ENV_FILE overrides", async () => {
  const dir = await mkdtemp(join(tmpdir(), "llm-settings-"));
  const envFile = join(dir, ".env.dev");
  await writeFile(envFile, [
    "LLM_CHANNELS=deepseek",
    "LLM_DEEPSEEK_BASE_URL=https://api.deepseek.com/v1",
    "LLM_DEEPSEEK_API_KEY=ds-key",
    "LLM_DEEPSEEK_MODELS=deepseek-chat",
    "LITELLM_MODEL=deepseek/deepseek-chat",
    "",
  ].join("\n"));

  const settings = await loadLlmSettingsFromEnv({
    LLM_SETTINGS_ENV_FILE: envFile,
    LLM_CHANNELS: "openai",
    LLM_OPENAI_API_KEY: "sk-openai",
    LLM_OPENAI_MODELS: "gpt-4.1",
    LITELLM_MODEL: "openai/gpt-4.1",
  });

  assert.deepEqual(settings.issues, []);
  assert.deepEqual(buildLlmDeploymentOrder(settings), [
    {
      channel: "deepseek",
      model: "deepseek-chat",
      protocol: "openai-compatible",
      baseUrl: "https://api.deepseek.com/v1",
      apiKeys: ["ds-key"],
    },
  ]);
});

test("loadLlmSettingsFromEnv rereads the env file on every call", async () => {
  const dir = await mkdtemp(join(tmpdir(), "llm-settings-reload-"));
  const envFile = join(dir, ".env.dev");

  await writeFile(envFile, [
    "LLM_CHANNELS=openai",
    "LLM_OPENAI_PROTOCOL=openai",
    "LLM_OPENAI_MODELS=gpt-4.1",
    "LITELLM_MODEL=openai/gpt-4.1",
    "",
  ].join("\n"));
  const first = await loadLlmSettingsFromEnv({ LLM_SETTINGS_ENV_FILE: envFile });

  await writeFile(envFile, [
    "LLM_CHANNELS=openai",
    "LLM_OPENAI_PROTOCOL=openai",
    "LLM_OPENAI_MODELS=o3",
    "LITELLM_MODEL=openai/o3",
    "",
  ].join("\n"));
  const second = await loadLlmSettingsFromEnv({ LLM_SETTINGS_ENV_FILE: envFile });

  assert.deepEqual(first.primaryModel, { channel: "openai", model: "gpt-4.1" });
  assert.deepEqual(second.primaryModel, { channel: "openai", model: "o3" });
});

test("createLlmRouterFromEnv returns null until deployments are configured", async () => {
  const router = await createLlmRouterFromEnv({}, {
    createClient: () => {
      throw new Error("client should not be created");
    },
  });

  assert.equal(router, null);
});

test("createLlmRouterFromEnv logs one usage line per completion only when LLM_USAGE_LOG=true", async () => {
  const env = {
    LLM_CHANNELS: "openai",
    LLM_OPENAI_PROTOCOL: "openai",
    LLM_OPENAI_MODELS: "gpt-4.1",
    LITELLM_MODEL: "openai/gpt-4.1",
  };
  const createClient = () => async () => ({ text: "ok", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });

  const logged: string[] = [];
  const on = await createLlmRouterFromEnv({ ...env, LLM_USAGE_LOG: "true" }, { createClient, log: (line) => logged.push(line) });
  await on!.complete({ messages: [{ role: "user", content: "hello" }] });
  assert.equal(logged.length, 1);
  assert.match(logged[0]!, /^\[llm\] openai\/gpt-4\.1 \d+ms tokens in=10 out=5 total=15$/);

  const quiet: string[] = [];
  const off = await createLlmRouterFromEnv(env, { createClient, log: (line) => quiet.push(line) });
  await off!.complete({ messages: [{ role: "user", content: "hello" }] });
  assert.deepEqual(quiet, []);
});

test("createLlmRouterFromEnv usage line says tokens are unknown when the client reports none", async () => {
  const logged: string[] = [];
  const router = await createLlmRouterFromEnv({
    LLM_CHANNELS: "openai",
    LLM_OPENAI_PROTOCOL: "openai",
    LLM_OPENAI_MODELS: "gpt-4.1",
    LITELLM_MODEL: "openai/gpt-4.1",
    LLM_USAGE_LOG: "true",
  }, { createClient: () => async () => ({ text: "ok" }), log: (line) => logged.push(line) });
  await router!.complete({ messages: [{ role: "user", content: "hello" }] });
  assert.match(logged[0]!, /^\[llm\] openai\/gpt-4\.1 \d+ms tokens n\/a$/);
});

test("createLlmRouterFromEnv builds a router with the injected client", async () => {
  const router = await createLlmRouterFromEnv({
    LLM_CHANNELS: "openai",
    LLM_OPENAI_PROTOCOL: "openai",
    LLM_OPENAI_MODELS: "gpt-4.1",
    LITELLM_MODEL: "openai/gpt-4.1",
  }, {
    createClient: () => async () => ({ text: "router ok" }),
  });

  assert.notEqual(router, null);
  assert.equal(
    (await router!.complete({ messages: [{ role: "user", content: "hello" }] })).text,
    "router ok",
  );
});
