import assert from "node:assert/strict";
import test from "node:test";

import type { DiscoveryRepository, StoredCandidate } from "../src/ports.ts";
import { createDiscoveryReadModel } from "../src/read-model.ts";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const RUN_ID = "20000000-0000-4000-8000-000000000001";

test("filtered candidate cursors remain valid when the cursor row changes state", async () => {
  const candidates = [candidate(1), candidate(2), candidate(3)];
  const repo = { candidates: async () => candidates } as unknown as DiscoveryRepository;
  const db = { query: async () => { throw new Error("unassessed candidates need no visibility query"); } };
  const reads = createDiscoveryReadModel(db);

  const first = await reads.candidatePage(repo, USER_ID, RUN_ID, { cursor: null, limit: 1, state: "researching" });
  assert.equal(first.items[0]?.candidate_id, candidates[0]!.candidate_id);
  assert.ok(first.next_cursor);

  candidates[0] = { ...candidates[0]!, state: "shortlisted" };
  const second = await reads.candidatePage(repo, USER_ID, RUN_ID, { cursor: first.next_cursor, limit: 1, state: "researching" });
  assert.equal(second.items[0]?.candidate_id, candidates[1]!.candidate_id);
});

function candidate(index: number): StoredCandidate {
  return {
    candidate_id: `90000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    identity: null,
    name: `Candidate ${index}`,
    origins: [],
    mechanism_ids: [],
    reason_codes: [],
    state: "researching",
    ordinal: index,
    assessment: null,
    snapshot_id: null,
    rank: null,
  };
}
