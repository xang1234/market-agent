import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";

import {
  createDevApiServer,
  createFixtureDevApiAdapters,
} from "../src/http.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";

async function startServer(
  t: TestContext,
  options: Parameters<typeof createDevApiServer>[1] = { adapters: createFixtureDevApiAdapters() },
): Promise<string> {
  const server = createDevApiServer({}, options);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function authedHeaders(userId = USER_ID): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-user-id": userId,
  };
}

test("GET /v1/llm/providers returns the static catalog", async (t) => {
  const base = await startServer(t);
  const response = await fetch(`${base}/v1/llm/providers`);
  assert.equal(response.status, 200);
  const body = await response.json() as { providers: Array<{ id: string }> };
  const ids = body.providers.map((entry) => entry.id);
  assert.ok(ids.includes("openai"));
  assert.ok(ids.includes("openai_compatible"));
});

test("GET /v1/llm/providers returns 503 when llm adapter is absent", async (t) => {
  const adapters = { ...createFixtureDevApiAdapters(), llm: undefined };
  const base = await startServer(t, { adapters });
  const response = await fetch(`${base}/v1/llm/providers`);
  assert.equal(response.status, 503);
});

test("GET /v1/llm/credentials requires the x-user-id header", async (t) => {
  const base = await startServer(t);
  const response = await fetch(`${base}/v1/llm/credentials`);
  assert.equal(response.status, 401);
});

test("PUT /v1/llm/credentials/:role saves and lists without exposing plaintext", async (t) => {
  const base = await startServer(t);

  const put = await fetch(`${base}/v1/llm/credentials/summary`, {
    method: "PUT",
    headers: authedHeaders(),
    body: JSON.stringify({
      provider_id: "openai",
      model: "gpt-4o-mini",
      reasoning_effort: "low",
      api_key: "sk-test-XYZ1234",
    }),
  });
  assert.equal(put.status, 200);
  const saved = await put.json() as Record<string, unknown>;
  assert.equal(saved.role, "summary");
  assert.equal(saved.provider_id, "openai");
  assert.equal(saved.model, "gpt-4o-mini");
  assert.equal(saved.reasoning_effort, "low");
  assert.equal(saved.key_fingerprint, "1234");
  assert.ok(!("api_key" in saved));

  const list = await fetch(`${base}/v1/llm/credentials`, { headers: authedHeaders() });
  assert.equal(list.status, 200);
  const listed = await list.json() as { credentials: Array<Record<string, unknown>> };
  assert.equal(listed.credentials.length, 1);
  for (const credential of listed.credentials) {
    for (const value of Object.values(credential)) {
      if (typeof value !== "string") continue;
      assert.ok(!value.includes("sk-test"), `value leaks plaintext: ${value}`);
    }
  }
});

test("PUT /v1/llm/credentials/:role rejects unknown providers", async (t) => {
  const base = await startServer(t);
  const response = await fetch(`${base}/v1/llm/credentials/summary`, {
    method: "PUT",
    headers: authedHeaders(),
    body: JSON.stringify({
      provider_id: "anthropic",
      model: "claude",
    }),
  });
  assert.equal(response.status, 500);
  const body = await response.json() as { error?: string };
  assert.match(body.error ?? "", /provider_id 'anthropic'/);
});

test("PUT /v1/llm/credentials/:role rejects invalid role path segments", async (t) => {
  const base = await startServer(t);
  const response = await fetch(`${base}/v1/llm/credentials/bogus`, {
    method: "PUT",
    headers: authedHeaders(),
    body: JSON.stringify({ provider_id: "openai", model: "gpt-4o-mini" }),
  });
  assert.equal(response.status, 404);
});

test("PUT /v1/llm/credentials/:role rejects empty model", async (t) => {
  const base = await startServer(t);
  const response = await fetch(`${base}/v1/llm/credentials/summary`, {
    method: "PUT",
    headers: authedHeaders(),
    body: JSON.stringify({ provider_id: "openai", model: "" }),
  });
  assert.equal(response.status, 400);
  const body = await response.json() as { error?: string };
  assert.match(body.error ?? "", /model is required/);
});

test("PUT /v1/llm/credentials/:role rejects malformed JSON", async (t) => {
  const base = await startServer(t);
  const response = await fetch(`${base}/v1/llm/credentials/summary`, {
    method: "PUT",
    headers: authedHeaders(),
    body: "{ not json",
  });
  assert.equal(response.status, 400);
});

