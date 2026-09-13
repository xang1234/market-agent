import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { DiscoveryError } from "../src/types.ts";
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
  assert.deepEqual(service.calls, { create: 1, draft: 1, save: 1, start: 2, cancel: 1, delete: 1 });
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

function fixtureService() {
  const calls = { create: 0, draft: 0, save: 0, start: 0, cancel: 0, delete: 0 };
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
    get nextError() { return nextError; }, set nextError(value: Error | null) { nextError = value; },
    get foreign() { return foreign; }, set foreign(value: boolean) { foreign = value; },
    async createCampaign() { calls.create += 1; fail(); return campaign; },
    async listCampaigns() { fail(); return { items: [campaign], next_cursor: null }; },
    async getCampaign() { fail(); return { campaign, brief: null, latest_run: run, readiness: { ready: true, missing: [] } }; },
    async draftBrief() { calls.draft += 1; fail(); return { brief: briefFixture(), base_version: 0 }; },
    async saveBrief() { calls.save += 1; fail(); return { brief_id: run.brief_id, campaign_id: CAMPAIGN, version: 1, brief: briefFixture(), hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", approved_at: null, created_at: "2026-09-10T00:00:00.000Z" }; },
    async startRun() { calls.start += 1; fail(); return run; },
    async listRuns() { fail(); return { items: [run], next_cursor: null }; },
    async getRun() { fail(); return { ...run, shortlist: [], cost: { status: "unavailable" } }; },
    async getCandidates() { fail(); return { items: [], next_cursor: null }; },
    async getEvents() { fail(); return { items: [], next_sequence: 0, has_more: false }; },
    async cancelRun() { calls.cancel += 1; fail(); return run; },
    async deleteCampaign() { calls.delete += 1; fail(); },
  };
}
