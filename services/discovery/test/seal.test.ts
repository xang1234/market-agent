import assert from "node:assert/strict";
import test from "node:test";

import { decideCandidate } from "../src/assessment.ts";
import { snapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { sealCandidateAssessment } from "../src/seal.ts";
import { analystFixture, briefFixture, packetFixture, skepticFixture } from "./fixtures.ts";

const SNAPSHOT_ID = "d0000000-0000-4000-8000-000000000001";
const TOOL_CALL_ID = "d1000000-0000-4000-8000-000000000001";
const TOOL_HASH = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

test("sealing verifies cited claim documents and tool provenance before returning a snapshot", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const tx = {
    release() {},
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (text.includes("from tool_call_logs")) return result([{ tool_call_id: TOOL_CALL_ID, result_hash: TOOL_HASH }] as unknown as R[]);
      if (text.includes("insert into snapshots")) return result([{ snapshot_id: SNAPSHOT_ID, created_at: "2026-09-10T12:00:01.000Z" }] as unknown as R[]);
      if (text.includes("verifier_fail_logs")) return result([] as R[]);
      throw new Error(`unexpected query: ${text}`);
    },
  };
  const packet = packetFixture();
  const decision = decideCandidate(briefFixture(), packet, analystFixture(), skepticFixture(), "2026-09-10T12:00:00Z");

  const snapshotId = await sealCandidateAssessment(snapshotTransactionClient(tx), {
    snapshot_id: SNAPSHOT_ID,
    packet,
    decision,
    as_of: "2026-09-10T12:00:00Z",
    tool_calls: [{ tool_call_id: TOOL_CALL_ID, result_hash: TOOL_HASH }],
  });

  assert.equal(snapshotId, SNAPSHOT_ID);
  assert.ok(queries.some((query) => query.text.includes("from tool_call_logs")));
  assert.ok(queries.some((query) => query.text.includes("insert into snapshots")));
});

test("sealing refuses unverifiable tool provenance", async () => {
  const tx = {
    release() {},
    async query<R extends Record<string, unknown>>() { return result([] as R[]); },
  };
  const packet = packetFixture();
  const decision = decideCandidate(briefFixture(), packet, analystFixture(), skepticFixture(), "2026-09-10T12:00:00Z");

  await assert.rejects(
    () => sealCandidateAssessment(snapshotTransactionClient(tx), { snapshot_id: SNAPSHOT_ID, packet, decision, as_of: "2026-09-10T12:00:00Z", tool_calls: [{ tool_call_id: TOOL_CALL_ID, result_hash: TOOL_HASH }] }),
    /snapshot verification failed/,
  );
});

test("an evidence-backed exclusion is sealed rather than discarded", async () => {
  const tx = {
    release() {},
    async query<R extends Record<string, unknown>>(text: string) {
      if (text.includes("from tool_call_logs")) return result([{ tool_call_id: TOOL_CALL_ID, result_hash: TOOL_HASH }] as unknown as R[]);
      if (text.includes("insert into snapshots")) return result([{ snapshot_id: SNAPSHOT_ID, created_at: "2026-09-10T12:00:01.000Z" }] as unknown as R[]);
      if (text.includes("verifier_fail_logs")) return result([] as R[]);
      throw new Error(`unexpected query: ${text}`);
    },
  };
  const analyst = analystFixture();
  const skeptic = skepticFixture();
  analyst.criteria[0] = { ...analyst.criteria[0]!, outcome: "fail" };
  skeptic.criteria[0] = { ...skeptic.criteria[0]!, outcome: "fail" };
  const decision = decideCandidate(briefFixture(), packetFixture(), analyst, skeptic, "2026-09-10T12:00:00Z");
  assert.equal(decision.state, "excluded");

  const snapshotId = await sealCandidateAssessment(snapshotTransactionClient(tx), {
    snapshot_id: SNAPSHOT_ID,
    packet: packetFixture(),
    decision,
    as_of: "2026-09-10T12:00:00Z",
    tool_calls: [{ tool_call_id: TOOL_CALL_ID, result_hash: TOOL_HASH }],
  });

  assert.equal(snapshotId, SNAPSHOT_ID);
});

function result<R extends Record<string, unknown>>(rows: R[]) {
  return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
}
