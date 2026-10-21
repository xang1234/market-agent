// Drives the chat server over HTTP on the frozen golden dataset, as the web
// client does, for suites that run whole turns (#221).
// ponytail: golden-conversation.test.ts keeps its own copies of these helpers
// (unchanged here to avoid conflicts with open work); move it onto this module
// when next touched.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { TestContext } from "node:test";

import { connectedPool, registerLifoCleanup } from "../../../../db/test/docker-pg.ts";
import { createChatServer } from "../../src/http.ts";
import { loadChatServerOptionsFromEnv } from "../../src/runtime.ts";
import { parseSseEvents, type ParsedSseEvent } from "../sse-helpers.ts";

export const USER_ID = "10000000-0000-4000-8000-000000000001";

// The frozen dataset with recorded model replies, judged strictly.
export const GOLDEN_ENV: Record<string, string> = {
  LLM_CHANNELS: "fixture",
  LLM_FIXTURE_PROTOCOL: "openai",
  LLM_FIXTURE_MODELS: "recorded",
  LITELLM_MODEL: "fixture/recorded",
  LLM_REPLAY_FILE: join(import.meta.dirname, "llm-replies.json"),
  CHAT_VERIFICATION_MODE: "strict",
  DEV_NO_KEYS: "true",
};

export type Block = Record<string, unknown> & { id?: string; kind?: string; title?: string };
export type ChatMessage = { message_id: string; role: string; snapshot_id: string; blocks: Block[] };

export async function startChatServer(t: TestContext, databaseUrl: string): Promise<string> {
  const pool = await connectedPool(t, databaseUrl);
  const server = createChatServer({ ...(await loadChatServerOptionsFromEnv()), threadsDb: pool });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  registerLifoCleanup(t, () => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

export async function api<T>(base: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "x-user-id": USER_ID, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(response.ok, `${method} ${path} -> ${response.status} ${await response.clone().text()}`);
  return response.json() as Promise<T>;
}

// Saves the user's message, then reads the turn's stream until it completes or
// errors (the server keeps the connection open for reconnects).
export async function runTurn(base: string, threadId: string, userIntent: string): Promise<ParsedSseEvent[]> {
  const messageId = randomUUID();
  await api(base, "POST", `/v1/chat/threads/${threadId}/messages`, { message_id: messageId, snapshot_id: randomUUID(), content: userIntent });
  return streamTurn(base, threadId, userIntent, messageId);
}

// Runs the turn the user's message `turnId` asks for on a new run, as the
// client's retry does.
export async function streamTurn(base: string, threadId: string, userIntent: string, turnId: string): Promise<ParsedSseEvent[]> {
  const params = new URLSearchParams({ run_id: randomUUID(), turn_id: turnId, user_intent: userIntent, user_id: USER_ID });
  const response = await fetch(`${base}/v1/chat/threads/${threadId}/stream?${params}`);
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let transcript = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      transcript += decoder.decode(value, { stream: true });
      const events = parseSseEvents(transcript);
      if (events.some((event) => event.event === "turn.completed" || event.event === "turn.error")) return events;
    }
  } finally {
    await reader.cancel();
  }
  return parseSseEvents(transcript);
}

export function completedTurn(events: ParsedSseEvent[]): ParsedSseEvent {
  const error = events.find((event) => event.event === "turn.error");
  assert.equal(error, undefined, `turn.error: ${JSON.stringify(error?.data)}`);
  const completed = events.find((event) => event.event === "turn.completed");
  assert.ok(completed, `no turn.completed; events: ${events.map((event) => event.event).join(", ")}`);
  return completed;
}

export async function latestAssistantMessage(base: string, threadId: string): Promise<ChatMessage> {
  const { messages } = await api<{ messages: ChatMessage[] }>(base, "GET", `/v1/chat/threads/${threadId}/messages`);
  const answer = messages.filter((message) => message.role === "assistant").at(-1);
  assert.ok(answer, "no assistant message in the thread");
  return answer;
}

// A recorded conversation records each turn's scope proposal
// (scope-proposal.ts): a turn answered without one fails the test instead of
// quietly asking for nothing new.
export function requireRecordedScopes(t: TestContext): void {
  const warn = console.warn;
  let missing = 0;
  t.mock.method(console, "warn", (...args: unknown[]) => {
    if (String(args[0]).startsWith("[chat] no scope proposal")) missing += 1;
    warn(...args);
  });
  registerLifoCleanup(t, () => assert.equal(missing, 0, "a turn had no recorded scope proposal; its warning is logged above"));
}

export function withEnv(t: TestContext, values: Record<string, string>): void {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  registerLifoCleanup(t, () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}
