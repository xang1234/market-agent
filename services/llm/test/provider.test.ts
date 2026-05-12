import assert from "node:assert/strict";
import test from "node:test";

import {
  LlmAuthError,
  LlmBadResponseError,
  LlmRateLimitError,
  LlmTransportError,
  OpenAiCompatibleProvider,
  type LlmFetch,
} from "../src/index.ts";

type FetchInput = string | URL;
type FetchInit = Parameters<LlmFetch>[1];

type RecordedCall = { url: string; init: FetchInit };

function jsonResponse(payload: unknown, status = 200): Awaited<ReturnType<LlmFetch>> {
  let consumed = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: {
      get(name: string): string | null {
        if (name.toLowerCase() === "retry-after") return null;
        return null;
      },
    },
    async json() {
      if (consumed) throw new Error("body already consumed");
      consumed = true;
      return payload;
    },
    async text() {
      if (consumed) throw new Error("body already consumed");
      consumed = true;
      return typeof payload === "string" ? payload : JSON.stringify(payload);
    },
    body: null,
  };
}

function errorResponse(status: number, body: string, retryAfter?: string): Awaited<ReturnType<LlmFetch>> {
  return {
    ok: false,
    status,
    statusText: "",
    headers: {
      get(name: string): string | null {
        return name.toLowerCase() === "retry-after" && retryAfter !== undefined ? retryAfter : null;
      },
    },
    async json() {
      throw new Error("error body is not json");
    },
    async text() {
      return body;
    },
    body: null,
  };
}

function recordingFetch(response: Awaited<ReturnType<LlmFetch>> | Error): {
  fetchImpl: LlmFetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchImpl: LlmFetch = async (input: FetchInput, init?: FetchInit) => {
    calls.push({ url: input.toString(), init });
    if (response instanceof Error) throw response;
    return response;
  };
  return { fetchImpl, calls };
}

