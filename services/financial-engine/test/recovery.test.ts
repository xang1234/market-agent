// Process-restart simulation: a worker dies after each checkpoint and
// finalization boundary, its lease expires, and a supervisor resumes the run.
// Every case must end with one artifact per unit, no extra evidence reads, the
// right coverage, and no step repeated after it committed.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Client } from "pg";
import { connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createRuntimeAuthority, evaluateBoundPlan, nodeLineageHashes } from "../../financial-core/src/index.ts";
import type { SnapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { bindPlanInputs } from "../src/bind-inputs.ts";
import { buildUnitCheckpoint, checkpointUnit } from "../src/checkpoints.ts";
import { listRunEvents } from "../src/events-repo.ts";
import { createEvidenceFinancialPort } from "../src/evidence-adapter.ts";
import { finalizeUnit, type PersistParentArtifact } from "../src/finalize.ts";
import { fencedTransaction, StaleLeaseError, type RunLease } from "../src/lease.ts";
import type { FinancialEvidencePort, SqlExecutor } from "../src/ports.ts";
import { readRunStatus } from "../src/read-model.ts";
import { listRecoverableRuns, type ParentRecovery } from "../src/recovery.ts";
import { requestCancellation, reserveRun } from "../src/run-repo.ts";
import { declareUnits } from "../src/unit-repo.ts";
import { createFinancialWorker, type WorkerPool, type WorkerTickEntry } from "../src/worker.ts";
import { authorityFor, databaseUrl, engineDatabase, IDS, leasedRun, marginPlan, pinnedClients, readyRun } from "./db-fixtures.ts";

const authority = authorityFor();

async function expire(db: Client, runId: string): Promise<void> {
  await db.query(`update financial_runs set lease_expires_at = now() - interval '1 second' where run_id = $1`, [runId]);
}

test("supervised recovery after worker restarts", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for recovery coverage");
    return;
  }
  const db = await engineDatabase(t, "fin-supervised");
  await db.query(`create table test_parent_artifacts (run_id uuid, unit_id text, snapshot_id uuid)`);
  const [client] = await pinnedClients(t, db, 1) as [SnapshotTransactionClient];
  const pool = await connectedPool(t, databaseUrl(db));

  let evidenceReads = 0;
  const counting = (executor: SqlExecutor): FinancialEvidencePort => {
    const real = createEvidenceFinancialPort(executor);
    return { listInputCandidates: (request) => { evidenceReads += 1; return real.listInputCandidates(request); } };
  };
  let parentCalls = 0;
  const persistParent: PersistParentArtifact = async (tx, publication) => {
    parentCalls += 1;
    await tx.client.query(`insert into test_parent_artifacts values ($1, $2, $3)`, [publication.run_id, publication.unit_id, publication.snapshot_id]);
  };
  const chat: ParentRecovery = { authority: async () => authority, persistParent };
  const supervisor = createFinancialWorker({ pool, worker_id: "supervisor", ttl_ms: 60_000, evidence: counting, parents: { chat_thread: chat }, interval_ms: 1_000, max_runs_per_tick: 10 });
  const tickFor = async (runId: string): Promise<WorkerTickEntry | undefined> => (await supervisor.tick()).find((entry) => entry.run_id === runId);

  const assertPublishedOnce = async (runId: string) => {
    const artifacts = (await db.query(`select unit_id, count(*)::int as n from test_parent_artifacts where run_id = $1 group by unit_id order by unit_id`, [runId])).rows;
    assert.deepEqual(artifacts, [{ unit_id: "margin_unit", n: 1 }, { unit_id: "rev_unit", n: 1 }, { unit_id: "screen_unit", n: 1 }], "one artifact per unit");
    const sealedEvents = (await listRunEvents(db, { owner_user_id: IDS.owner, run_id: runId, after_sequence: 0, limit: 200 }))
      .filter((event) => event.event_kind === "unit_sealed").map((event) => event.unit_id).sort();
    assert.deepEqual(sealedEvents, ["margin_unit", "rev_unit", "screen_unit"], "each publication event once");
    const status = await readRunStatus(db, IDS.owner, runId);
    assert.deepEqual([status?.execution_state, status?.coverage_state], ["completed", "partial"]);
  };

  await t.test("a worker that died right after taking its lease is resumed from the start", async () => {
    const { runId } = await leasedRun(db, marginPlan());
    await expire(db, runId);
    evidenceReads = 0;
    const entry = await tickFor(runId);
    assert.deepEqual(entry, { run_id: runId, status: "resumed", execution: "ready_to_seal", published: 3, existing: 0, rejected: 0 });
    assert.equal(evidenceReads, 4, "evidence is read once, by the resumed binding");
    await assertPublishedOnce(runId);
  });

  await t.test("a worker that died after binding and one checkpoint never reselects evidence", async () => {
    const plan = marginPlan();
    const { runId, lease } = await leasedRun(db, plan);
    const { bindings } = await bindPlanInputs({ client: db, lease, plan, authority, evidence: createEvidenceFinancialPort });
    await fencedTransaction(db, lease, (tx) => declareUnits(tx, plan));
    const evaluation = evaluateBoundPlan(plan, bindings);
    await checkpointUnit(db, lease, buildUnitCheckpoint(plan, evaluation, nodeLineageHashes(plan, evaluation, bindings), "rev_unit"));
    await expire(db, runId);
    evidenceReads = 0;
    const entry = await tickFor(runId);
    assert.deepEqual(entry, { run_id: runId, status: "resumed", execution: "ready_to_seal", published: 3, existing: 0, rejected: 0 });
    assert.equal(evidenceReads, 0);
    await assertPublishedOnce(runId);
  });

  await t.test("a worker that died between finalizations keeps what it published and does not notify the parent twice", async () => {
    const { runId, lease } = await readyRun(db, marginPlan());
    assert.equal((await finalizeUnit({ client, lease, authority, unit_id: "rev_unit", snapshot_id: randomUUID(), persistParent })).status, "published");
    await expire(db, runId);
    parentCalls = 0;
    evidenceReads = 0;
    const entry = await tickFor(runId);
    assert.deepEqual(entry, { run_id: runId, status: "resumed", execution: "skipped", published: 2, existing: 1, rejected: 0 });
    assert.equal(parentCalls, 2, "only the units not yet published reach the parent");
    assert.equal(evidenceReads, 0);
    await assertPublishedOnce(runId);
    await assert.rejects(() => finalizeUnit({ client, lease, authority, unit_id: "margin_unit", snapshot_id: randomUUID(), persistParent }), StaleLeaseError, "the dead worker's lease writes nothing");
  });

  await t.test("a finalization interrupted before commit leaves nothing and is completed once", async () => {
    const { runId, lease } = await readyRun(db, marginPlan());
    const crash: PersistParentArtifact = async (tx, publication) => {
      await persistParent(tx, publication);
      throw new Error("connection lost");
    };
    await assert.rejects(() => finalizeUnit({ client, lease, authority, unit_id: "margin_unit", snapshot_id: randomUUID(), persistParent: crash }), /connection lost/);
    await expire(db, runId);
    const entry = await tickFor(runId);
    assert.deepEqual(entry, { run_id: runId, status: "resumed", execution: "skipped", published: 3, existing: 0, rejected: 0 });
    await assertPublishedOnce(runId);
  });

  await t.test("a run whose last finalization committed before the disconnect is already done", async () => {
    const { runId, lease } = await readyRun(db, marginPlan());
    for (const unitId of ["margin_unit", "rev_unit", "screen_unit"]) {
      await finalizeUnit({ client, lease, authority, unit_id: unitId, snapshot_id: randomUUID(), persistParent });
    }
    parentCalls = 0;
    assert.equal(await tickFor(runId), undefined, "a completed run is not recoverable");
    assert.equal(parentCalls, 0);
    await assertPublishedOnce(runId);
  });

  await t.test("a live lease, a Discovery-owned run, and an unregistered parent are left alone", async () => {
    const live = await readyRun(db, marginPlan());
    assert.equal(await tickFor(live.runId), undefined, "a live lease is not taken");

    const discovery = await reserveRun(db, {
      authority: createRuntimeAuthority({ ...authority, parent: { kind: "discovery_run", id: randomUUID(), version: "1" } }),
      request_key: randomUUID(),
      plan: marginPlan(),
    });
    assert.equal(discovery.status, "created");
    const recoverable = await listRecoverableRuns(db, { parent_kinds: ["chat_thread", "discovery_run"], limit: 100 });
    assert.ok(!recoverable.some((run) => run.parent_kind === "discovery_run"), "Discovery runs resume only under their parent's fence");

    const unregistered = createFinancialWorker({ pool, worker_id: "other", ttl_ms: 60_000, evidence: counting, parents: {}, interval_ms: 1_000, max_runs_per_tick: 10 });
    const orphan = await leasedRun(db, marginPlan());
    await expire(db, orphan.runId);
    assert.equal((await unregistered.tick()).find((entry) => entry.run_id === orphan.runId), undefined, "no parent registration, no resumption");
    assert.equal((await tickFor(orphan.runId))?.status, "resumed", "the registered supervisor picks it up");
  });

  await t.test("a cancellation the dead worker never honoured is completed; a new epoch fences the old worker", async () => {
    const { runId, lease } = await leasedRun(db, marginPlan());
    await requestCancellation(db, IDS.owner, runId);
    await expire(db, runId);
    assert.deepEqual(await tickFor(runId), { run_id: runId, status: "cancelled" });
    assert.equal((await readRunStatus(db, IDS.owner, runId))?.execution_state, "cancelled");
    await assert.rejects(() => fencedTransaction(db, lease as RunLease, async () => {}), StaleLeaseError);
  });

  await t.test("a failing parent is isolated and the loop keeps going", async () => {
    const broken: ParentRecovery = { authority: async () => { throw new Error("parent store down"); }, persistParent };
    const worker = createFinancialWorker({ pool, worker_id: "isolated", ttl_ms: 60_000, evidence: counting, parents: { chat_thread: broken }, interval_ms: 1_000, max_runs_per_tick: 10 });
    const first = await leasedRun(db, marginPlan());
    const second = await leasedRun(db, marginPlan());
    await expire(db, first.runId);
    await expire(db, second.runId);
    const entries = await worker.tick();
    for (const runId of [first.runId, second.runId]) {
      assert.deepEqual(entries.find((entry) => entry.run_id === runId), { run_id: runId, status: "error", reason: "Error" });
    }
    const seen: Array<ReadonlyArray<WorkerTickEntry>> = [];
    const supervised = createFinancialWorker({ pool, worker_id: "loop", ttl_ms: 60_000, evidence: counting, parents: { chat_thread: chat }, interval_ms: 100, max_runs_per_tick: 10, onTick: (tick) => seen.push(tick) });
    supervised.start();
    while (!seen.some((tick) => tick.some((entry) => entry.run_id === second.runId))) await new Promise((resolve) => setTimeout(resolve, 50));
    await supervised.stop();
    await assertPublishedOnce(first.runId);
    await assertPublishedOnce(second.runId);
  });

  await t.test("status stays correct when event detail has expired", async () => {
    const { runId } = await leasedRun(db, marginPlan());
    await expire(db, runId);
    await tickFor(runId);
    await db.query(`delete from financial_run_events where run_id = $1`, [runId]);
    const status = await readRunStatus(db, IDS.owner, runId);
    assert.deepEqual([status?.execution_state, status?.coverage_state, status?.units.map((unit) => unit.state)], ["completed", "partial", ["sealed", "sealed", "sealed"]]);
  });
});
