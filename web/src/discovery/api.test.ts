import assert from "node:assert/strict";
import test from "node:test";

import { listCandidates, listEvents } from "./api.ts";

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