test("chatComplete posts a well-formed body and parses choices", async () => {
  const { fetchImpl, calls } = recordingFetch(
    jsonResponse({
      choices: [
        {
          message: { content: "hello world", tool_calls: null },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
    }),
  );
  const provider = new OpenAiCompatibleProvider({
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    fetchImpl,
  });

  const result = await provider.chatComplete({
    messages: [{ role: "user", content: "hi" }],
    temperature: 0.2,
  });

  assert.equal(result.text, "hello world");
  assert.equal(result.finishReason, "stop");
  assert.deepEqual(result.usage, {
    promptTokens: 12,
    completionTokens: 5,
    totalTokens: 17,
  });
  assert.equal(result.toolCalls.length, 0);

  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(call.init?.method, "POST");
  assert.equal(call.init?.headers?.["authorization"], "Bearer sk-test");
  assert.equal(call.init?.headers?.["content-type"], "application/json");
  const body = JSON.parse(call.init?.body as string) as Record<string, unknown>;
  assert.equal(body.model, "gpt-4o-mini");
  assert.deepEqual(body.messages, [{ role: "user", content: "hi" }]);
  assert.equal(body.temperature, 0.2);
  assert.ok(!("reasoning_effort" in body));
});

test("chatComplete strips trailing slashes from baseUrl", async () => {
  const { fetchImpl, calls } = recordingFetch(
    jsonResponse({ choices: [{ message: { content: "" }, finish_reason: "stop" }] }),
  );
  const provider = new OpenAiCompatibleProvider({
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1//",
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    fetchImpl,
  });
  await provider.chatComplete({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(calls[0]?.url, "https://api.openai.com/v1/chat/completions");
});

test("chatComplete omits authorization header when no api key is provided", async () => {
  const { fetchImpl, calls } = recordingFetch(
    jsonResponse({ choices: [{ message: { content: "" }, finish_reason: "stop" }] }),
  );
  const provider = new OpenAiCompatibleProvider({
    providerId: "openai_compatible",
    baseUrl: "http://localhost:11434/v1",
    apiKey: null,
    model: "llama3",
    fetchImpl,
  });
  await provider.chatComplete({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(calls[0]?.init?.headers?.["authorization"], undefined);
});

test("chatComplete sends reasoning_effort only when supported and not 'off'", async () => {
  const baseResponse = () =>
    jsonResponse({ choices: [{ message: { content: "" }, finish_reason: "stop" }] });

  for (const variant of [
    { supportsReasoningEffort: false, reasoningEffort: "high" as const, expectField: false },
    { supportsReasoningEffort: true, reasoningEffort: "off" as const, expectField: false },
    { supportsReasoningEffort: true, reasoningEffort: null, expectField: false },
    { supportsReasoningEffort: true, reasoningEffort: "high" as const, expectField: true },
  ]) {
    const { fetchImpl, calls } = recordingFetch(baseResponse());
    const provider = new OpenAiCompatibleProvider({
      providerId: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "o4-mini",
      supportsReasoningEffort: variant.supportsReasoningEffort,
      reasoningEffort: variant.reasoningEffort,
      fetchImpl,
    });
    await provider.chatComplete({ messages: [{ role: "user", content: "hi" }] });
    const body = JSON.parse(calls[0]?.init?.body as string) as Record<string, unknown>;
    if (variant.expectField) {
      assert.equal(body.reasoning_effort, variant.reasoningEffort);
    } else {
      assert.ok(!("reasoning_effort" in body), JSON.stringify(variant));
    }
  }
});

test("chatComplete forwards tools and tool_choice", async () => {
  const { fetchImpl, calls } = recordingFetch(
    jsonResponse({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "get_quote", arguments: "{\"ticker\":\"AAPL\"}" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    }),
  );
  const provider = new OpenAiCompatibleProvider({
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    model: "gpt-4o",
    fetchImpl,
  });

  const result = await provider.chatComplete({
    messages: [{ role: "user", content: "quote AAPL" }],
    tools: [
      {
        type: "function",
        function: {
          name: "get_quote",
          description: "Latest quote",
          parameters: { type: "object", properties: { ticker: { type: "string" } } },
        },
      },
    ],
    toolChoice: "required",
  });

  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0]?.name, "get_quote");
  assert.equal(result.toolCalls[0]?.arguments, "{\"ticker\":\"AAPL\"}");
  const body = JSON.parse(calls[0]?.init?.body as string) as Record<string, unknown>;
  assert.equal(body.tool_choice, "required");
  assert.ok(Array.isArray(body.tools));
});

test("chatComplete maps 401/403 to LlmAuthError", async () => {
  const { fetchImpl } = recordingFetch(errorResponse(401, "unauthorized"));
  const provider = new OpenAiCompatibleProvider({
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    fetchImpl,
  });
  await assert.rejects(
    () => provider.chatComplete({ messages: [{ role: "user", content: "hi" }] }),
    (error: unknown) => error instanceof LlmAuthError,
  );
});

test("chatComplete maps 429 to LlmRateLimitError with retry-after parsed", async () => {
  const { fetchImpl } = recordingFetch(errorResponse(429, "slow down", "5"));
  const provider = new OpenAiCompatibleProvider({
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    fetchImpl,
  });
  await assert.rejects(
    () => provider.chatComplete({ messages: [{ role: "user", content: "hi" }] }),
    (error: unknown) => error instanceof LlmRateLimitError && (error as LlmRateLimitError).retryAfterMs === 5000,
  );
});

test("chatComplete maps 5xx to LlmTransportError", async () => {
  const { fetchImpl } = recordingFetch(errorResponse(503, "unavailable"));
  const provider = new OpenAiCompatibleProvider({
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    fetchImpl,
  });
  await assert.rejects(
    () => provider.chatComplete({ messages: [{ role: "user", content: "hi" }] }),
    (error: unknown) => error instanceof LlmTransportError,
  );
});

test("chatComplete wraps network failures in LlmTransportError", async () => {
  const { fetchImpl } = recordingFetch(new Error("ECONNREFUSED"));
  const provider = new OpenAiCompatibleProvider({
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    fetchImpl,
  });
  await assert.rejects(
    () => provider.chatComplete({ messages: [{ role: "user", content: "hi" }] }),
    (error: unknown) => error instanceof LlmTransportError,
  );
});

test("chatComplete throws LlmBadResponseError on malformed payloads", async () => {
  const { fetchImpl } = recordingFetch(jsonResponse({ not: "a chat completion" }));
  const provider = new OpenAiCompatibleProvider({
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    fetchImpl,
  });
  await assert.rejects(
    () => provider.chatComplete({ messages: [{ role: "user", content: "hi" }] }),
    (error: unknown) => error instanceof LlmBadResponseError,
  );
});
