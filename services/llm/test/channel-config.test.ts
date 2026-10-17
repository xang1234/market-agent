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
      reasoningModels: [],
      enabled: true,
    },
    {
      name: "deepseek",
      envName: "DEEPSEEK",
      protocol: "openai-compatible",
      baseUrl: "https://api.deepseek.com/v1",
      apiKeys: ["ds-primary", "ds-fallback"],
      models: ["deepseek-chat"],
      reasoningModels: [],
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

test("a channel can mark models newer than pi-ai's catalog as reasoning models", () => {
  const deployments = buildLlmDeploymentOrder(parseLlmEnv({
    LLM_CHANNELS: "gateway",
    LLM_GATEWAY_BASE_URL: "https://gateway.example/v1",
    LLM_GATEWAY_MODELS: "brand-new-thinker,plain-model",
    LLM_GATEWAY_REASONING_MODELS: "brand-new-thinker",
    LITELLM_MODEL: "gateway/brand-new-thinker",
    LITELLM_FALLBACK_MODELS: "gateway/plain-model",
  }));

  assert.deepEqual(deployments.map((d) => [d.model, d.reasoning]), [["brand-new-thinker", true], ["plain-model", undefined]]);
});

test("parseLlmEnv deduplicates channels and reports malformed model refs", () => {
  const settings = parseLlmEnv({
    LLM_CHANNELS: "OpenAI, openai, missing",
    LLM_OPENAI_BASE_URL: "https://api.openai.com/v1",
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

test("parseLlmEnv reports enabled channels that cannot build deployments", () => {
  const settings = parseLlmEnv({
    LLM_CHANNELS: "custom,disabled",
    LLM_CUSTOM_PROTOCOL: "openai-compatible",
    LLM_DISABLED_ENABLED: "false",
    LITELLM_MODEL: "custom/custom-model",
  });

  assert.deepEqual(settings.issues, [
    "LLM_CUSTOM_BASE_URL: required for openai-compatible channel 'custom'",
    "LLM_CUSTOM_MODELS: at least one model is required for channel 'custom'",
  ]);
  assert.deepEqual(buildLlmDeploymentOrder(settings), []);
});

test("a channel without a base URL deploys to its protocol's endpoint; an unknown protocol doesn't deploy", () => {
  const settings = parseLlmEnv({
    LLM_CHANNELS: "claude,openai,mystery",
    LLM_CLAUDE_PROTOCOL: "anthropic",
    LLM_CLAUDE_API_KEY: "sk-ant",
    LLM_CLAUDE_MODELS: "claude-opus-5-5",
    LLM_OPENAI_PROTOCOL: "openai",
    LLM_OPENAI_MODELS: "gpt-4.1",
    LLM_MYSTERY_PROTOCOL: "gemini",
    LLM_MYSTERY_BASE_URL: "https://example.test/v1",
    LLM_MYSTERY_MODELS: "m1",
    LITELLM_MODEL: "claude/claude-opus-5-5",
    LITELLM_FALLBACK_MODELS: "mystery/m1,openai/gpt-4.1",
  });

  assert.deepEqual(settings.issues, [
    "LLM_MYSTERY_PROTOCOL: unknown protocol 'gemini' for channel 'mystery' (expected one of openai-compatible, openai, anthropic)",
  ]);
  assert.deepEqual(buildLlmDeploymentOrder(settings), [
    { channel: "claude", model: "claude-opus-5-5", protocol: "anthropic", baseUrl: "https://api.anthropic.com", apiKeys: ["sk-ant"] },
    { channel: "openai", model: "gpt-4.1", protocol: "openai", baseUrl: "https://api.openai.com/v1", apiKeys: [] },
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

const ANTHROPIC_ENV = {
  LLM_CHANNELS: "anthropic,opencode",
  LLM_ANTHROPIC_PROTOCOL: "anthropic",
  LLM_ANTHROPIC_API_KEY: "sk-ant",
  LLM_ANTHROPIC_MODELS: "claude-sonnet-5-5,claude-haiku-5-5",
  LLM_OPENCODE_BASE_URL: "https://opencode.test/v1",
  LLM_OPENCODE_MODELS: "qwen3.8-max",
  LITELLM_MODEL: "anthropic/claude-sonnet-5-5",
  LITELLM_FALLBACK_MODELS: "opencode/qwen3.8-max",
};

const orderOf = (deployments: ReturnType<typeof buildLlmDeploymentOrder>) =>
  deployments.map((deployment) => `${deployment.channel}/${deployment.model}`);

test("extraction calls lead with EXTRACTION_LITELLM_MODEL; every other call keeps LITELLM_MODEL", () => {
  const settings = parseLlmEnv({ ...ANTHROPIC_ENV, EXTRACTION_LITELLM_MODEL: "anthropic/claude-haiku-5-5" });

  assert.deepEqual(settings.issues, []);
  assert.deepEqual(settings.extractionModel, { channel: "anthropic", model: "claude-haiku-5-5" });
  assert.deepEqual(orderOf(buildLlmDeploymentOrder(settings, "extraction")), [
    "anthropic/claude-haiku-5-5",
    "opencode/qwen3.8-max",
  ]);
  assert.deepEqual(orderOf(buildLlmDeploymentOrder(settings)), [
    "anthropic/claude-sonnet-5-5",
    "opencode/qwen3.8-max",
  ]);
});

test("without EXTRACTION_LITELLM_MODEL, extraction calls use the default order", () => {
  const settings = parseLlmEnv(ANTHROPIC_ENV);

  assert.equal(settings.extractionModel, null);
  assert.deepEqual(orderOf(buildLlmDeploymentOrder(settings, "extraction")), [
    "anthropic/claude-sonnet-5-5",
    "opencode/qwen3.8-max",
  ]);
});

test("an EXTRACTION_LITELLM_MODEL its channel doesn't list is an issue, and extraction falls back to the primary", () => {
  const settings = parseLlmEnv({ ...ANTHROPIC_ENV, EXTRACTION_LITELLM_MODEL: "anthropic/claude-opus-5-5" });

  assert.deepEqual(settings.issues, [
    "EXTRACTION_LITELLM_MODEL: model 'claude-opus-5-5' is not listed for channel 'anthropic'",
  ]);
  assert.equal(settings.extractionModel, null);
  assert.deepEqual(orderOf(buildLlmDeploymentOrder(settings, "extraction")), [
    "anthropic/claude-sonnet-5-5",
    "opencode/qwen3.8-max",
  ]);
});

test("parseLlmEnvFileText reads dotenv-style LLM settings without shell state", () => {
  const settings = parseLlmEnv(parseLlmEnvFileText(`
    # Local model channels
    LLM_CHANNELS=openai
    LLM_OPENAI_BASE_URL=https://api.openai.com/v1
    LLM_OPENAI_API_KEY="sk-local"
    LLM_OPENAI_MODELS='gpt-4.1,o3'
    LITELLM_MODEL=openai/gpt-4.1
  `));

  assert.deepEqual(settings.channels[0].apiKeys, ["sk-local"]);
  assert.deepEqual(settings.channels[0].models, ["gpt-4.1", "o3"]);
  assert.deepEqual(settings.primaryModel, { channel: "openai", model: "gpt-4.1" });
});
