// Publication versus revocation, cancellation, and a concurrent duplicate,
// each forced into a specific interleaving with lock-waiter barriers.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Client } from "pg";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { listFinancialInputCandidates } from "../../evidence/src/financial-input-repo.ts";
import type { FinancialPlanV1 } from "../../financial-core/src/index.ts";
import type { SnapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { finalizeUnit, type PersistParentArtifact } from "../src/finalize.ts";
import { StaleLeaseError, type RunLease } from "../src/lease.ts";
import { requestCancellation } from "../src/run-repo.ts";
import { authorityFor, connectExtraClient, engineDatabase, IDS, marginPlan, pinnedClients, readyRun, waitForLockWaiters } from "./db-fixtures.ts";

const authority = authorityFor();
const noParent: PersistParentArtifact = async () => {};

function finalizeWith(client: SnapshotTransactionClient, lease: RunLease, plan: FinancialPlanV1, unitId: string, persistParent: PersistParentArtifact = noParent) {
  const snapshotId = randomUUID();
  const asOf = new Date(plan.time.knowledge_cutoff).toISOString();
  return finalizeUnit({
    client,
    lease,
    authority,
    unit_id: unitId,
    snapshot_id: snapshotId,
    blocks: [{ id: "answer", kind: "section", snapshot_id: snapshotId, data_ref: { kind: "section", id: "answer" }, source_refs: [], as_of: asOf }],
    persistParent,
  });
}

/** A parent callback that parks inside the finalization transaction until released. */
function parkedParent() {
  let reached!: () => void;
  let release!: () => void;
  const inside = new Promise<void>((resolve) => { reached = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const persist: PersistParentArtifact = async () => {
    reached();
    await gate;
  };
  return { persist, inside, release };
}

async function certificates(db: Client, runId: string): Promise<number> {
  return (await db.query(`select count(*)::int as n from snapshot_financial_runs where run_id = $1`, [runId])).rows[0].n;
}

test("finalization races", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for finalization race coverage");
    return;
  }
  const db = await engineDatabase(t, "fin-races");
  const [publisher, second] = await pinnedClients(t, db, 2) as [SnapshotTransactionClient, SnapshotTransactionClient];
  const revoker = await connectExtraClient(t, db);
  const restore = () => db.query(`update facts set invalidated_at = null where fact_id = $1`, [IDS.original]);

  await t.test("a revocation committed before finalization wins", async () => {
    const plan = marginPlan();
    const { runId, lease } = await readyRun(db, plan);
    await revoker.query(`update facts set invalidated_at = now() where fact_id = $1`, [IDS.original]);
    const outcome = await finalizeWith(publisher, lease, plan, "screen_unit");
    await restore();
    assert.ok(outcome.status === "rejected" && outcome.reason_code === "verification_failed", JSON.stringify(outcome));
    assert.ok(outcome.status === "rejected" && outcome.failures.some((failure) => failure.details.reason === "fact_invalidated"));
    assert.equal(await certificates(db, runId), 0);
  });

  await t.test("a revocation in flight blocks finalization, which then sees it and rejects", async () => {
    const plan = marginPlan();
    const { runId, lease } = await readyRun(db, plan);
    await revoker.query("begin");
    await revoker.query(`update facts set invalidated_at = now() where fact_id = $1`, [IDS.original]);
    const pending = finalizeWith(publisher, lease, plan, "screen_unit");
    await waitForLockWaiters(db, 1);
    await revoker.query("commit");
    const outcome = await pending;
    await restore();
    assert.ok(outcome.status === "rejected" && outcome.failures.some((failure) => failure.details.reason === "fact_invalidated"), JSON.stringify(outcome));
    assert.equal(await certificates(db, runId), 0);
  });

  await t.test("a revocation during finalization waits for its commit and then hides the evidence from later reads", async () => {
    const plan = marginPlan();
    const { runId, lease } = await readyRun(db, plan);
    const parked = parkedParent();
    const pending = finalizeWith(publisher, lease, plan, "screen_unit", parked.persist);
    await parked.inside;
    const revocation = revoker.query(`update facts set invalidated_at = now() where fact_id = $1`, [IDS.original]);
    await waitForLockWaiters(db, 1);
    parked.release();
    const outcome = await pending;
    await revocation;
    assert.equal(outcome.status, "published", "the publication committed first");
    assert.equal(await certificates(db, runId), 1);

    const candidates = await listFinancialInputCandidates(db, {
      user_id: IDS.owner, channel: "app", scope: "public_information", subject: { kind: "issuer", id: IDS.issuerA },
      metric_key: "revenue", fiscal_year: 2023, fiscal_period: "FY", limit: 10,
    });
    assert.ok(!candidates.candidates.some((candidate) => candidate.fact_id === IDS.original), "later reads no longer see the revoked fact");
    const next = await finalizeWith(publisher, lease, plan, "rev_unit");
    assert.ok(next.status === "rejected" && next.failures.some((failure) => failure.details.reason === "fact_invalidated"), "later units cannot certify it either");
    await restore();
  });

  await t.test("cancellation fences finalization out, whichever commits first", async () => {
    const before = marginPlan();
    const early = await readyRun(db, before);
    await requestCancellation(db, IDS.owner, early.runId);
    await assert.rejects(() => finalizeWith(publisher, early.lease, before, "rev_unit"), (error: unknown) => error instanceof StaleLeaseError && error.reason === "cancel_requested");
    assert.equal(await certificates(db, early.runId), 0);

    const during = marginPlan();
    const late = await readyRun(db, during);
    const parked = parkedParent();
    const pending = finalizeWith(publisher, late.lease, during, "rev_unit", parked.persist);
    await parked.inside;
    const cancellation = requestCancellation(revoker, IDS.owner, late.runId);
    await waitForLockWaiters(db, 1);
    parked.release();
    assert.equal((await pending).status, "published");
    assert.equal((await cancellation)?.cancel_requested_at !== null, true);
    await assert.rejects(() => finalizeWith(publisher, late.lease, during, "margin_unit"), (error: unknown) => error instanceof StaleLeaseError && error.reason === "cancel_requested");
    assert.equal(await certificates(db, late.runId), 1, "only the unit finalized before cancellation is published");
  });

  await t.test("two concurrent identical finalizations publish once", async () => {
    const plan = marginPlan();
    const { runId, lease } = await readyRun(db, plan);
    const parked = parkedParent();
    const first = finalizeWith(publisher, lease, plan, "rev_unit", parked.persist);
    await parked.inside;
    const duplicate = finalizeWith(second, lease, plan, "rev_unit");
    await waitForLockWaiters(db, 1);
    parked.release();
    const [winner, loser] = await Promise.all([first, duplicate]);
    assert.equal(winner.status, "published");
    assert.equal(loser.status, "existing");
    assert.ok(winner.status === "published" && loser.status === "existing" && loser.publication.snapshot_id === winner.publication.snapshot_id);
    assert.equal(await certificates(db, runId), 1);
  });
});
