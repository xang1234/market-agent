import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Client } from "pg";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createRuntimeAuthority } from "../../financial-core/src/index.ts";
import { appendRunEvent, listRunEvents, UnsafeEventPayloadError } from "../src/events-repo.ts";
import { ExecutionIntegrityError } from "../src/errors.ts";
import { acquireLease, fencedTransaction, renewLease, StaleLeaseError, type FencedTx, type RunLease } from "../src/lease.ts";
import { requestCancellation, reserveRun, RunTransitionError, transitionRun } from "../src/run-repo.ts";
import { declareUnits, listUnits, markUnitComputed, rejectUnit } from "../src/unit-repo.ts";
import { authorityFor, engineDatabase, IDS, revenuePlan } from "./db-fixtures.ts";

function fenced<T>(db: Client, lease: RunLease, action: (tx: FencedTx) => Promise<T>, allowCancelRequested = false): Promise<T> {
  return fencedTransaction(db, lease, action, { allowCancelRequested });
}

async function newRun(db: Client, authority = authorityFor(), plan = revenuePlan()) {
  const result = await reserveRun(db, { authority, request_key: randomUUID(), plan });
  assert.ok(result.status === "created");
  return { run: (result as { run: { run_id: string } }).run, plan, authority };
}

async function expireLease(db: Client, runId: string): Promise<void> {
  await db.query(`update financial_runs set lease_expires_at = now() - interval '1 second' where run_id = $1`, [runId]);
}

