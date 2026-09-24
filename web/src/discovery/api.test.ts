import assert from "node:assert/strict";
import test from "node:test";

import * as discoveryApi from "./api.ts";
import type { Brief } from "../../../services/discovery/src/types.ts";

const api = discoveryApi as typeof discoveryApi & {
  draftBrief?: (args: { userId: string; campaignId: string; expectedVersion: number; fetchImpl: typeof fetch }) => Promise<{ brief: Brief; base_version: number }>;
};

test("rejects candidate responses with a non-HTTPS source URL", async () => {
  // This would catch source URLs being passed to an anchor without scheme validation.
  await assert.rejects(
    api.listCandidates({
      userId: "user-1",
      runId: "run-1",
      fetchImpl: async () => json({ items: [candidateWithUrl("data:text/html,unsafe")], next_cursor: null }),
    }),
    /Invalid source URL response/,
  );
});

test('lists a later trail page with the supplied event cursor', async () => {
  let requested = ''
  await api.listEvents({
    userId: 'user-1',
    runId: 'run-1',
    after: 12,
    fetchImpl: async (input) => {
      requested = String(input)
      return json({ items: [], next_sequence: 12, has_more: false })
    },
  })
  assert.match(requested, /\/events\?after=12$/)
})

test("rejects a fractional numeric metric threshold in a Discovery response", async () => {
  const outgoingBrief = briefFixture();
  outgoingBrief.criteria[0]!.metric = {
    metric_key: "revenue_growth_yoy",
    unit: "ratio",
    period_kind: "fiscal_q",
    operator: "lte",
    threshold: "0.3",
    max_age_days: 90,
  };
  const legacyResponseBrief = structuredClone(outgoingBrief);
  legacyResponseBrief.criteria[0]!.metric!.threshold = 0.0000001;

  await assert.rejects(
    api.saveBrief({
      userId: "user-1",
      campaignId: "campaign-1",
      expectedVersion: 0,
      brief: outgoingBrief,
      fetchImpl: async () => json({
        brief_id: "brief-1",
        campaign_id: "campaign-1",
        version: 1,
        brief: legacyResponseBrief,
        hash: "sha256:brief",
        approved_at: null,
        created_at: "2026-09-22T00:00:00.000Z",
      }),
    }),
    /Invalid exact decimal response/,
  );
});

test("drafts a versioned brief proposal through the canonical endpoint", async () => {
  // This would catch the browser calling the stale /brief/draft path, omitting the
  // concurrency version, or accepting an incomplete proposal response.
  let requested = "";
  let body: unknown;
  assert.equal(typeof api.draftBrief, "function");

  const result = await api.draftBrief!({
    userId: "user-1",
    campaignId: "campaign-1",
    expectedVersion: 0,
    fetchImpl: async (input, init) => {
      requested = String(input);
      body = JSON.parse(String(init?.body));
      return json({ brief: briefFixture(), base_version: 0 });
    },
  });

  assert.equal(requested, "/v1/discovery/campaigns/campaign-1/draft");
  assert.deepEqual(body, { expected_version: 0 });
  assert.equal(result.base_version, 0);
  assert.equal(result.brief.question, "Which US-listed companies benefit from grid modernization spending?");
});

function candidateWithUrl(url: string): unknown {
  return {
    candidate_id: "candidate-1",
    identity: { issuer_id: "issuer-1", listing_id: "listing-1", legal_name: "Grid Systems Inc.", ticker: "GRID", mic: "XNAS", currency: "USD", asset_type: "common_stock", identity_source_ids: [] },
    name: "Grid Systems",
    state: "shortlisted",
    rank: 1,
    snapshot_id: "snapshot-1",
    evidence_available: true,
    can_promote: false,
    assessment: null,
    sources: [{ citation: { kind: "claim", id: "claim-1" }, title: "Unsafe source", url, published_at: null, retrieved_at: "2026-09-10T00:00:00.000Z" }],
    origins: ["web"],
    mechanism_ids: ["mechanism-1"],
    reason_codes: [],
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

function briefFixture(): Brief {
  return {
    schema_version: 1,
    question: "Which US-listed companies benefit from grid modernization spending?",
    market: "us_listed",
    horizon_months: 24,
    lookback_months: 12,
    mechanisms: [{ mechanism_id: "grid-demand", label: "Grid demand", chain: ["Investment", "Equipment orders"] }],
    criteria: [{ criterion_id: "profitability", importance: "must", statement: "Has durable profits", falsifier: "Persistent losses" }],
    seed_queries: ["grid equipment suppliers"],
    exclusions: [],
    preferences: [],
    queries: [{ mechanism_id: "grid-demand", query: "grid equipment suppliers" }],
  };
}