test("PUT /v1/llm/credentials/:role omitting api_key keeps the existing key fingerprint", async (t) => {
  const base = await startServer(t);
  await fetch(`${base}/v1/llm/credentials/analyst`, {
    method: "PUT",
    headers: authedHeaders(),
    body: JSON.stringify({
      provider_id: "openai",
      model: "gpt-4o",
      api_key: "sk-first-XYZ4242",
    }),
  });
  const second = await fetch(`${base}/v1/llm/credentials/analyst`, {
    method: "PUT",
    headers: authedHeaders(),
    body: JSON.stringify({
      provider_id: "openai",
      model: "gpt-4.1",
      // api_key omitted intentionally
    }),
  });
  assert.equal(second.status, 200);
  const saved = await second.json() as Record<string, unknown>;
  assert.equal(saved.model, "gpt-4.1");
  assert.equal(saved.key_fingerprint, "4242");
});

test("PUT /v1/llm/credentials/:role with empty api_key clears the saved key", async (t) => {
  const base = await startServer(t);
  await fetch(`${base}/v1/llm/credentials/analyst`, {
    method: "PUT",
    headers: authedHeaders(),
    body: JSON.stringify({
      provider_id: "openai",
      model: "gpt-4o",
      api_key: "sk-first-XYZ4242",
    }),
  });
  const cleared = await fetch(`${base}/v1/llm/credentials/analyst`, {
    method: "PUT",
    headers: authedHeaders(),
    body: JSON.stringify({
      provider_id: "openai",
      model: "gpt-4o",
      api_key: "",
    }),
  });
  assert.equal(cleared.status, 200);
  const saved = await cleared.json() as Record<string, unknown>;
  assert.equal(saved.key_fingerprint, null);
});

test("DELETE /v1/llm/credentials/:role removes the row and reports 404 on the second call", async (t) => {
  const base = await startServer(t);
  await fetch(`${base}/v1/llm/credentials/reader`, {
    method: "PUT",
    headers: authedHeaders(),
    body: JSON.stringify({ provider_id: "openai", model: "gpt-4o-mini", api_key: "sk-r-1234" }),
  });
  const first = await fetch(`${base}/v1/llm/credentials/reader`, {
    method: "DELETE",
    headers: { "x-user-id": USER_ID },
  });
  assert.equal(first.status, 204);
  const second = await fetch(`${base}/v1/llm/credentials/reader`, {
    method: "DELETE",
    headers: { "x-user-id": USER_ID },
  });
  assert.equal(second.status, 404);
});

test("POST /v1/llm/credentials/:role/test returns ok=true after a successful adapter call", async (t) => {
  const base = await startServer(t);
  await fetch(`${base}/v1/llm/credentials/summary`, {
    method: "PUT",
    headers: authedHeaders(),
    body: JSON.stringify({
      provider_id: "openai",
      model: "gpt-4o-mini",
      api_key: "sk-test-XYZ1234",
    }),
  });
  const response = await fetch(`${base}/v1/llm/credentials/summary/test`, {
    method: "POST",
    headers: { "x-user-id": USER_ID },
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { ok: boolean; latency_ms: number; model: string };
  assert.equal(body.ok, true);
  assert.equal(body.model, "gpt-4o-mini");
  assert.equal(typeof body.latency_ms, "number");
});

test("POST /v1/llm/credentials/:role/test returns 404 when no credential is saved", async (t) => {
  const base = await startServer(t);
  const response = await fetch(`${base}/v1/llm/credentials/reader/test`, {
    method: "POST",
    headers: { "x-user-id": USER_ID },
  });
  assert.equal(response.status, 404);
});

test("credential rows are isolated per user", async (t) => {
  const base = await startServer(t);
  const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";

  await fetch(`${base}/v1/llm/credentials/summary`, {
    method: "PUT",
    headers: authedHeaders(),
    body: JSON.stringify({ provider_id: "openai", model: "gpt-4o-mini", api_key: "sk-a-1234" }),
  });
  const otherList = await fetch(`${base}/v1/llm/credentials`, {
    headers: { "x-user-id": OTHER_USER_ID },
  });
  const otherBody = await otherList.json() as { credentials: unknown[] };
  assert.equal(otherBody.credentials.length, 0);
});
