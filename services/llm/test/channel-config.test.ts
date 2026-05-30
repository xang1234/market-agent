import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLlmDeploymentOrder,
  parseLlmEnv,
  parseLlmEnvFileText,
} from "../src/channel-config.ts";

test("parseLlmEnv reads flat DSA-compatible channel settings", () => {
  const settings = parseLlmEnv({
    LLM_CHANNELS: "openai,deepseek",
    LLM_OPENAI_PROTOCOL: "openai",
    LLM_OPENAI_BASE_URL: "https://api.openai.com/v1",
    LLM_OPENAI_API_KEY: "sk-openai",
    LLM_OPENAI_MODELS: "gpt-4.1,o3",
    LLM_DEEPSEEK_PROTOCOL: "openai-compatible",
    LLM_DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
    LLM_DEEPSEEK_API_KEYS: "ds-primary, ds-fallback",
    LLM_DEEPSEEK_MODELS: "deepseek-chat",
    LITELLM_MODEL: "openai/gpt-4.1",
    LITELLM_FALLBACK_MODELS: "deepseek/deepseek-chat,openai/o3",
    AGENT_LITELLM_MODEL: "openai/o3",
  });

  assert.deepEqual(settings.issues, []);
  assert.deepEqual(settings.channels, [
    {
      name: "openai",
      envName: "OPENAI",
      protocol: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKeys: ["sk-openai"],
      models: ["gpt-4.1", "o3"],
      enabled: true,
    },
    {
      name: "deepseek",
      envName: "DEEPSEEK",
      protocol: "openai-compatible",
      baseUrl: "https://api.deepseek.com/v1",
      apiKeys: ["ds-primary", "ds-fallback"],
      models: ["deepseek-chat"],
      enabled: true,
    },
  ]);
  assert.deepEqual(settings.primaryModel, { channel: "openai", model: "gpt-4.1" });
  assert.deepEqual(settings.fallbackModels, [
    { channel: "deepseek", model: "deepseek-chat" },
    { channel: "openai", model: "o3" },
  ]);
  assert.deepEqual(settings.agentModel, { channel: "openai", model: "o3" });
});

test("parseLlmEnv deduplicates channels and reports malformed model refs", () => {
  const settings = parseLlmEnv({
    LLM_CHANNELS: "OpenAI, openai, missing",
    LLM_OPENAI_MODELS: "gpt-4.1",
    LLM_MISSING_ENABLED: "false",
    LITELLM_MODEL: "unknown-model",
    LITELLM_FALLBACK_MODELS: "openai/gpt-4.1,missing/disabled-model",
  });

  assert.deepEqual(settings.channels.map((channel) => channel.name), ["openai", "missing"]);
  assert.deepEqual(settings.primaryModel, null);
  assert.deepEqual(settings.fallbackModels, [{ channel: "openai", model: "gpt-4.1" }]);
  assert.deepEqual(settings.issues, [
    "LLM_CHANNELS: duplicate channel 'openai' ignored",
    "LITELLM_MODEL: model 'unknown-model' does not match any enabled channel",
    "LITELLM_FALLBACK_MODELS: channel 'missing' is disabled",
  ]);
});

test("buildLlmDeploymentOrder emits primary then unique fallbacks", () => {
  const settings = parseLlmEnv({
    LLM_CHANNELS: "openai,deepseek",
    LLM_OPENAI_PROTOCOL: "openai",
    LLM_OPENAI_BASE_URL: "https://api.openai.com/v1",
    LLM_OPENAI_API_KEY: "sk-openai",
    LLM_OPENAI_MODELS: "gpt-4.1,o3",
    LLM_DEEPSEEK_PROTOCOL: "openai-compatible",
    LLM_DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
    LLM_DEEPSEEK_API_KEY: "ds-key",
    LLM_DEEPSEEK_MODELS: "deepseek-chat",
    LITELLM_MODEL: "openai/gpt-4.1",
    LITELLM_FALLBACK_MODELS: "openai/gpt-4.1,deepseek/deepseek-chat,openai/o3",
  });

  assert.deepEqual(buildLlmDeploymentOrder(settings), [
    {
      channel: "openai",
      model: "gpt-4.1",
      protocol: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKeys: ["sk-openai"],
    },
    {
      channel: "deepseek",
      model: "deepseek-chat",
      protocol: "openai-compatible",
      baseUrl: "https://api.deepseek.com/v1",
      apiKeys: ["ds-key"],
    },
    {
      channel: "openai",
      model: "o3",
      protocol: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKeys: ["sk-openai"],
    },
  ]);
});

test("parseLlmEnvFileText reads dotenv-style LLM settings without shell state", () => {
  const settings = parseLlmEnv(parseLlmEnvFileText(`
    # Local model channels
    LLM_CHANNELS=openai
    LLM_OPENAI_API_KEY="sk-local"
    LLM_OPENAI_MODELS='gpt-4.1,o3'
    LITELLM_MODEL=openai/gpt-4.1
  `));

  assert.deepEqual(settings.channels[0].apiKeys, ["sk-local"]);
  assert.deepEqual(settings.channels[0].models, ["gpt-4.1", "o3"]);
  assert.deepEqual(settings.primaryModel, { channel: "openai", model: "gpt-4.1" });
});
