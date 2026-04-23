import http from "node:http";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import { createChatServer } from "../src/http.ts";

async function startServer(t: TestContext): Promise<string> {
  const server = createChatServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function getRaw(base: string, path: string): Promise<{ status: number; body: string }> {
  const url = new URL(base);
  return await new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: url.hostname,
        port: Number(url.port),
        method: "GET",
        path,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("stream route returns 400 when run_id is missing", async (t) => {
  const base = await startServer(t);

  const response = await fetch(`${base}/v1/chat/threads/thread-123/stream`);
  const body = await response.json() as { error?: string };

  assert.equal(response.status, 400);
  assert.equal(body.error, "'run_id' is required");
});

test("server returns 404 for non-stream routes", async (t) => {
  const base = await startServer(t);

  const response = await fetch(`${base}/v1/chat/threads`);
  const body = await response.json() as { error?: string };

  assert.equal(response.status, 404);
  assert.equal(body.error, "not found");
});

test("server returns 400 for malformed percent-encoding in thread_id and stays alive", async (t) => {
  const base = await startServer(t);

  const malformed = await getRaw(base, "/v1/chat/threads/%ZZ/stream?run_id=run-456");
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body, JSON.stringify({ error: "invalid request path" }));

  const response = await fetch(`${base}/v1/chat/threads/thread-123/stream?run_id=run-456`);
  assert.equal(response.status, 200);

  const reader = response.body?.getReader();
  assert.ok(reader, "expected a readable stream body");
  await reader.cancel();
});

test("stream route returns SSE headers for a valid request", async (t) => {
  const base = await startServer(t);

  const response = await fetch(
    `${base}/v1/chat/threads/thread-123/stream?run_id=run-456`,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
  assert.equal(response.headers.get("connection"), "keep-alive");

  const reader = response.body?.getReader();
  assert.ok(reader, "expected a readable stream body");
  await reader.cancel();
});

test("stream route writes an immediate turn.started event", async (t) => {
  const base = await startServer(t);

  const response = await fetch(
    `${base}/v1/chat/threads/thread-123/stream?run_id=run-456`,
  );

  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert.ok(reader, "expected a readable stream body");

  const first = await reader.read();
  assert.equal(first.done, false);

  const chunk = new TextDecoder().decode(first.value);
  assert.match(chunk, /event: turn\.started/);
  assert.match(chunk, /"thread_id":"thread-123"/);
  assert.match(chunk, /"run_id":"run-456"/);
  assert.match(chunk, /"stub":true/);

  await reader.cancel();
});

test("stream route stays open long enough to emit a heartbeat", async (t) => {
  const base = await startServer(t);

  const response = await fetch(
    `${base}/v1/chat/threads/thread-123/stream?run_id=run-456`,
  );

  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert.ok(reader, "expected a readable stream body");

  const decoder = new TextDecoder();
  let transcript = "";

  while (!transcript.includes("event: heartbeat")) {
    const next = await reader.read();
    assert.equal(next.done, false, "expected the SSE stream to remain open");
    transcript += decoder.decode(next.value, { stream: true });
  }

  assert.match(transcript, /event: turn\.started/);
  assert.match(transcript, /event: heartbeat/);

  await reader.cancel();
});
