import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { supersedeSourcePublicationAttestation } from "../../evidence/src/financial-attestations.ts";
import type { SnapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { finalizeUnit } from "../src/finalize.ts";
import type { FinancialEvidencePort } from "../src/ports.ts";
import { reserveReplayRun } from "../src/run-repo.ts";
import { createFinancialWorker } from "../src/worker.ts";
import { authorityFor, completedRun, databaseUrl, engineDatabase, HASH, IDS, pinnedClients, readyRun, revenuePlan } from "./db-fixtures.ts";

const noEvidence = (): FinancialEvidencePort => ({
  listInputCandidates: async () => assert.fail("a replay must never select evidence"),
  readSplitHistory: async () => assert.fail("a replay must never select evidence"),
  readPriceObservations: async () => assert.fail("a replay must never select evidence"),
});

test("a publication proof correction", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for publication correction coverage");
    return;
  }
  const db = await engineDatabase(t, "fin-proof-correction");
  const [client] = await pinnedClients(t, db, 1) as [SnapshotTransactionClient];
  const pool = await connectedPool(t, databaseUrl(db));
  const proofsOf = async (sourceId: string) => (await db.query<{ attestation_id: string; available_no_later_than: string; supersedes: string | null; supersession_reason: string | null }>(
    `select attestation_id::text, to_char(available_no_later_than at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as available_no_later_than,
            supersedes::text, supersession_reason
       from source_publication_attestations where source_id = $1 order by attested_at`,
    [sourceId],
  )).rows;
  const boundProofs = async (runId: string) => (await db.query<{ input_slot: string; publication_attestation_id: string }>(
    `select input_slot, publication_attestation_id::text from financial_run_inputs where run_id = $1 order by input_slot`,
    [runId],
  )).rows;

  const sealed = await completedRun(db, client, revenuePlan());
  const ready = await readyRun(db, revenuePlan());
  const [original] = await proofsOf(IDS.sourceV1);
  assert.ok(original);
  const bound = await boundProofs(sealed.runId);
  assert.deepEqual(bound.map((row) => row.publication_attestation_id), [original.attestation_id, original.attestation_id]);

  const correction = await supersedeSourcePublicationAttestation(db, original.attestation_id, {
    source_id: IDS.sourceV1,
    document_id: null,
    source_version_hash: HASH.v1,
    available_not_before: null,
    available_no_later_than: "2024-01-12T23:59:59.999-05:00",
    timing_precision: "date",
    source_timezone: "America/New_York",
    proof_method: "accession_bound_archive",
    proof_ref: "proof:corrected",
    proof_hash: HASH.proof,
    mapping_version: "test-accession-archive.v1",
  }, "correction");

  await t.test("the correction is a new row; the proof it supersedes is unchanged", async () => {
    assert.deepEqual(await proofsOf(IDS.sourceV1), [
      original,
      { attestation_id: correction.attestation_id, available_no_later_than: "2024-01-13T04:59:59.999Z", supersedes: original.attestation_id, supersession_reason: "correction" },
    ]);
  });

  await t.test("a sealed run keeps its pinned proof and still replays to the same results", async () => {
    assert.deepEqual(await boundProofs(sealed.runId), bound);
    const reserved = await reserveReplayRun(client, { owner_user_id: IDS.owner, source_run_id: sealed.runId, request_key: randomUUID() });
    assert.equal(reserved.status, "created");
    const replayId = (reserved as { run: { run_id: string } }).run.run_id;
    const worker = createFinancialWorker({ pool, worker_id: "replayer", ttl_ms: 60_000, evidence: noEvidence, parents: {}, interval_ms: 1_000, max_runs_per_tick: 10 });
    const entry = (await worker.tick()).find((candidate) => candidate.run_id === replayId);
    assert.ok(entry && entry.status === "replayed", JSON.stringify(entry));
    assert.deepEqual(entry.replay, { status: "verified", run_id: replayId, replay_of_run_id: sealed.runId, verified_outputs: ["a_out_prev", "a_out_rev"] });
  });

  await t.test("a run not yet sealed cannot seal on the superseded proof", async () => {
    const outcome = await finalizeUnit({ client, lease: ready.lease, authority: authorityFor(), unit_id: "a_unit", snapshot_id: randomUUID(), persistParent: async () => {} });
    assert.deepEqual(outcome, {
      status: "rejected",
      reason_code: "verification_failed",
      failures: ["a_rev", "a_prev"].map((slot) => ({
        reason_code: "financial_input_ineligible",
        details: { run_id: ready.runId, input_slot: slot, reason: "publication_proof_unavailable" },
      })),
    });
  });
});
