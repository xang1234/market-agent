import assert from "node:assert/strict";
import test from "node:test";

import { createAssessmentCommitter, saveValidatedRoleCheckpoint } from "../src/assessment-repo.ts";
import { decideCandidate } from "../src/assessment.ts";
import type { AnalystOutput, Citation } from "../src/types.ts";
import { analystFixture, briefFixture, packetFixture, skepticFixture } from "./fixtures.ts";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const RUN_ID = "70000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "d0000000-0000-4000-8000-000000000001";
const TOOL_CALL_ID = "d1000000-0000-4000-8000-000000000001";
const TOOL_HASH = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

test("assessment commit seals before atomically persisting an eligible candidate result", async () => {
  const queries: string[] = [];
  const packet = packetFixture();
  const decision = decideCandidate(briefFixture(), packet, analystFixture(), skepticFixture(), "2026-09-10T12:00:00Z");
  const db = {
    release() {},
    async query<R extends Record<string, unknown>>(text: string) {
      queries.push(text);
      if (text.trim() === "begin" || text.trim() === "commit") return result([] as R[]);
      if (text.includes("from users where user_id")) return result([{ user_id: USER_ID }] as unknown as R[]);
      if (text.includes("from discovery_runs where run_id")) return result([{ lease_epoch: 2, lease_owner: "worker", lease_expires_at: "2026-09-10T13:00:00.000Z", cancel_requested_at: null }] as unknown as R[]);
      if (text.includes("from discovery_candidates") && text.includes("for update")) return result([{ candidate_id: packet.candidate_id, issuer_id: packet.identity.issuer_id, state: "researching", assessment: null, snapshot_id: null }] as unknown as R[]);
      if (text.includes("from documents d join sources")) return result(packet.claims.map((claim) => ({ document_id: claim.document_id, source_id: claim.source_id })) as unknown as R[]);
      if (text.includes("from sources where source_id")) return result(packet.claims.map((claim) => ({ source_id: claim.source_id })) as unknown as R[]);
      if (text.includes("from discovery_attempts")) return result([{ tool_call_id: TOOL_CALL_ID, result_hash: TOOL_HASH }] as unknown as R[]);
      if (text.includes("from tool_call_logs")) return result([{ tool_call_id: TOOL_CALL_ID, result_hash: TOOL_HASH }] as unknown as R[]);
      if (text.includes("insert into snapshots")) return result([{ snapshot_id: SNAPSHOT_ID, created_at: "2026-09-10T12:00:01.000Z" }] as unknown as R[]);
      if (text.includes("update discovery_candidates")) return result([] as R[], 1);
      if (text.includes("update discovery_runs set next_event_sequence")) return result([{ next_event_sequence: 1 }] as unknown as R[]);
      if (text.includes("insert into discovery_events")) return result([] as R[], 1);
      throw new Error(`unexpected query: ${text}`);
    },
  };
  const commit = createAssessmentCommitter({ db, clock: () => new Date("2026-09-10T12:00:00.000Z"), newSnapshotId: () => SNAPSHOT_ID });

  const committed = await commit({ run_id: RUN_ID, user_id: USER_ID, worker_id: "worker", epoch: 2, expires_at: "2026-09-10T13:00:00.000Z" }, packet, decision);

  assert.equal(committed.snapshot_id, SNAPSHOT_ID);
  assert.equal(committed.decision.state, "eligible_not_shortlisted");
  assert.ok(queries.findIndex((query) => query.includes("insert into snapshots")) < queries.findIndex((query) => query.includes("update discovery_candidates")));
  assert.ok(queries.findIndex((query) => query.includes("update discovery_candidates")) < queries.findIndex((query) => query.includes("insert into discovery_events")));
});

