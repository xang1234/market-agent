import assert from "node:assert/strict";
import test from "node:test";

import {
  LlmProviderError,
  LlmRouterError,
  createLlmRouter,
  type LlmChatClient,
} from "../src/router.ts";
import { parseLlmEnv } from "../src/channel-config.ts";

test("LLM router returns the primary deployment response", async () => {
  const calls: string[] = [];
  const router = createLlmRouter({
    settings: settings(),
    client: async (deployment) => {
      calls.push(`${deployment.channel}/${deployment.model}`);
      return { text: "primary ok" };
    },
  });

  const result = await router.complete({ messages: [{ role: "user", content: "hello" }] });

  assert.equal(result.text, "primary ok");
  assert.deepEqual(calls, ["openai/gpt-4.1"]);
  assert.deepEqual(result.deployment, { channel: "openai", model: "gpt-4.1" });
});

test("LLM router falls back after retryable provider failure", async () => {
  const calls: string[] = [];
  const client: LlmChatClient = async (deployment) => {
    calls.push(`${deployment.channel}/${deployment.model}`);
    if (calls.length === 1) throw new LlmProviderError("provider_failed", "upstream unavailable");
    return { text: "fallback ok" };
  };
  const router = createLlmRouter({ settings: settings(), client });

  const result = await router.complete({ messages: [{ role: "user", content: "hello" }] });

  assert.equal(result.text, "fallback ok");
  assert.deepEqual(calls, ["openai/gpt-4.1", "deepseek/deepseek-chat"]);
  assert.deepEqual(result.deployment, { channel: "deepseek", model: "deepseek-chat" });
});

test("LLM router stops before fallback when attempt admission rejects", async () => {
  const dispatched: string[] = [];
  const reservations: number[] = [];
  const router = createLlmRouter({
    settings: settings(),
    client: async (deployment) => {
      dispatched.push(deployment.model);
      throw new Error("transient");
    },
  });

  await assert.rejects(
    () => router.complete({ messages: [{ role: "user", content: "test" }] }, {
      maxAttempts: 2,
      beforeAttempt: async ({ index }) => {
        reservations.push(index);
        if (index === 1) throw new Error("budget");
      },
    }),
    /budget/u,
  );

  assert.equal(dispatched.length, 1);
  assert.deepEqual(reservations, [0, 1]);
});

test("LLM router dispatch uses the attempt signal supplied by execution control", async () => {
  const controller = new AbortController();
  let received: AbortSignal | undefined;
  const router = createLlmRouter({
    settings: settings(),
    client: async (_deployment, _request, options) => {
      received = options?.signal;
      return { text: "ok" };
    },
  });

  await router.complete(
    { messages: [{ role: "user", content: "test" }] },
    { executeAttempt: async (_attempt, dispatch) => dispatch(controller.signal) },
  );

  assert.equal(received, controller.signal);
});

test("LLM router stops before dispatch when its outer signal is aborted", async () => {
  const controller = new AbortController();
  const reason = new Error("campaign cancelled");
  controller.abort(reason);
  let dispatched = 0;
  const router = createLlmRouter({
    settings: settings(),
    client: async () => {
      dispatched += 1;
      return { text: "unexpected" };
    },
  });

  await assert.rejects(
    router.complete({ messages: [{ role: "user", content: "hello" }] }, { signal: controller.signal }),
    (error) => error === reason,
  );
  assert.equal(dispatched, 0);
});

test("LLM router stops on auth failure", async () => {
  const router = createLlmRouter({
    settings: settings(),
    client: async () => {
      throw new LlmProviderError("auth_failed", "bad key");
    },
  });

  await assert.rejects(
    () => router.complete({ messages: [{ role: "user", content: "hello" }] }),
    (error) => error instanceof LlmRouterError &&
      error.code === "auth_failed" &&
      error.attempts.length === 1,
  );
});

test("LLM router stops on model-not-found", async () => {
  const router = createLlmRouter({
    settings: settings(),
    client: async () => {
      throw new LlmProviderError("model_not_found", "missing model");
    },
  });

  await assert.rejects(
    () => router.complete({ messages: [{ role: "user", content: "hello" }] }),
    (error) => error instanceof LlmRouterError &&
      error.code === "model_not_found" &&
      error.attempts[0]?.deployment.model === "gpt-4.1",
  );
});

test("LLM router reports all deployments failed", async () => {
  const router = createLlmRouter({
    settings: settings(),
    client: async () => {
      throw new LlmProviderError("provider_failed", "upstream unavailable");
    },
  });

  await assert.rejects(
    () => router.complete({ messages: [{ role: "user", content: "hello" }] }),
    (error) => error instanceof LlmRouterError &&
      error.code === "all_deployments_failed" &&
      error.attempts.map((attempt) => `${attempt.deployment.channel}/${attempt.deployment.model}`).join(",") ===
        "openai/gpt-4.1,deepseek/deepseek-chat,openai/o3",
  );
});

function settings() {
  return parseLlmEnv({
    LLM_CHANNELS: "openai,deepseek",
    LLM_OPENAI_PROTOCOL: "openai",
    LLM_OPENAI_API_KEY: "sk-openai",
    LLM_OPENAI_MODELS: "gpt-4.1,o3",
    LLM_DEEPSEEK_PROTOCOL: "openai-compatible",
    LLM_DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
    LLM_DEEPSEEK_API_KEY: "ds-key",
    LLM_DEEPSEEK_MODELS: "deepseek-chat",
    LITELLM_MODEL: "openai/gpt-4.1",
    LITELLM_FALLBACK_MODELS: "deepseek/deepseek-chat,openai/o3",
  });
}
