import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { LlmProviderError } from "../src/router.ts";
import {
  createDefaultPiLlmChatClient,
  createPiLlmChatClient,
  type PiComplete,
  type PiModel,
  withLlmConversation,
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
  const { messages, ...context } = calls[0].context as { messages: Array<{ timestamp: number }> };
  assert.deepEqual(context, { systemPrompt: "You are concise." });
  assert.deepEqual(messages.map(({ timestamp, ...message }) => (assert.equal(typeof timestamp, "number"), message)), [
    { role: "user", content: "Say OK." },
  ]);
  const { headers, ...options } = calls[0].options as { headers: Record<string, string> };
  assert.deepEqual(options, {
    apiKey: "ds-key",
    temperature: 0,
    maxTokens: 32,
  });
  assert.equal(headers["User-Agent"], "market-agent/0.1");
  assert.match(headers["x-opencode-session"]!, /^[0-9a-f-]{36}$/, "a call outside a conversation is its own session");
});

test("pi adapter tags every call in a conversation with the same session id", async () => {
  const sessions: string[] = [];
  const client = createPiLlmChatClient({
    complete: async (_model, _context, options) => {
      sessions.push(options.headers!["x-opencode-session"]!);
      return { content: [{ type: "text", text: "Reply OK" }] };
    },
  });
  const ask = () => client(deployment(), { messages: [{ role: "user", content: "hello" }] });

  await withLlmConversation("thread-1", async () => {
    await ask();
    // Work the conversation starts later (a title after the answer) keeps its id.
    await new Promise((resolve) => setTimeout(resolve, 1));
    await ask();
  });
  await withLlmConversation("thread-2", ask);
  await ask();

  assert.deepEqual(sessions.slice(0, 3), ["thread-1", "thread-1", "thread-2"]);
  assert.notEqual(sessions[3], "thread-2", "outside a conversation, no id leaks from the last one");
});