test("source revocation prevents a stale assessment packet from sealing or changing the candidate", async () => {
  const queries: string[] = [];
  const packet = packetFixture();
  const decision = decideCandidate(briefFixture(), packet, analystFixture(), skepticFixture(), "2026-09-10T12:00:00Z");
  const db = {
    release() {},
    async query<R extends Record<string, unknown>>(text: string) {
      queries.push(text);
      if (text.trim() === "begin" || text.trim() === "rollback") return result([] as R[]);
      if (text.includes("from users where user_id")) return result([{ user_id: USER_ID }] as unknown as R[]);
      if (text.includes("from discovery_runs where run_id")) return result([{ lease_epoch: 2, lease_owner: "worker", lease_expires_at: "2026-09-10T13:00:00.000Z", cancel_requested_at: null }] as unknown as R[]);
      if (text.includes("from discovery_candidates") && text.includes("for update")) return result([{ candidate_id: packet.candidate_id, issuer_id: packet.identity.issuer_id, state: "researching", assessment: null, snapshot_id: null }] as unknown as R[]);
      if (text.includes("from documents d join sources")) return result([] as R[]);
      throw new Error(`unexpected query: ${text}`);
    },
  };
  const commit = createAssessmentCommitter({ db, clock: () => new Date("2026-09-10T12:00:00.000Z") });

  await assert.rejects(
    () => commit({ run_id: RUN_ID, user_id: USER_ID, worker_id: "worker", epoch: 2, expires_at: "2026-09-10T13:00:00.000Z" }, packet, decision),
    { code: "not_found" },
  );
  assert.equal(queries.some((query) => query.includes("insert into snapshots")), false);
  assert.equal(queries.some((query) => query.includes("update discovery_candidates")), false);
});

test("a repeated matching completion returns its sealed assessment without a second snapshot", async () => {
  const queries: string[] = [];
  const packet = packetFixture();
  const decision = decideCandidate(briefFixture(), packet, analystFixture(), skepticFixture(), "2026-09-10T12:00:00Z");
  const db = {
    release() {},
    async query<R extends Record<string, unknown>>(text: string) {
      queries.push(text);
      if (text.trim() === "begin" || text.trim() === "commit") return result([] as R[]);
      if (text.includes("from users where user_id")) return result([{ user_id: USER_ID }] as unknown as R[]);
      if (text.includes("from discovery_runs where run_id")) return result([{ lease_epoch: 2, lease_owner: "worker", lease_expires_at: "2026-09-10T13:00:00.000Z", cancel_requested_at: null }] as unknown as R[]);
      if (text.includes("from discovery_candidates") && text.includes("for update")) return result([{
        candidate_id: packet.candidate_id, issuer_id: packet.identity.issuer_id, state: "eligible_not_shortlisted", assessment: decision, snapshot_id: SNAPSHOT_ID,
      }] as unknown as R[]);
      throw new Error(`unexpected query: ${text}`);
    },
  };
  const commit = createAssessmentCommitter({ db, clock: () => new Date("2026-09-10T12:00:00.000Z") });

  const repeated = await commit({ run_id: RUN_ID, user_id: USER_ID, worker_id: "worker", epoch: 2, expires_at: "2026-09-10T13:00:00.000Z" }, packet, decision);

  assert.deepEqual(repeated, { decision, snapshot_id: SNAPSHOT_ID });
  assert.equal(queries.some((query) => query.includes("insert into snapshots")), false);
  assert.equal(queries.some((query) => query.includes("update discovery_candidates")), false);
});

test("a validated role checkpoint is persisted separately from the raw provider response", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const packet = packetFixture();
  const db = {
    release() {},
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (text.trim() === "begin" || text.trim() === "commit") return result([] as R[]);
      if (text.includes("from users where user_id")) return result([{ user_id: USER_ID }] as unknown as R[]);
      if (text.includes("from discovery_runs where run_id")) return result([{ lease_epoch: 2, lease_owner: "worker", lease_expires_at: "2026-09-10T13:00:00.000Z", cancel_requested_at: null }] as unknown as R[]);
      if (text.includes("from discovery_candidates") && text.includes("for update")) return result([{ candidate_id: packet.candidate_id, issuer_id: packet.identity.issuer_id, state: "researching", assessment: null, snapshot_id: null }] as unknown as R[]);
      if (text.includes("update discovery_candidates set analyst_output")) return result([] as R[], 1);
      throw new Error(`unexpected query: ${text}`);
    },
  };
  const checkpoint = {
    version: 1 as const,
    role: "analyst" as const,
    request_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    request_packet_hash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    packet_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    output: analystFixture() as AnalystOutput<Citation>,
  };

  await saveValidatedRoleCheckpoint(db, { run_id: RUN_ID, user_id: USER_ID, worker_id: "worker", epoch: 2, expires_at: "2026-09-10T13:00:00.000Z" }, packet.candidate_id, checkpoint, () => new Date("2026-09-10T12:00:00.000Z"));

  const update = queries.find((query) => query.text.includes("update discovery_candidates set analyst_output"));
  assert.ok(update);
  assert.deepEqual(JSON.parse(String(update.values?.[2])), checkpoint);
});

function result<R extends Record<string, unknown>>(rows: R[], rowCount = rows.length) {
  return { rows, rowCount, command: "SELECT", oid: 0, fields: [] };
}
