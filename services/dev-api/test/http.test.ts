import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import { createDevApiServer } from "../src/http.ts";

async function startServer(
  t: TestContext,
  env: Record<string, string | undefined> = {},
): Promise<string> {
  const server = createDevApiServer(env);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

test("health endpoint reports ok plus parsed flags", async (t) => {
  const base = await startServer(t, { MA_FLAG_SHOW_DEV_BANNER: "true" });

  const response = await fetch(`${base}/healthz`);
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.status, "ok");
  assert.deepEqual(body.flags, {
    placeholderApiEnabled: true,
    showDevBanner: true,
  });
});

test("placeholder route returns 503 when placeholder API is disabled", async (t) => {
  const base = await startServer(t, { MA_FLAG_PLACEHOLDER_API: "false" });

  const response = await fetch(`${base}/v1/dev/placeholders`);
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 503);
  assert.equal(body.error, "placeholder api disabled");
});

test("GET /v1/analyze/templates returns session-scoped template options", async (t) => {
  const base = await startServer(t);

  const response = await fetch(`${base}/v1/analyze/templates`, {
    headers: { "x-user-id": "00000000-0000-4000-8000-000000000001" },
  });
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.templates));
  assert.match(JSON.stringify(body.templates), /Earnings quality/);
});

test("GET /v1/agents and POST /v1/agents/:id/runs expose agent workflow data", async (t) => {
  const base = await startServer(t);
  const headers = { "x-user-id": "00000000-0000-4000-8000-000000000001" };

  const list = await fetch(`${base}/v1/agents`, { headers });
  const listBody = await list.json() as { agents?: Array<{ agent_id: string }> };
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(listBody.agents));
  assert.ok(listBody.agents.length > 0);

  const run = await fetch(`${base}/v1/agents/${listBody.agents[0].agent_id}/runs`, {
    method: "POST",
    headers,
  });
  const runBody = await run.json() as Record<string, unknown>;
  assert.equal(run.status, 201);
  assert.equal(runBody.agent_id, listBody.agents[0].agent_id);
  assert.equal(runBody.status, "running");
});

test("GET /v1/dev/services documents local BFF routing and intentional exclusions", async (t) => {
  const base = await startServer(t);

  const response = await fetch(`${base}/v1/dev/services`);
  const body = await response.json() as { services?: Array<{ name: string; status: string }> };

  assert.equal(response.status, 200);
  assert.ok(body.services?.some((service) => service.name === "chat" && service.status === "proxied"));
  assert.ok(body.services?.some((service) => service.name === "artifact" && service.status === "library"));
});
