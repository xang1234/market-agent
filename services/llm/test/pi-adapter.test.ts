import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import type { LlmDeployment } from "../src/channel-config.ts";
import { LlmClientError, LlmProviderError } from "../src/router.ts";
import {
  createCatalogLookup,
  createDefaultPiLlmChatClient,
  createPiLlmChatClient,
  type PiCatalogEntry,
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

test("pi adapter counts cached prompt tokens as input", async () => {
  const client = createPiLlmChatClient({
    complete: async () => ({
      content: [{ type: "text", text: "ok" }],
      usage: { input: 10, output: 40, cacheRead: 90, cacheWrite: 20, totalTokens: 160 },
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

test("the catalog lookup finds models by endpoint, under any API, keeping compat flags only for the deployment's API", async () => {
  const builtins = await import("@earendil-works/pi-ai/providers/all");
  const lookup = createCatalogLookup(
    builtins.getBuiltinProviders().flatMap((provider) => builtins.getBuiltinModels(provider) as PiCatalogEntry[]),
  );
  const opencode: LlmDeployment = { channel: "my-gateway", model: "qwen3.8-max", protocol: "openai-compatible", baseUrl: "https://opencode.ai/zen/go/v1/", apiKeys: [] };
  // OpenAI's o3 is catalogued under openai-responses.
  const o3: LlmDeployment = { channel: "openai", model: "o3", protocol: "openai", baseUrl: "https://api.openai.com/v1", apiKeys: [] };
  const opus: LlmDeployment = { channel: "claude", model: "claude-opus-5-5", protocol: "anthropic", baseUrl: "https://api.anthropic.com", apiKeys: [] };

  assert.equal(lookup(opencode)?.reasoning, true, "any channel name, trailing slash ignored");
  assert.ok(lookup(opencode)?.compat, "an openai-completions entry keeps its compat flags");
  assert.equal(lookup(o3)?.reasoning, true);
  assert.equal(lookup(o3)?.thinkingLevelMap?.low, "low");
  assert.equal(lookup(o3)?.compat, undefined, "another API's compat flags don't apply");
  assert.deepEqual(
    [lookup(opus)?.compat?.supportsTemperature, lookup(opus)?.compat?.forceAdaptiveThinking],
    [false, true],
    "an anthropic deployment keeps an anthropic-messages entry's compat flags",
  );
  assert.equal(lookup({ ...opencode, model: "not-a-model" }), undefined);
});

test("a request for more output than the catalog says the model allows is capped to its limit", async () => {
  const sent: Array<{ model: number; option: number | undefined }> = [];
  const client = createPiLlmChatClient({
    complete: async (model, _context, options) => {
      sent.push({ model: model.maxTokens, option: options.maxTokens });
      return { content: [{ type: "text", text: "OK" }] };
    },
    catalogModel: () => ({ reasoning: true, maxTokens: 4096 }),
  });

  await client(deployment(), { messages: [{ role: "user", content: "hi" }], maxTokens: 8192 });
  await client(deployment(), { messages: [{ role: "user", content: "hi" }], maxTokens: 512 });

  assert.deepEqual(sent, [{ model: 4096, option: 4096 }, { model: 512, option: 512 }]);
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
  const sent: Array<{ modelReasons: boolean; level: string | undefined }> = [];
  const client = (reasoning: boolean) => createPiLlmChatClient({
    complete: async (model, _context, options) => {
      sent.push({ modelReasons: model.reasoning, level: options.reasoning });
      return { content: [{ type: "text", text: "OK" }] };
    },
    catalogModel: () => ({ reasoning }),
  });

  await client(false)(deployment(), { messages: [{ role: "user", content: "hi" }], reasoning: "low" });
  // A known reasoning model with no level asked for is declared non-reasoning: pi-ai would
  // otherwise read the missing level as "off" and change the provider default.
  await client(true)(deployment(), { messages: [{ role: "user", content: "hi" }] });

  assert.deepEqual(sent, [{ modelReasons: false, level: undefined }, { modelReasons: false, level: undefined }]);
});

test("an explicit off goes through, so pi-ai disables thinking in the model's own format", async () => {
  const sent: Array<string | undefined> = [];
  const client = createPiLlmChatClient({
    complete: async (_model, _context, options) => {
      sent.push(options.reasoning);
      return { content: [{ type: "text", text: "OK" }] };
    },
    catalogModel: () => ({ reasoning: true, thinkingLevelMap: { off: "none" } }),
    clampLevel: (_model, level) => level,
  });

  await client(deployment(), { messages: [{ role: "user", content: "hi" }], reasoning: "off" });

  assert.deepEqual(sent, ["off"]);
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

  // A caller that sets no level sends no reasoning parameter at all: the provider default.
  await client(
    { channel: "local", model: "thinker", protocol: "openai-compatible", baseUrl: `http://127.0.0.1:${port}/v1`, apiKeys: ["k"], reasoning: true },
    { messages: [{ role: "user", content: "hi" }], maxTokens: 256 },
  );
  const untouched = requests[1]!.body;
  assert.deepEqual(
    Object.keys(untouched).filter((key) => /reasoning|thinking/u.test(key)),
    [],
    "no reasoning_effort, enable_thinking or thinking field",
  );
});

type CapturedRequest = { url: string; body: Record<string, unknown>; headers: Record<string, string | string[] | undefined> };

// A local stand-in for POST /v1/messages that records each request and streams `reply`.
async function messagesApiStub(t: { after(fn: () => void): void }, reply: (body: Record<string, unknown>) => { status: number; events?: object[]; error?: object }) {
  const requests: CapturedRequest[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw) as Record<string, unknown>;
    requests.push({ url: req.url ?? "", body, headers: req.headers });
    const { status, events = [], error } = reply(body);
    if (status !== 200) {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of events) res.write(`event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return { requests, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function claudeReply(model: string, text: string, stopReason = "end_turn", stopDetails: object | null = null): object[] {
  return [
    { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model, content: [], stop_reason: null, usage: { input_tokens: 12, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stopReason, stop_details: stopDetails }, usage: { output_tokens: 7 } },
    { type: "message_stop" },
  ];
}

const askLow = { messages: [{ role: "system" as const, content: "Be brief." }, { role: "user" as const, content: "hi" }], temperature: 0, maxTokens: 256, reasoning: "low" as const };

test("an anthropic channel calls the Messages API with adaptive thinking at the requested effort, no temperature, and prompt caching", async (t) => {
  const stub = await messagesApiStub(t, (body) => ({ status: 200, events: claudeReply(body.model as string, "OK") }));
  // Calls keep api.anthropic.com as their endpoint, so the catalog still finds claude-opus-5-5.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => realFetch(String(input instanceof Request ? input.url : input).replace("https://api.anthropic.com", stub.baseUrl), init);
  t.after(() => { globalThis.fetch = realFetch; });
  const client = await createDefaultPiLlmChatClient();
  const claude = (model: string, reasoning?: boolean): LlmDeployment =>
    ({ channel: "claude", model, protocol: "anthropic", baseUrl: "https://api.anthropic.com", apiKeys: ["sk-ant-api-test"], ...(reasoning ? { reasoning } : {}) });

  const opus = await withLlmConversation("thread-1", () => client(claude("claude-opus-5-5"), askLow));
  await client(claude("claude-opus-5-5"), { ...askLow, reasoning: "off" });
  // claude-haiku-5-5 isn't in pi-ai's catalog; the channel lists it in LLM_<NAME>_REASONING_MODELS, or doesn't.
  const haiku = await client(claude("claude-haiku-5-5", true), askLow);
  await client(claude("claude-haiku-5-5", true), { ...askLow, reasoning: "off" });
  await client(claude("claude-haiku-5-5"), askLow);

  assert.equal(opus.text, "OK");
  assert.deepEqual(haiku.usage, { inputTokens: 12, outputTokens: 7, totalTokens: 19 });
  const [opusLow, , haikuLow] = stub.requests;
  assert.equal(haikuLow!.url, "/v1/messages?beta=true");
  assert.equal(haikuLow!.headers["x-api-key"], "sk-ant-api-test");
  assert.equal(haikuLow!.headers["user-agent"], "market-agent/0.1");
  assert.equal(opusLow!.headers["x-opencode-session"], undefined, "the OpenCode session header stays on OpenAI-protocol channels");
  assert.deepEqual(
    stub.requests.map(({ body }) => ({ temperature: body.temperature, thinking: body.thinking, output_config: body.output_config })),
    [
      { temperature: undefined, thinking: { type: "adaptive", display: "summarized", block_binding: { prefix_mismatch_behavior: "drop_block" } }, output_config: { effort: "high" } },
      { temperature: undefined, thinking: { type: "adaptive", display: "summarized", block_binding: { prefix_mismatch_behavior: "drop_block" } }, output_config: { effort: "high" } },
      { temperature: undefined, thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "low" } },
      { temperature: undefined, thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "low" } },
      { temperature: undefined, thinking: undefined, output_config: undefined },
    ],
  );
  // Opus 5.5's effort rides in a mid-conversation system message (pi-ai's managed effort); "off" clamps to low.
  const effortMessages = stub.requests.slice(0, 2).map(({ body }) =>
    (body.messages as Array<{ role: string; output_config?: unknown }>).filter((message) => message.role === "system"));
  assert.deepEqual(effortMessages, [
    [{ role: "system", content: [], output_config: { effort: "low" } }],
    [{ role: "system", content: [], output_config: { effort: "low" } }],
  ]);
  assert.deepEqual(haikuLow!.body.system, [{ type: "text", text: "Be brief.", cache_control: { type: "ephemeral" } }]);
  assert.deepEqual(haikuLow!.body.messages, [{ role: "user", content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }] }]);
});

test("a Claude refusal and an exhausted credit balance are provider failures the router falls back from", async (t) => {
  const stub = await messagesApiStub(t, (body) => body.model === "claude-sonnet-5-5"
    ? { status: 200, events: claudeReply("claude-sonnet-5-5", "", "refusal", { type: "refusal", category: "cyber", explanation: "This request may enable unauthorized access to computer systems." }) }
    : { status: 400, error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } });
  const client = await createDefaultPiLlmChatClient();
  const claude = (model: string): LlmDeployment => ({ channel: "claude", model, protocol: "anthropic", baseUrl: stub.baseUrl, apiKeys: ["k"] });

  const failure = async (model: string) => {
    try {
      await client(claude(model), askLow);
    } catch (error) {
      return error instanceof LlmProviderError ? { code: error.code, message: error.message } : error;
    }
    return "resolved";
  };

  assert.deepEqual(await failure("claude-sonnet-5-5"), {
    code: "provider_failed",
    message: "This request may enable unauthorized access to computer systems.",
  });
  const credit = await failure("claude-opus-5-5") as { code: string; message: string };
  assert.equal(credit.code, "provider_failed");
  assert.match(credit.message, /^400 .*credit balance is too low/u);
});

test("an Anthropic permission error or unknown model stops the router instead of falling back", async (t) => {
  const stub = await messagesApiStub(t, (body) => body.model === "claude-opus-5-5"
    ? { status: 403, error: { type: "permission_error", message: "You do not have permission to access the requested resource." } }
    : { status: 404, error: { type: "not_found_error", message: `model: ${body.model as string}` } });
  const client = await createDefaultPiLlmChatClient();
  const code = async (model: string) => {
    try {
      await client({ channel: "claude", model, protocol: "anthropic", baseUrl: stub.baseUrl, apiKeys: ["k"] }, askLow);
    } catch (error) {
      return error instanceof LlmProviderError ? error.code : error;
    }
    return "resolved";
  };

  assert.equal(await code("claude-opus-5-5"), "auth_failed");
  assert.equal(await code("claude-opus-5-5-typo"), "model_not_found");
});

test("a planner repair call, its rejected draft an assistant turn, reaches the Messages API through pi-ai", async (t) => {
  const stub = await messagesApiStub(t, () => ({ status: 200, events: claudeReply("claude-sonnet-5-5", "{\"outcome\":\"ready\"}") }));
  const client = await createDefaultPiLlmChatClient();
  const result = await client(
    { channel: "claude", model: "claude-sonnet-5-5", protocol: "anthropic", baseUrl: stub.baseUrl, apiKeys: ["k"] },
    {
      messages: [
        { role: "system", content: "Reply with one JSON object only." },
        { role: "user", content: "Request: Compare NVDA and AMD revenue" },
        { role: "assistant", content: "{\"outcome\":\"ready\",\"subjects\":[]}" },
        { role: "user", content: "The draft was rejected. Fix these issues and reply with the corrected JSON only." },
      ],
      temperature: 0,
      maxTokens: 4096,
    },
  );

  assert.equal(result.text, "{\"outcome\":\"ready\"}");
  const [{ body }] = stub.requests as [CapturedRequest];
  const text = (content: unknown) => typeof content === "string" ? content : (content as Array<{ text: string }>).map((block) => block.text).join("");
  assert.deepEqual((body.messages as Array<{ role: string; content: unknown }>).map((message) => [message.role, text(message.content)]), [
    ["user", "Request: Compare NVDA and AMD revenue"],
    ["assistant", "{\"outcome\":\"ready\",\"subjects\":[]}"],
    ["user", "The draft was rejected. Fix these issues and reply with the corrected JSON only."],
  ]);
});

test("a multi-turn history reaches an OpenAI-compatible API through pi-ai, each earlier answer an assistant turn", async (t) => {
  const bodies: Array<Record<string, unknown>> = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    bodies.push(JSON.parse(raw));
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: "Because of data centers." }, finish_reason: "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const client = await createDefaultPiLlmChatClient();

  const result = await client(
    { channel: "local", model: "m", protocol: "openai-compatible", baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, apiKeys: ["k"] },
    { messages: [{ role: "user", content: "Analyze NVDA" }, { role: "assistant", content: "NVIDIA grew revenue." }, { role: "user", content: "Why?" }], maxTokens: 256 },
  );

  assert.equal(result.text, "Because of data centers.");
  assert.deepEqual((bodies[0]!.messages as Array<{ role: string; content: unknown }>).map((message) => [message.role, typeof message.content === "string" ? message.content : JSON.stringify(message.content)]), [
    ["user", "Analyze NVDA"],
    ["assistant", "NVIDIA grew revenue."],
    ["user", "Why?"],
  ]);
});

test("a throw inside pi-ai before any request is a client failure, not a provider failure", async () => {
  const client = createPiLlmChatClient({
    complete: async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'totalTokens')");
    },
  });
  await assert.rejects(async () => client(deployment(), { messages: [{ role: "user", content: "hello" }] }), (error: unknown) =>
    error instanceof LlmClientError && error.code === "client_failed" && /totalTokens/u.test(error.message));

});

test("a fetch that never reached the provider stays a provider failure the router falls back from", async () => {
  const client = createPiLlmChatClient({
    complete: async () => {
      throw new TypeError("fetch failed");
    },
  });
  await assert.rejects(async () => client(deployment(), { messages: [{ role: "user", content: "hello" }] }), (error: unknown) =>
    error instanceof LlmProviderError && error.code === "provider_failed");
});

function deployment(): LlmDeployment {
  return {
    channel: "openai",
    model: "gpt-4.1",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKeys: ["sk-openai"],
  };
}
