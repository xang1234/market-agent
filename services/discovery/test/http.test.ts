import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { DiscoveryError } from "../src/types.ts";
import { createDiscoveryService } from "../src/service.ts";
import { createDiscoveryDevApiAdapter } from "../../dev-api/src/discovery-adapter.ts";
import { createDevApiServer, createFixtureDevApiAdapters } from "../../dev-api/src/http.ts";
import { briefFixture } from "./fixtures.ts";

const USER = "10000000-0000-4000-8000-000000000001";
const CAMPAIGN = "20000000-0000-4000-8000-000000000001";
const RUN = "30000000-0000-4000-8000-000000000001";
const REQUEST = "40000000-0000-4000-8000-000000000001";
type TestContext = { after(callback: () => void | Promise<void>): void };

async function startServer(t: TestContext, service = fixtureService()): Promise<{ base: string; service: ReturnType<typeof fixtureService> }> {
  const server = createDevApiServer({}, {
    adapters: { ...createFixtureDevApiAdapters(), discovery: createDiscoveryDevApiAdapter(service as never) },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, service };
}

async function request(base: string, path: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-user-id": USER, ...init.headers },
  });
}

test("discovery HTTP rejects unauthenticated creation before a draft provider can run", async (t) => {
  const { base, service } = await startServer(t);
  const response = await fetch(`${base}/v1/discovery/campaigns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Grid", question: "Which US-listed companies benefit from grid modernization spending?" }),
  });
  assert.equal(response.status, 401);
  assert.equal(service.calls.create, 0);
  assert.equal(service.calls.draft, 0);
});

test("every discovery route authenticates before reading or mutating owned campaign data", async (t) => {
  const { base, service } = await startServer(t);
  const unauthenticated = async (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  const body = JSON.stringify({ name: "Grid", question: "Which US-listed companies benefit from grid modernization spending?" });
  const start = JSON.stringify({ brief_version: 1, brief_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", request_key: REQUEST });
  const brief = JSON.stringify({ expected_version: 0, brief: briefFixture() });
  const routes: Array<[string, RequestInit?]> = [
    ["/v1/discovery/metric-options"], ["/v1/discovery/campaigns"], ["/v1/discovery/campaigns", { method: "POST", body }],
    [`/v1/discovery/campaigns/${CAMPAIGN}`], [`/v1/discovery/campaigns/${CAMPAIGN}`, { method: "DELETE" }],
    [`/v1/discovery/campaigns/${CAMPAIGN}/draft`, { method: "POST", body: JSON.stringify({ expected_version: 0 }) }],
    [`/v1/discovery/campaigns/${CAMPAIGN}/brief`, { method: "PUT", body: brief }],
    [`/v1/discovery/campaigns/${CAMPAIGN}/runs`], [`/v1/discovery/campaigns/${CAMPAIGN}/runs`, { method: "POST", body: start }],
    [`/v1/discovery/runs/${RUN}`], [`/v1/discovery/runs/${RUN}/candidates`], [`/v1/discovery/runs/${RUN}/events`], [`/v1/discovery/runs/${RUN}/cancel`, { method: "POST" }],
  ];
  for (const [path, init] of routes) assert.equal((await unauthenticated(path, init)).status, 401, path);
  assert.deepEqual(service.calls, { create: 0, draft: 0, save: 0, start: 0, cancel: 0, delete: 0, metrics: 0 });
});

test("discovery HTTP exposes canonical browser-safe metric options", async (t) => {
  const { base, service } = await startServer(t);
  const response = await request(base, "/v1/discovery/metric-options");
  assert.equal(response.status, 200);
  const body = await response.json() as { items: Array<Record<string, unknown>> };
  assert.deepEqual(body.items, [{
    metric_key: "revenue_growth", display_name: "Revenue growth", unit_class: "percentage", aggregation: "period_over_period", interpretation: "Growth in reported revenue", canonical_source_class: "financial_statement",
  }]);
  assert.equal("api_key" in body.items[0]!, false);
  assert.equal(service.calls.metrics, 1);
});

test("discovery HTTP exposes every campaign and run endpoint with owned request data", async (t) => {
  const { base, service } = await startServer(t);
  const question = "Which US-listed companies benefit from grid modernization spending?";

  assert.equal((await request(base, "/v1/discovery/campaigns", { method: "POST", body: JSON.stringify({ name: "Grid", question }) })).status, 201);
  assert.equal((await request(base, "/v1/discovery/campaigns")).status, 200);
  assert.equal((await request(base, `/v1/discovery/campaigns/${CAMPAIGN}`)).status, 200);
  assert.equal((await request(base, `/v1/discovery/campaigns/${CAMPAIGN}/draft`, { method: "POST", body: JSON.stringify({ expected_version: 0 }) })).status, 200);
  assert.equal((await request(base, `/v1/discovery/campaigns/${CAMPAIGN}/brief`, { method: "PUT", body: JSON.stringify({ expected_version: 0, brief: briefFixture() }) })).status, 200);
  const firstStart = await request(base, `/v1/discovery/campaigns/${CAMPAIGN}/runs`, { method: "POST", body: JSON.stringify({ brief_version: 1, brief_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", request_key: REQUEST }) });
  const duplicateStart = await request(base, `/v1/discovery/campaigns/${CAMPAIGN}/runs`, { method: "POST", body: JSON.stringify({ brief_version: 1, brief_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", request_key: REQUEST }) });
  assert.equal(firstStart.status, 201);
  assert.equal(duplicateStart.status, 201);
  assert.equal((await firstStart.json() as { run_id: string }).run_id, (await duplicateStart.json() as { run_id: string }).run_id);
  assert.equal((await request(base, `/v1/discovery/campaigns/${CAMPAIGN}/runs`)).status, 200);
  assert.equal((await request(base, `/v1/discovery/runs/${RUN}`)).status, 200);
  assert.equal((await request(base, `/v1/discovery/runs/${RUN}/candidates?limit=10&state=shortlisted`)).status, 200);
  assert.equal((await request(base, `/v1/discovery/runs/${RUN}/events?after=0`)).status, 200);
  assert.equal((await request(base, `/v1/discovery/runs/${RUN}/cancel`, { method: "POST" })).status, 200);
  assert.equal((await request(base, `/v1/discovery/campaigns/${CAMPAIGN}`, { method: "DELETE" })).status, 204);
  assert.deepEqual(service.calls, { create: 1, draft: 1, save: 1, start: 2, cancel: 1, delete: 1, metrics: 0 });
});

test("discovery HTTP omits an absent candidate state instead of sending a null filter", async (t) => {
  const { base, service } = await startServer(t);

  assert.equal((await request(base, `/v1/discovery/runs/${RUN}/candidates?limit=10`)).status, 200);
  assert.deepEqual(service.candidateInputs, [{ cursor: null, limit: 10 }]);
});

test("discovery HTTP maps malformed, foreign, stale, rate-limited, and unavailable requests", async (t) => {
  const { base, service } = await startServer(t);
  assert.equal((await request(base, "/v1/discovery/campaigns", { method: "POST", body: "{" })).status, 400);
  service.foreign = true;
  assert.equal((await request(base, `/v1/discovery/campaigns/${CAMPAIGN}`)).status, 404);
  service.foreign = false;
  service.nextError = new DiscoveryError("stale_brief", "brief version is stale");
  assert.equal((await request(base, `/v1/discovery/campaigns/${CAMPAIGN}/brief`, { method: "PUT", body: JSON.stringify({ expected_version: 0, brief: briefFixture() }) })).status, 409);
  service.nextError = new DiscoveryError("draft_rate_limit", "draft rate limit is exhausted");
  assert.equal((await request(base, `/v1/discovery/campaigns/${CAMPAIGN}/draft`, { method: "POST", body: JSON.stringify({ expected_version: 0 }) })).status, 429);
  service.nextError = new DiscoveryError("unavailable", "model provider is unavailable");
  assert.equal((await request(base, `/v1/discovery/campaigns/${CAMPAIGN}/draft`, { method: "POST", body: JSON.stringify({ expected_version: 0 }) })).status, 503);
});

test("an authenticated run request receives 503 from the real unavailable readiness composition before repository creation", async (t) => {
  let startRunCalls = 0;
  const service = createDiscoveryService({
    repo: { async startRun() { startRunCalls += 1; throw new Error("must not start"); } } as never,
    reads: {} as never,
  });
  const server = createDevApiServer({}, {
    adapters: { ...createFixtureDevApiAdapters(), discovery: createDiscoveryDevApiAdapter(service) },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const response = await request(base, `/v1/discovery/campaigns/${CAMPAIGN}/runs`, {
    method: "POST",
    body: JSON.stringify({ brief_version: 1, brief_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", request_key: REQUEST }),
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Discovery is unavailable: model, search, reference", code: "unavailable" });
  assert.equal(startRunCalls, 0);
});

test("discovery HTTP rejects unknown mutation fields, malformed hashes, and malformed encoded identifiers before service dispatch", async (t) => {
  const { base, service } = await startServer(t);
  const question = "Which US-listed companies benefit from grid modernization spending?";
  const badRequests: Array<[string, RequestInit]> = [
    ["/v1/discovery/campaigns", { method: "POST", body: JSON.stringify({ name: "Grid", question, extra: true }) }],
    [`/v1/discovery/campaigns/${CAMPAIGN}/draft`, { method: "POST", body: JSON.stringify({ expected_version: 0, extra: true }) }],
    [`/v1/discovery/campaigns/${CAMPAIGN}/brief`, { method: "PUT", body: JSON.stringify({ expected_version: 0, brief: briefFixture(), extra: true }) }],
    [`/v1/discovery/campaigns/${CAMPAIGN}/runs`, { method: "POST", body: JSON.stringify({ brief_version: 1, brief_hash: "sha256:not-a-hash", request_key: REQUEST }) }],
    [`/v1/discovery/campaigns/${CAMPAIGN}/runs`, { method: "POST", body: JSON.stringify({ brief_version: 1, brief_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", request_key: REQUEST, extra: true }) }],
    [`/v1/discovery/runs/${RUN}/cancel`, { method: "POST", body: "{}" }],
    [`/v1/discovery/campaigns/${CAMPAIGN}`, { method: "DELETE", body: "{}" }],
    ["/v1/discovery/campaigns/%E0%A4%A", {}],
  ];
  for (const [path, init] of badRequests) assert.equal((await request(base, path, init)).status, 400, path);
  assert.deepEqual(service.calls, { create: 0, draft: 0, save: 0, start: 0, cancel: 0, delete: 0, metrics: 0 });
  assert.equal((await request(base, "/v1/discoverySettings")).status, 404, "only the exact discovery namespace is owned");
});

function fixtureService() {
  const calls = { create: 0, draft: 0, save: 0, start: 0, cancel: 0, delete: 0, metrics: 0 };
  const candidateInputs: unknown[] = [];
  let nextError: Error | null = null;
  let foreign = false;
  const fail = () => {
    if (foreign) throw new DiscoveryError("not_found", "campaign not found");
    if (nextError !== null) { const error = nextError; nextError = null; throw error; }
  };
  const campaign = { campaign_id: CAMPAIGN, user_id: USER, name: "Grid", question: "Which US-listed companies benefit from grid modernization spending?", current_brief_version: 1, created_at: "2026-09-10T00:00:00.000Z", updated_at: "2026-09-10T00:00:00.000Z", archived_at: null };
  const run = { run_id: RUN, campaign_id: CAMPAIGN, brief_id: "50000000-0000-4000-8000-000000000001", user_id: USER, status: "queued", stage: "queued", policy_version: "v1", request_key: REQUEST, limits: {}, usage: {}, coverage: {}, started_at: null, finished_at: null, cancel_requested_at: null };
  return {
    calls,
    candidateInputs,
    get nextError() { return nextError; }, set nextError(value: Error | null) { nextError = value; },
    get foreign() { return foreign; }, set foreign(value: boolean) { foreign = value; },
    async createCampaign() { calls.create += 1; fail(); return campaign; },
    async listMetricOptions() { calls.metrics += 1; fail(); return [{ metric_key: "revenue_growth", display_name: "Revenue growth", unit_class: "percentage", aggregation: "period_over_period", interpretation: "Growth in reported revenue", canonical_source_class: "financial_statement" }]; },
    async listCampaigns() { fail(); return { items: [campaign], next_cursor: null }; },
    async getCampaign() { fail(); return { campaign, brief: null, latest_run: run, readiness: { ready: true, missing: [] } }; },
    async draftBrief() { calls.draft += 1; fail(); return { brief: briefFixture(), base_version: 0 }; },
    async saveBrief() { calls.save += 1; fail(); return { brief_id: run.brief_id, campaign_id: CAMPAIGN, version: 1, brief: briefFixture(), hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", approved_at: null, created_at: "2026-09-10T00:00:00.000Z" }; },
    async startRun() { calls.start += 1; fail(); return run; },
    async listRuns() { fail(); return { items: [run], next_cursor: null }; },
    async getRun() { fail(); return { ...run, shortlist: [], cost: { status: "unavailable" } }; },
    async getCandidates(_userId: string, _runId: string, input: unknown) { candidateInputs.push(input); fail(); return { items: [], next_cursor: null }; },
    async getEvents() { fail(); return { items: [], next_sequence: 0, has_more: false }; },
    async cancelRun() { calls.cancel += 1; fail(); return run; },
    async deleteCampaign() { calls.delete += 1; fail(); },
  };
}