test("financial run leases, lifecycle, units, and events", { timeout: 240_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for lease coverage");
    return;
  }
  const db = await engineDatabase(t, "fin-lease");

  await t.test("leases are exclusive, expire, and fence stale workers out with a higher epoch", async () => {
    const { run, plan, authority } = await newRun(db);
    const first = await acquireLease(db, { authority, run_id: run.run_id, worker_id: "worker-1", ttl_ms: 60_000 });
    assert.ok(first.status === "acquired");
    if (first.status !== "acquired") return;
    assert.equal(first.lease.epoch, 1);
    assert.equal(first.run.execution_state, "running");
    assert.equal((await acquireLease(db, { authority, run_id: run.run_id, worker_id: "worker-2", ttl_ms: 60_000 })).status, "busy");

    await fenced(db, first.lease, (tx) => declareUnits(tx, plan));
    await expireLease(db, run.run_id);
    const second = await acquireLease(db, { authority, run_id: run.run_id, worker_id: "worker-2", ttl_ms: 60_000 });
    assert.ok(second.status === "acquired" && second.lease.epoch === 2);

    await assert.rejects(() => fenced(db, first.lease, async () => {}), StaleLeaseError);
    await assert.rejects(() => fenced(db, first.lease, (tx) => markUnitComputed(tx, "a_unit", "complete")), StaleLeaseError);
    await assert.rejects(() => renewLease(db, first.lease, 60_000), StaleLeaseError);
    const kinds = (await listRunEvents(db, { owner_user_id: IDS.owner, run_id: run.run_id, after_sequence: 0, limit: 50 })).map((event) => event.event_kind);
    assert.deepEqual(kinds, ["run_created", "lease_acquired", "lease_expired", "lease_acquired"]);
  });

  await t.test("lifecycle transitions are validated, and terminal runs release their lease", async () => {
    const { run, authority } = await newRun(db);
    const acquired = await acquireLease(db, { authority, run_id: run.run_id, worker_id: "worker-1", ttl_ms: 60_000 });
    assert.ok(acquired.status === "acquired");
    const lease = (acquired as { lease: RunLease }).lease;
    await assert.rejects(() => fenced(db, lease, (tx) => transitionRun(tx, "completed", { coverage_state: "complete" })), RunTransitionError);
    await assert.rejects(() => fenced(db, lease, (tx) => transitionRun(tx, "failed")), /failure code/);
    await fenced(db, lease, (tx) => transitionRun(tx, "ready_to_seal"));
    await assert.rejects(() => fenced(db, lease, (tx) => transitionRun(tx, "completed")), /coverage/);
    const completed = await fenced(db, lease, (tx) => transitionRun(tx, "completed", { coverage_state: "partial" }));
    assert.deepEqual([completed.execution_state, completed.coverage_state, completed.lease_owner], ["completed", "partial", null]);
    assert.equal((await acquireLease(db, { authority, run_id: run.run_id, worker_id: "worker-9", ttl_ms: 60_000 })).status, "terminal");
    await assert.rejects(() => fenced(db, lease, async () => {}), /terminal/);
  });

  await t.test("cancellation wins over workers: at once without a lease, at the next fence with one", async () => {
    const idle = await newRun(db);
    const cancelled = await requestCancellation(db, IDS.owner, idle.run.run_id);
    assert.equal(cancelled?.execution_state, "cancelled");
    assert.equal((await acquireLease(db, { authority: idle.authority, run_id: idle.run.run_id, worker_id: "w", ttl_ms: 60_000 })).status, "terminal");
    assert.equal(await requestCancellation(db, IDS.other, idle.run.run_id), null, "another owner cannot cancel or see it");

    const busy = await newRun(db);
    const acquired = await acquireLease(db, { authority: busy.authority, run_id: busy.run.run_id, worker_id: "worker-1", ttl_ms: 60_000 });
    const lease = (acquired as { lease: RunLease }).lease;
    const requested = await requestCancellation(db, IDS.owner, busy.run.run_id);
    assert.equal(requested?.execution_state, "running");
    assert.ok(requested?.cancel_requested_at);
    await assert.rejects(() => fenced(db, lease, async () => {}), /cancel_requested/);
    await assert.rejects(() => fenced(db, lease, (tx) => transitionRun(tx, "ready_to_seal"), true), /cancel_requested/, "only cancel or fail honour a pending cancellation");
    const final = await fenced(db, lease, (tx) => transitionRun(tx, "cancelled"), true);
    assert.equal(final.execution_state, "cancelled");
  });

  await t.test("a Discovery child run is leased only under its parent's fenced authority", async () => {
    const parentId = "4f000000-0000-4000-8000-00000000d15c";
    const base = authorityFor();
    const discovery = createRuntimeAuthority({ ...base, egress_channel: "discovery", parent: { kind: "discovery_run", id: parentId, version: "1" }, feature: { ...base.feature, surface: "discovery" } });
    const { run } = await newRun(db, discovery);
    assert.equal((await acquireLease(db, { authority: discovery, run_id: run.run_id, worker_id: "generic", ttl_ms: 60_000 })).status, "parent_authority_required");
    const fenced = createRuntimeAuthority({ ...discovery, lease: { epoch: 7, fence_token: "campaign-worker-7" } });
    assert.equal((await acquireLease(db, { authority: fenced, run_id: run.run_id, worker_id: "campaign-worker", ttl_ms: 60_000 })).status, "acquired");
  });

  await t.test("units are declared once, progress is idempotent, and rejection is final", async () => {
    const { run, plan, authority } = await newRun(db, authorityFor(), revenuePlan({ subjects: ["a", "b"] }));
    const lease = ((await acquireLease(db, { authority, run_id: run.run_id, worker_id: "w", ttl_ms: 60_000 })) as { lease: RunLease }).lease;
    await fenced(db, lease, (tx) => declareUnits(tx, plan));
    await fenced(db, lease, (tx) => declareUnits(tx, plan));
    assert.deepEqual((await listUnits(db, run.run_id)).map((unit) => [unit.unit_id, unit.state]), [["a_unit", "pending"], ["b_unit", "pending"]]);

    const narrowed = JSON.parse(JSON.stringify(plan));
    narrowed.outputs = narrowed.outputs.filter((output: { output_id: string }) => output.output_id !== "a_out_prev");
    await assert.rejects(() => fenced(db, lease, (tx) => declareUnits(tx, narrowed)), ExecutionIntegrityError);

    assert.equal(await fenced(db, lease, (tx) => markUnitComputed(tx, "a_unit", "complete")), true);
    assert.equal(await fenced(db, lease, (tx) => markUnitComputed(tx, "a_unit", "complete")), false);
    assert.equal(await fenced(db, lease, (tx) => rejectUnit(tx, "b_unit", "integrity_failure")), true);
    assert.equal(await fenced(db, lease, (tx) => markUnitComputed(tx, "b_unit", "complete")), false);
    const events = await listRunEvents(db, { owner_user_id: IDS.owner, run_id: run.run_id, after_sequence: 0, limit: 50 });
    assert.equal(events.filter((event) => event.event_kind === "unit_computed").length, 1);
    assert.equal(events.filter((event) => event.event_kind === "unit_rejected").length, 1);
  });

  await t.test("event payloads carry identifiers and codes only; reads are owner-scoped with cursors", async () => {
    const { run } = await newRun(db);
    await assert.rejects(() => appendRunEvent(db, run.run_id, "unit_computed", { payload: { value: "383285000000.12" } as never }), UnsafeEventPayloadError);
    await assert.rejects(() => appendRunEvent(db, run.run_id, "run_failed", { payload: { reason_code: "revenue was 383bn" } }), UnsafeEventPayloadError);
    await assert.rejects(() => appendRunEvent(db, run.run_id, "unit_computed", { payload: { bound_count: 1.5 } }), UnsafeEventPayloadError);
    await appendRunEvent(db, run.run_id, "inputs_bound", { payload: { bound_count: 2, gap_count: 0 } });
    const page = await listRunEvents(db, { owner_user_id: IDS.owner, run_id: run.run_id, after_sequence: 1, limit: 10 });
    assert.deepEqual(page.map((event) => [event.sequence, event.event_kind, event.payload]), [[2, "inputs_bound", { bound_count: 2, gap_count: 0 }]]);
    assert.deepEqual(await listRunEvents(db, { owner_user_id: IDS.other, run_id: run.run_id, after_sequence: 0, limit: 10 }), []);
  });
});
