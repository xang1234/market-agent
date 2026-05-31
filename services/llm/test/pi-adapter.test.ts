import assert from "node:assert/strict";
import test from "node:test";

import { LlmProviderError } from "../src/router.ts";
import {
  createPiLlmChatClient,
  type PiComplete,
} from "../src/pi-adapter.ts";

test("pi adapter calls complete with a custom OpenAI-compatible model", async () => {
  const calls: Array<{
    model: unknown;
    context: unknown;
    options: unknown;
  }> = [];
  const complete: PiComplete = async (model, context, options) => {
    calls.push({ model, context, options });
    return {
      content: [{ type: "text", text: "Reply OK" }],
    };
  };
  const client = createPiLlmChatClient({ complete });

  const result = await client({
    channel: "deepseek",
    model: "deepseek-chat",
    protocol: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeys: ["ds-key"],
  }, {
    messages: [
      { role: "system", content: "You are concise." },
      { role: "user", content: "Say OK." },
    ],
    maxTokens: 32,
    temperature: 0,
  });

  assert.equal(result.text, "Reply OK");
  assert.deepEqual(calls[0].model, {
    id: "deepseek-chat",
    name: "deepseek/deepseek-chat",
    api: "openai-completions",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 32,
    compat: { supportsStore: false },
  });
  assert.deepEqual(calls[0].context, {
    systemPrompt: "You are concise.",
    messages: [{ role: "user", content: "Say OK." }],
  });
  assert.deepEqual(calls[0].options, {
    apiKey: "ds-key",
    temperature: 0,
    maxTokens: 32,
  });
});

test("pi adapter joins text blocks and ignores non-text output", async () => {
  const client = createPiLlmChatClient({
    complete: async () => ({
      content: [
        { type: "thinking", thinking: "hidden" },
        { type: "text", text: "Part A" },
        { type: "toolCall", name: "ignored" },
        { type: "text", text: "Part B" },
      ],
    }),
  });

  const result = await client(deployment(), { messages: [{ role: "user", content: "hello" }] });

  assert.equal(result.text, "Part A\nPart B");
});

test("pi adapter maps auth and model errors to provider errors", async () => {
  const authClient = createPiLlmChatClient({
    complete: async () => {
      const error = new Error("401 unauthorized api key");
      Object.assign(error, { status: 401 });
      throw error;
    },
  });
  const modelClient = createPiLlmChatClient({
    complete: async () => {
      const error = new Error("model not found");
      Object.assign(error, { status: 404 });
      throw error;
    },
  });

  await assert.rejects(
    async () => {
      await authClient(deployment(), { messages: [{ role: "user", content: "hello" }] });
    },
    (error: unknown) => error instanceof LlmProviderError && error.code === "auth_failed",
  );
  await assert.rejects(
    async () => {
      await modelClient(deployment(), { messages: [{ role: "user", content: "hello" }] });
    },
    (error: unknown) => error instanceof LlmProviderError && error.code === "model_not_found",
  );
});

test("pi adapter treats assistant error responses as provider failures", async () => {
  const client = createPiLlmChatClient({
    complete: async () => ({
      stopReason: "error",
      errorMessage: "upstream unavailable",
      content: [],
    }),
  });

  await assert.rejects(
    async () => {
      await client(deployment(), { messages: [{ role: "user", content: "hello" }] });
    },
    (error: unknown) => error instanceof LlmProviderError &&
      error.code === "provider_failed" &&
      error.message === "upstream unavailable",
  );
});

function deployment() {
  return {
    channel: "openai",
    model: "gpt-4.1",
    protocol: "openai",
    baseUrl: null,
    apiKeys: ["sk-openai"],
  };
}