test("pi adapter forwards an abort signal to the provider", async () => {
  const controller = new AbortController();
  let received: AbortSignal | undefined;
  const client = createPiLlmChatClient({
    complete: async (_model, _context, options) => {
      received = options.signal;
      return { content: [{ type: "text", text: "Reply OK" }] };
    },
  });

  await client(
    deployment(),
    { messages: [{ role: "user", content: "hello" }] },
    { signal: controller.signal },
  );

  assert.equal(received, controller.signal);
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

test("pi adapter passes the provider's token usage through", async () => {
  const client = createPiLlmChatClient({
    complete: async () => ({
      content: [{ type: "text", text: "ok" }],
      usage: { input: 120, output: 40, cacheRead: 0, cacheWrite: 0, totalTokens: 160 },
    }),
  });

  const result = await client(deployment(), { messages: [{ role: "user", content: "hello" }] });

  assert.deepEqual(result.usage, { inputTokens: 120, outputTokens: 40, totalTokens: 160 });
});

test("pi adapter leaves usage out when the provider reports none", async () => {
  const client = createPiLlmChatClient({ complete: async () => ({ content: [{ type: "text", text: "ok" }] }) });
  const result = await client(deployment(), { messages: [{ role: "user", content: "hello" }] });
  assert.equal(result.usage, undefined);
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

test("a model the catalog knows gets its reasoning metadata, and the nearest level it supports", async () => {
  const calls: Array<{ model: PiModel; options: { reasoning?: string } }> = [];
  const client = createPiLlmChatClient({
    complete: async (model, _context, options) => {
      calls.push({ model, options });
      return { content: [{ type: "text", text: "OK" }] };
    },
    catalogModel: () => ({
      reasoning: true,
      thinkingLevelMap: { off: null, low: "low" },
      compat: { maxTokensField: "max_tokens" },
      contextWindow: 131072,
    }),
    // Like qwen3.8-max: reasoning can't be switched off, so "off" becomes its lowest level.
    clampLevel: (_model, level) => (level === "off" ? "low" : level),
  });

  await client(deployment(), { messages: [{ role: "user", content: "hi" }], reasoning: "off" });

  assert.equal(calls[0]!.model.reasoning, true);
  assert.deepEqual(calls[0]!.model.thinkingLevelMap, { off: null, low: "low" });
  assert.deepEqual(calls[0]!.model.compat, { supportsStore: false, maxTokensField: "max_tokens" });
  assert.equal(calls[0]!.model.contextWindow, 131072);
  assert.equal(calls[0]!.options.reasoning, "low");
});

test("a model only the channel config marks as reasoning gets OpenAI-style reasoning_effort", async () => {
  const calls: Array<{ model: PiModel; options: { reasoning?: string } }> = [];
  const client = createPiLlmChatClient({
    complete: async (model, _context, options) => {
      calls.push({ model, options });
      return { content: [{ type: "text", text: "OK" }] };
    },
    catalogModel: () => undefined,
  });

  await client({ ...deployment(), reasoning: true }, { messages: [{ role: "user", content: "hi" }], reasoning: "medium" });

  assert.equal(calls[0]!.model.reasoning, true);
  assert.equal(calls[0]!.model.compat.supportsReasoningEffort, true);
  assert.equal(calls[0]!.options.reasoning, "medium");
});

test("no reasoning setting goes to a non-reasoning model, or when the caller leaves it to the provider", async () => {
  const sent: Array<string | undefined> = [];
  const client = (reasoning: boolean) => createPiLlmChatClient({
    complete: async (_model, _context, options) => {
      sent.push(options.reasoning);
      return { content: [{ type: "text", text: "OK" }] };
    },
    catalogModel: () => ({ reasoning }),
  });

  await client(false)(deployment(), { messages: [{ role: "user", content: "hi" }], reasoning: "low" });
  await client(true)(deployment(), { messages: [{ role: "user", content: "hi" }] });

  assert.deepEqual(sent, [undefined, undefined]);
});

test("a reply cut off at the token limit is reported as truncated, with its reasoning tokens", async () => {
  const client = createPiLlmChatClient({
    complete: async () => ({
      content: [{ type: "text", text: "The figures do not include a Q" }],
      stopReason: "length",
      usage: { input: 10, output: 100, reasoning: 90, totalTokens: 110 },
    }),
  });

  const result = await client(deployment(), { messages: [{ role: "user", content: "hi" }] });

  assert.equal(result.truncated, true);
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 100, totalTokens: 110, reasoningTokens: 90 });
});

test("the default client completes through pi-ai's OpenAI-compatible API, reasoning effort and headers included", async (t) => {
  const requests: Array<{ body: Record<string, unknown>; headers: Record<string, unknown> }> = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ body: JSON.parse(body), headers: req.headers });
    res.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (choice: object, extra: object = {}) =>
      `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "thinker", choices: [{ index: 0, ...choice }], ...extra })}\n\n`;
    res.write(chunk({ delta: { role: "assistant", content: "The figures do not include a Q" }, finish_reason: null }));
    res.write(chunk({ delta: {}, finish_reason: "length" }, {
      usage: { prompt_tokens: 12, completion_tokens: 64, total_tokens: 76, completion_tokens_details: { reasoning_tokens: 50 } },
    }));
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const client = await createDefaultPiLlmChatClient();
  const result = await withLlmConversation("thread-9", () => client(
    { channel: "local", model: "thinker", protocol: "openai-compatible", baseUrl: `http://127.0.0.1:${port}/v1`, apiKeys: ["k"], reasoning: true },
    { messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "hi" }], maxTokens: 256, reasoning: "low" },
  ));

  assert.equal(result.text, "The figures do not include a Q");
  assert.equal(result.truncated, true);
  assert.equal(result.usage?.reasoningTokens, 50);
  const [{ body, headers }] = requests as [(typeof requests)[number]];
  assert.equal(body.reasoning_effort, "low");
  // The system prompt goes out as its own leading message (normalizeContext).
  assert.equal((body.messages as Array<{ role: string }>).length, 2);
  assert.equal(headers["user-agent"], "market-agent/0.1");
  assert.equal(headers["x-opencode-session"], "thread-9");
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
