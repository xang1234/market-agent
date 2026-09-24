import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Client } from "pg";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createRuntimeAuthority, type FinancialPlanV1 } from "../../financial-core/src/index.ts";
import { verifyFinancialSeal } from "../../snapshot/src/financial-verifier.ts";
import { buildFinancialSealInput } from "../../snapshot/src/seal-input.ts";
import { sealSnapshot, type SnapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import type { VerifierBlock } from "../../snapshot/src/snapshot-verifier.ts";
import { listRunEvents } from "../src/events-repo.ts";
import { finalizeUnit, type PersistParentArtifact } from "../src/finalize.ts";
import { acquireLease, StaleLeaseError, type RunLease } from "../src/lease.ts";
import { authorityFor, engineDatabase, IDS, marginPlan, pinnedClients, readyRun } from "./db-fixtures.ts";

const authority = authorityFor();

function answerBlock(snapshotId: string, plan: FinancialPlanV1): VerifierBlock {
  const asOf = new Date(plan.time.knowledge_cutoff).toISOString();
  return { id: "answer", kind: "section", snapshot_id: snapshotId, data_ref: { kind: "section", id: "answer" }, source_refs: [], as_of: asOf };
}

/** A parent artifact table the callback writes through the finalization transaction. */
const recordParent: PersistParentArtifact = async (tx, publication) => {
  await tx.client.query(
    `insert into test_parent_artifacts (run_id, unit_id, snapshot_id, certificate_digest, result_count) values ($1, $2, $3, $4, $5)`,
    [publication.run_id, publication.unit_id, publication.snapshot_id, publication.certificate_digest, publication.result_ids.length],
  );
};

async function counts(db: Client, runId: string) {
  const one = async (sql: string) => (await db.query(sql, [runId])).rows[0].n as number;
  return {
    certificates: await one(`select count(*)::int as n from snapshot_financial_runs where run_id = $1`),
    parents: await one(`select count(*)::int as n from test_parent_artifacts where run_id = $1`),
    sealed: await one(`select count(*)::int as n from financial_run_units where run_id = $1 and state = 'sealed'`),
    finalized: await one(`select count(*)::int as n from financial_results where run_id = $1 and state = 'finalized'`),
    snapshots: await one(`select count(*)::int as n from snapshots s join snapshot_financial_runs c on c.snapshot_id = s.snapshot_id where c.run_id = $1`),
  };
}

test("atomic financial finalization", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for finalization coverage");
    return;
  }
  const db = await engineDatabase(t, "fin-finalize");
  await db.query(`create table test_parent_artifacts (run_id uuid, unit_id text, snapshot_id uuid, certificate_digest text, result_count int)`);
  const [client] = await pinnedClients(t, db, 1) as [SnapshotTransactionClient];
  const finalize = (lease: RunLease, plan: FinancialPlanV1, unitId: string, persistParent: PersistParentArtifact = recordParent, auth = authority) => {
    const snapshotId = randomUUID();
    return finalizeUnit({ client, lease, authority: auth, unit_id: unitId, snapshot_id: snapshotId, blocks: [answerBlock(snapshotId, plan)], persistParent });
  };

  await t.test("publishes the snapshot, certificate, sealed unit, finalized results, event, and parent artifact together", async () => {
    const plan = marginPlan();
    const { runId, lease } = await readyRun(db, plan);
    const published = await finalize(lease, plan, "margin_unit");
    assert.equal(published.status, "published", JSON.stringify(published));
    if (published.status !== "published") return;
    assert.equal(published.run_completed, false);

    const certificate = (await db.query(`select certificate, certificate_digest, result_ids from snapshot_financial_runs where snapshot_id = $1`, [published.publication.snapshot_id])).rows[0];
    assert.equal(certificate.certificate_digest, published.publication.certificate_digest);
    assert.equal(certificate.certificate.unit.unit_id, "margin_unit");
    const unit = (await db.query(`select state, snapshot_id::text, certificate_digest from financial_run_units where run_id = $1 and unit_id = 'margin_unit'`, [runId])).rows[0];
    assert.deepEqual(unit, { state: "sealed", snapshot_id: published.publication.snapshot_id, certificate_digest: published.publication.certificate_digest });
    const results = (await db.query(`select output_id, state, disposition from financial_results where run_id = $1 and unit_id = 'margin_unit' order by output_id`, [runId])).rows;
    assert.deepEqual(results, [
      { output_id: "out_gm", state: "finalized", disposition: "verified" },
      { output_id: "out_gm22", state: "finalized", disposition: "blocked_dependency" },
    ]);
    const parent = (await db.query(`select snapshot_id::text, result_count from test_parent_artifacts where run_id = $1`, [runId])).rows;
    assert.deepEqual(parent, [{ snapshot_id: published.publication.snapshot_id, result_count: 2 }]);
    const events = await listRunEvents(db, { owner_user_id: IDS.owner, run_id: runId, after_sequence: 0, limit: 100 });
    assert.deepEqual(events.filter((event) => event.event_kind === "unit_sealed").map((event) => [event.unit_id, event.payload]), [
      ["margin_unit", { certificate_digest: published.publication.certificate_digest }],
    ]);

    assert.equal((await finalize(lease, plan, "rev_unit")).status, "published");
    const last = await finalize(lease, plan, "screen_unit");
    assert.ok(last.status === "published" && last.run_completed, "sealing the last unit completes the run");
    const run = (await db.query(`select execution_state, coverage_state, lease_owner from financial_runs where run_id = $1`, [runId])).rows[0];
    assert.deepEqual(run, { execution_state: "completed", coverage_state: "partial", lease_owner: null });
  });

  await t.test("an identical retry returns the existing artifact without publishing again", async () => {
    const plan = marginPlan();
    const { runId, lease } = await readyRun(db, plan);
    const first = await finalize(lease, plan, "rev_unit");
    assert.equal(first.status, "published");
    const retry = await finalize(lease, plan, "rev_unit");
    assert.equal(retry.status, "existing");
    assert.ok(first.status === "published" && retry.status === "existing");
    assert.equal(retry.publication.snapshot_id, first.publication.snapshot_id);
    assert.deepEqual(await counts(db, runId), { certificates: 1, parents: 1, sealed: 1, finalized: 2, snapshots: 1 });
  });

  await t.test("a failure after the snapshot insert rolls everything back", async () => {
    const plan = marginPlan();
    const { runId, lease } = await readyRun(db, plan);
    const failingParent: PersistParentArtifact = async (tx, publication) => {
      await recordParent(tx, publication);
      throw new Error("parent store unavailable");
    };
    await assert.rejects(() => finalize(lease, plan, "margin_unit", failingParent), /parent store unavailable/);
    assert.deepEqual(await counts(db, runId), { certificates: 0, parents: 0, sealed: 0, finalized: 0, snapshots: 0 });
    const events = await listRunEvents(db, { owner_user_id: IDS.owner, run_id: runId, after_sequence: 0, limit: 100 });
    assert.equal(events.filter((event) => event.event_kind === "unit_sealed").length, 0);
    assert.equal((await finalize(lease, plan, "margin_unit")).status, "published", "the unit is still publishable afterwards");
  });

  await t.test("a result that passed an earlier outside check fails the authoritative in-transaction reload", async () => {
    const plan = marginPlan();
    const { runId, lease } = await readyRun(db, plan);
    const facts = (await db.query(`select distinct f.fact_id::text, f.source_id::text from financial_run_inputs i join facts f on f.fact_id = i.fact_id where i.run_id = $1 and i.input_slot in ('a_rev', 'a_gp')`, [runId])).rows;
    const outside = await verifyFinancialSeal(db, { owner_user_id: IDS.owner, run_id: runId, unit_id: "screen_unit" }, {
      snapshot_id: randomUUID(),
      manifest: { fact_refs: facts.map((fact) => fact.fact_id), source_ids: [...new Set(facts.map((fact) => fact.source_id))], as_of: new Date(plan.time.knowledge_cutoff).toISOString() },
    });
    assert.ok(outside.ok, "the untampered unit passes outside the transaction");

    await db.query("begin");
    await db.query("set local session_replication_role = replica");
    await db.query(`update financial_results set payload = jsonb_set(payload, '{outcome}', 'true') where run_id = $1 and output_id = 'out_check'`, [runId]);
    await db.query("commit");

    const outcome = await finalize(lease, plan, "screen_unit");
    assert.equal(outcome.status, "rejected");
    assert.ok(outcome.status === "rejected" && outcome.reason_code === "verification_failed");
    assert.ok(outcome.status === "rejected" && outcome.failures.some((failure) => failure.reason_code === "financial_recompute_mismatch"));
    assert.deepEqual(await counts(db, runId), { certificates: 0, parents: 0, sealed: 0, finalized: 0, snapshots: 0 });
  });

  await t.test("a stale parent version or a superseded lease cannot publish", async () => {
    const plan = marginPlan();
    const { runId, lease } = await readyRun(db, plan);
    const newerParent = createRuntimeAuthority({ ...authority, parent: { ...authority.parent, version: "2" } });
    const stale = await finalize(lease, plan, "rev_unit", recordParent, newerParent);
    assert.deepEqual(stale.status === "rejected" && stale.reason_code, "parent_version_mismatch");

    await db.query(`update financial_runs set lease_expires_at = now() - interval '1 second' where run_id = $1`, [runId]);
    const takeover = await acquireLease(db, { authority, run_id: runId, worker_id: "worker-2", ttl_ms: 60_000 });
    assert.equal(takeover.status, "acquired");
    await assert.rejects(() => finalize(lease, plan, "rev_unit"), StaleLeaseError);
    assert.deepEqual(await counts(db, runId), { certificates: 0, parents: 0, sealed: 0, finalized: 0, snapshots: 0 });
  });

  await t.test("a certificate can only be committed by the finalization that seals its unit", async () => {
    const plan = marginPlan();
    const { runId } = await readyRun(db, plan);
    const facts = (await db.query(`select distinct f.fact_id::text, f.source_id::text, f.unit, f.period_kind::text, f.period_start::text, f.period_end::text, f.fiscal_year, f.fiscal_period
        from financial_run_inputs i join facts f on f.fact_id = i.fact_id where i.run_id = $1 and i.input_slot in ('a_rev', 'a_rev22') order by f.fact_id::text`, [runId])).rows;
    const snapshotId = randomUUID();
    const seal = buildFinancialSealInput({
      snapshot_id: snapshotId,
      claim: { owner_user_id: IDS.owner, run_id: runId, unit_id: "rev_unit" },
      knowledgeCutoff: new Date(plan.time.knowledge_cutoff).toISOString(),
      subjectRefs: [{ kind: "issuer", id: IDS.issuerA }],
      blocks: [answerBlock(snapshotId, plan)],
      boundFacts: facts,
    });
    await assert.rejects(() => sealSnapshot(client, seal), /does not match a sealed unit/);
    assert.deepEqual(await counts(db, runId), { certificates: 0, parents: 0, sealed: 0, finalized: 0, snapshots: 0 });
  });
});
