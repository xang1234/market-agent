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

test("LLM router reports each completion's deployment, latency and usage", async () => {
  const completions: unknown[] = [];
  const router = createLlmRouter({
    settings: settings(),
    client: async () => ({ text: "ok", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }),
    onCompletion: (completion) => completions.push(completion),
  });

  await router.complete({ messages: [{ role: "user", content: "hello" }] });

  assert.equal(completions.length, 1);
  const [completion] = completions as Array<{ deployment: unknown; latencyMs: number; usage: unknown }>;
  assert.deepEqual(completion.deployment, { channel: "openai", model: "gpt-4.1" });
  assert.ok(Number.isFinite(completion.latencyMs) && completion.latencyMs >= 0);
  assert.deepEqual(completion.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
});

test("LLM router reports a failed attempt before its fallback, with the failure code", async () => {
  const completions: Array<{ deployment: { channel: string; model: string }; outcome: string; code?: string; latencyMs: number }> = [];
  let calls = 0;
  const router = createLlmRouter({
    settings: settings(),
    client: async () => {
      calls += 1;
      if (calls === 1) throw new LlmProviderError("rate_limited", "slow down");
      return { text: "fallback ok" };
    },
    onCompletion: (completion) => completions.push(completion as never),
  });

  await router.complete({ messages: [{ role: "user", content: "hello" }] });

  assert.deepEqual(
    completions.map((c) => [`${c.deployment.channel}/${c.deployment.model}`, c.outcome, c.code]),
    [["openai/gpt-4.1", "failed", "rate_limited"], ["deepseek/deepseek-chat", "ok", undefined]],
  );
  assert.ok(completions.every((c) => Number.isFinite(c.latencyMs)));
});

test("LLM router isolates a throwing completion hook from the model result and the fallback", async () => {
  const throwingHook = () => {
    throw new Error("logging sink down");
  };
  const ok = createLlmRouter({
    settings: settings(),
    client: async () => ({ text: "billable answer" }),
    onCompletion: throwingHook,
  });
  assert.equal((await ok.complete({ messages: [{ role: "user", content: "hello" }] })).text, "billable answer");

  let calls = 0;
  const withFallback = createLlmRouter({
    settings: settings(),
    client: async () => {
      calls += 1;
      if (calls === 1) throw new LlmProviderError("rate_limited", "slow down");
      return { text: "fallback ok" };
    },
    onCompletion: throwingHook,
  });
  assert.equal((await withFallback.complete({ messages: [{ role: "user", content: "hello" }] })).text, "fallback ok");
});

test("LLM router consumes a rejected async completion hook instead of leaving it unhandled", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const router = createLlmRouter({
      settings: settings(),
      client: async () => ({ text: "ok" }),
      onCompletion: (async () => {
        throw new Error("async sink down");
      }) as unknown as () => void,
    });
    assert.equal((await router.complete({ messages: [{ role: "user", content: "hello" }] })).text, "ok");
    // Let any unhandled rejection surface.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  assert.deepEqual(unhandled, []);
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

test("LLM router dispatches only the caller's immutable deployment order", async () => {
  const calls: string[] = [];
  const router = createLlmRouter({
    settings: settings(),
    client: async (deployment) => {
      calls.push(`${deployment.channel}/${deployment.model}`);
      return { text: "snapshotted" };
    },
  });

  const result = await router.complete(
    { messages: [{ role: "user", content: "hello" }] },
    { deploymentOrder: [{ channel: "deepseek", model: "deepseek-chat" }] },
  );

  assert.deepEqual(calls, ["deepseek/deepseek-chat"]);
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

test("a hung attempt ends at its deadline and falls back, even if the client ignores the signal (#184)", async () => {
  const called: string[] = [];
  const router = createLlmRouter({
    settings: settings(),
    client: async (deployment) => {
      called.push(deployment.model);
      // The first provider accepts the request and never answers, ignoring the signal.
      if (called.length === 1) return new Promise<never>(() => {});
      return { text: "fallback answer" };
    },
  });

  const startedAt = Date.now();
  const result = await router.complete(
    { messages: [{ role: "user", content: "hello" }] },
    { executeAttempt: async (_attempt, dispatch) => dispatch(AbortSignal.timeout(50)) },
  );

  assert.equal(result.text, "fallback answer");
  assert.equal(called.length, 2);
  assert.ok(Date.now() - startedAt < 2_000, "the hung attempt cost about its deadline, not forever");
});

test("every attempt hanging is a router error naming each timeout (#184)", async () => {
  const router = createLlmRouter({ settings: settings(), client: () => new Promise<never>(() => {}) });
  await assert.rejects(
    router.complete(
      { messages: [{ role: "user", content: "hello" }] },
      { executeAttempt: async (_attempt, dispatch) => dispatch(AbortSignal.timeout(20)) },
    ),
    (error) => error instanceof LlmRouterError && error.code === "all_deployments_failed" && error.attempts.every((attempt) => attempt.code === "timeout"),
  );
});

test("the outer signal also ends a hung attempt, as the caller's abort", async () => {
  const reason = new Error("turn deadline");
  const controller = new AbortController();
  const router = createLlmRouter({ settings: settings(), client: () => new Promise<never>(() => {}) });
  setTimeout(() => controller.abort(reason), 20);
  await assert.rejects(
    router.complete({ messages: [{ role: "user", content: "hello" }] }, { signal: controller.signal }),
    (error) => error === reason,
  );
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
