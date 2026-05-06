import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import { createDevApiServer, createFixtureDevApiAdapters } from "../src/http.ts";

async function startServer(
  t: TestContext,
  env: Record<string, string | undefined> = {},
  options: Parameters<typeof createDevApiServer>[1] = { adapters: createFixtureDevApiAdapters() },
): Promise<string> {
  const server = createDevApiServer(env, options);
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

test("POST /v1/analyze/runs returns a generated Block[] memo", async (t) => {
  const base = await startServer(t);

  const response = await fetch(`${base}/v1/analyze/runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": "00000000-0000-4000-8000-000000000001",
    },
    body: JSON.stringify({
      template_id: "earnings-quality",
      instructions: "Review margin quality",
      source_categories: ["filings", "news"],
    }),
  });
  const body = await response.json() as { blocks?: Array<Record<string, unknown>> };

  assert.equal(response.status, 201);
  assert.ok(Array.isArray(body.blocks));
  assert.equal(body.blocks[0].kind, "rich_text");
  assert.match(JSON.stringify(body.blocks), /Review margin quality/);
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
  assert.equal(runBody.status, "completed");
});

test("PATCH and DELETE /v1/agents expose update and delete controls", async (t) => {
  const base = await startServer(t);
  const headers = {
    "content-type": "application/json",
    "x-user-id": "00000000-0000-4000-8000-000000000001",
  };

  const created = await fetch(`${base}/v1/agents`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Review bot", thesis: "Track guidance", cadence: "daily" }),
  });
  const agent = await created.json() as { agent_id: string };

  const patched = await fetch(`${base}/v1/agents/${agent.agent_id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ enabled: false }),
  });
  const patchBody = await patched.json() as Record<string, unknown>;
  assert.equal(patched.status, 200);
  assert.equal(patchBody.enabled, false);

  const deleted = await fetch(`${base}/v1/agents/${agent.agent_id}`, {
    method: "DELETE",
    headers,
  });
  assert.equal(deleted.status, 204);
});

test("agent routes are scoped to the authenticated user", async (t) => {
  const base = await startServer(t);
  const userA = "00000000-0000-4000-8000-000000000001";
  const userB = "00000000-0000-4000-8000-000000000002";
  const headersA = {
    "content-type": "application/json",
    "x-user-id": userA,
  };

  const created = await fetch(`${base}/v1/agents`, {
    method: "POST",
    headers: headersA,
    body: JSON.stringify({ name: "Private monitor", thesis: "Track margins", cadence: "daily" }),
  });
  const agent = await created.json() as { agent_id: string };

  const run = await fetch(`${base}/v1/agents/${agent.agent_id}/runs`, {
    method: "POST",
    headers: { "x-user-id": userA },
  });
  assert.equal(run.status, 201);

  const listB = await fetch(`${base}/v1/agents`, {
    headers: { "x-user-id": userB },
  });
  const listBBody = await listB.json() as { agents?: unknown[]; runs?: unknown[] };
  assert.equal(listB.status, 200);
  assert.deepEqual(listBBody.agents, []);
  assert.deepEqual(listBBody.runs, []);

  const patchB = await fetch(`${base}/v1/agents/${agent.agent_id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-user-id": userB,
    },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(patchB.status, 404);

  const runB = await fetch(`${base}/v1/agents/${agent.agent_id}/runs`, {
    method: "POST",
    headers: { "x-user-id": userB },
  });
  assert.equal(runB.status, 404);

  const deleteB = await fetch(`${base}/v1/agents/${agent.agent_id}`, {
    method: "DELETE",
    headers: { "x-user-id": userB },
  });
  assert.equal(deleteB.status, 404);
});

test("Analyze and Agents BFF routes use durable adapters instead of server-local state", async (t) => {
  const adapters = createFixtureDevApiAdapters();
  const userId = "00000000-0000-4000-8000-000000000001";
  const headers = {
    "content-type": "application/json",
    "x-user-id": userId,
  };
  const firstBase = await startServer(t, {}, { adapters });

  const created = await fetch(`${firstBase}/v1/agents`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Durable monitor", thesis: "Track restarts", cadence: "daily" }),
  });
  const agent = await created.json() as { agent_id: string };
  assert.equal(created.status, 201);

  const run = await fetch(`${firstBase}/v1/agents/${agent.agent_id}/runs`, {
    method: "POST",
    headers: { "x-user-id": userId },
  });
  assert.equal(run.status, 201);

  const analyzeRun = await fetch(`${firstBase}/v1/analyze/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      template_id: "earnings-quality",
      instructions: "Persist this memo",
      source_categories: ["filings"],
    }),
  });
  assert.equal(analyzeRun.status, 201);

  const secondBase = await startServer(t, {}, { adapters });
  const persistedAgents = await fetch(`${secondBase}/v1/agents`, {
    headers: { "x-user-id": userId },
  });
  const persistedAgentsBody = await persistedAgents.json() as {
    agents?: Array<{ agent_id: string; name: string }>;
    runs?: Array<{ agent_id: string; status: string }>;
  };
  assert.equal(persistedAgents.status, 200);
  assert.ok(persistedAgentsBody.agents?.some((persisted) => persisted.agent_id === agent.agent_id));
  assert.ok(persistedAgentsBody.runs?.some((persisted) => persisted.agent_id === agent.agent_id));

  const persistedTemplates = await fetch(`${secondBase}/v1/analyze/templates`, {
    headers: { "x-user-id": userId },
  });
  const persistedTemplatesBody = await persistedTemplates.json() as { runs?: Array<{ template_id: string }> };
  assert.equal(persistedTemplates.status, 200);
  assert.ok(persistedTemplatesBody.runs?.some((persisted) => persisted.template_id === "earnings-quality"));
});

test("GET /v1/agents requires an authenticated user", async (t) => {
  const base = await startServer(t);

  const response = await fetch(`${base}/v1/agents`);
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 401);
  assert.equal(body.error, "x-user-id header is required");
});

test("POST /v1/agents returns 400 for malformed JSON", async (t) => {
  const base = await startServer(t);

  const response = await fetch(`${base}/v1/agents`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": "00000000-0000-4000-8000-000000000001",
    },
    body: "{not json",
  });
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 400);
  assert.equal(body.error, "request body must be valid JSON");
});

test("GET /v1/dev/services documents local BFF routing and intentional exclusions", async (t) => {
  const base = await startServer(t);

  const response = await fetch(`${base}/v1/dev/services`);
  const body = await response.json() as { services?: Array<{ name: string; status: string }> };

  assert.equal(response.status, 200);
  assert.ok(body.services?.some((service) => service.name === "chat" && service.status === "vite_proxy"));
  assert.ok(body.services?.some((service) => service.name === "artifact" && service.status === "library"));
});
