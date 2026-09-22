import assert from "node:assert/strict";
import test from "node:test";

import { listCandidates, listEvents, saveBrief } from "./api.ts";
import { briefFixture } from "../../../services/discovery/test/fixtures.ts";

test("rejects candidate responses with a non-HTTPS source URL", async () => {
  // This would catch source URLs being passed to an anchor without scheme validation.
  await assert.rejects(
    listCandidates({
      userId: "user-1",
      runId: "run-1",
      fetchImpl: async () => json({ items: [candidateWithUrl("data:text/html,unsafe")], next_cursor: null }),
    }),
    /Invalid source URL response/,
  );
});

test('lists a later trail page with the supplied event cursor', async () => {
  let requested = ''
  await listEvents({
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
    saveBrief({
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
