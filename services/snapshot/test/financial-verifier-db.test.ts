import assert from "node:assert/strict";
import test from "node:test";
import type { Client, PoolClient } from "pg";
import { connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { recordFactPrecisionAttestation } from "../../evidence/src/financial-attestations.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { executeRun } from "../../financial-engine/src/execute.ts";
import { authorityFor, databaseUrl, engineDatabase, IDS, leasedRun, marginPlan } from "../../financial-engine/test/db-fixtures.ts";
import { loadUnitBoundFacts } from "../src/financial-verifier-loader.ts";
import { verifyFinancialSeal } from "../src/financial-verifier.ts";
import { buildFinancialSealInput } from "../src/seal-input.ts";
import { sealSnapshotInTransaction, snapshotTransactionClient } from "../src/snapshot-sealer.ts";

const SNAPSHOT = "6f000000-0000-4000-8000-0000000000f1";

/** Runs `action` in a transaction that is always rolled back, so each test's tampering is isolated. */
async function inRolledBack<T>(db: Client, action: () => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    return await action();
  } finally {
    await db.query("rollback");
  }
}

test("financial verification against ledger records", { timeout: 240_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for financial verifier coverage");
    return;
  }
  const db = await engineDatabase(t, "snap-financial");
  const plan = marginPlan();
  const { runId, lease } = await leasedRun(db, plan);
  const report = await executeRun({ client: db, lease, plan, authority: authorityFor(), evidence: createEvidenceFinancialPort, parent_limits: {} });
  assert.equal(report.outcome, "ready_to_seal");
  const cutoff = new Date(plan.time.knowledge_cutoff).toISOString();

  const verify = async (unitId: string, owner: string = IDS.owner) => {
    const facts = await loadUnitBoundFacts(db, runId, unitId);
    return verifyFinancialSeal(db, { owner_user_id: owner, run_id: runId, unit_id: unitId }, {
      snapshot_id: SNAPSHOT,
      manifest: { fact_refs: facts.map((fact) => fact.fact_id), source_ids: [...new Set(facts.map((fact) => fact.source_id))], as_of: cutoff },
    });
  };
  const reasons = (outcome: Awaited<ReturnType<typeof verify>>) =>
    outcome.ok ? [] : outcome.failures.map((failure) => `${failure.reason_code}:${String(failure.details.reason ?? failure.details.field ?? "")}`);

  await t.test("every computed unit of an executed run verifies from its records", async () => {
    for (const unitId of ["rev_unit", "margin_unit", "screen_unit"]) {
      const outcome = await inRolledBack(db, () => verify(unitId));
      assert.ok(outcome.ok, `${unitId}: ${JSON.stringify(!outcome.ok && outcome.failures)}`);
    }
  });

  await t.test("another owner cannot learn the run exists", async () => {
    assert.deepEqual(reasons(await inRolledBack(db, () => verify("rev_unit", IDS.other))), ["financial_run_not_found:"]);
  });

  await t.test("a stored value tampered around the immutability guard fails recomputation", async () => {
    const outcome = await inRolledBack(db, async () => {
      await db.query("set local session_replication_role = replica");
      await db.query(`update financial_results set payload = jsonb_set(payload, '{value}', '"0.5"') where run_id = $1 and output_id = 'out_gm'`, [runId]);
      await db.query("set local session_replication_role = origin");
      return verify("margin_unit");
    });
    assert.deepEqual(reasons(outcome), ["financial_recompute_mismatch:payload"]);
  });

  await t.test("an invalidated input rejects only the units whose closure uses it", async () => {
    const outcomes = await inRolledBack(db, async () => {
      await db.query(`update facts set invalidated_at = now() where fact_id = $1`, [IDS.fy2022]);
      return { rev: await verify("rev_unit"), margin: await verify("margin_unit"), screen: await verify("screen_unit") };
    });
    assert.deepEqual(reasons(outcomes.rev), ["financial_input_ineligible:fact_invalidated"]);
    assert.deepEqual(reasons(outcomes.margin), ["financial_input_ineligible:fact_invalidated"]);
    assert.ok(outcomes.screen.ok, "the screen's closure never used FY2022 revenue");
  });

  await t.test("a revoked source or a superseded precision proof blocks publication", async () => {
    const privateSource = await inRolledBack(db, async () => {
      await db.query(`update sources set user_id = $2 where source_id = $1`, [IDS.sourceV1, IDS.owner]);
      return verify("rev_unit");
    });
    assert.ok(reasons(privateSource).includes("financial_input_ineligible:source_not_public"), JSON.stringify(reasons(privateSource)));

    const superseded = await inRolledBack(db, async () => {
      await recordFactPrecisionAttestation(db, { fact_id: IDS.original, precision_class: "legacy_unverified", validation_method: "test" });
      return verify("rev_unit");
    });
    assert.deepEqual(reasons(superseded), ["financial_input_ineligible:precision_proof_superseded"]);
  });

  await t.test("sealing in the transaction certifies the unit; the same seal fails once a value is wrong", async () => {
    const pool = await connectedPool(t, databaseUrl(db));
    const client = snapshotTransactionClient(await pool.connect());
    try {
      const facts = await loadUnitBoundFacts(client, runId, "margin_unit");
      const claim = { owner_user_id: IDS.owner, run_id: runId, unit_id: "margin_unit" };
      const seal = buildFinancialSealInput({
        snapshot_id: SNAPSHOT,
        claim,
        knowledgeCutoff: cutoff,
        subjectRefs: [{ kind: "issuer", id: IDS.issuerA }],
        boundFacts: facts,
      });

      await client.query("begin");
      const sealed = await sealSnapshotInTransaction(client, seal);
      await client.query("rollback");
      assert.ok(sealed.ok, JSON.stringify(sealed.verification.failures));
      assert.equal(sealed.verification.financial?.certificate.unit.unit_id, "margin_unit");
      assert.equal(sealed.verification.financial?.certificate.snapshot_id, SNAPSHOT);
      assert.deepEqual(seal.blocks, [], "the caller supplies no blocks");
      const block = sealed.verification.financial!.block;
      assert.equal(block.kind, "financial_answer");
      assert.equal(block.snapshot_id, SNAPSHOT);
      assert.deepEqual(sealed.verification.financial?.certificate.presentation, { version: "financial-presentation.v1", hash: block.presentation_hash });
      assert.equal(block.financial.labels["subject:a"]?.text, "Alpha Industries Inc.");

      const narrative = { id: "note", kind: "rich_text", snapshot_id: SNAPSHOT, data_ref: { kind: "rich_text", id: "note" }, source_refs: [], as_of: cutoff, segments: [{ type: "text", text: "Margins doubled." }] };
      for (const [label, blocks, expected] of [
        ["a caller-supplied answer", [structuredClone(block)], ["invalid_block_binding", "financial_seal_blocks"]],
        ["a narrative riding along", [narrative], ["financial_seal_blocks"]],
      ] as const) {
        await client.query("begin");
        const outcome = await sealSnapshotInTransaction(client, { ...seal, blocks: blocks as never });
        await client.query("rollback");
        assert.deepEqual(outcome.verification.failures.map((failure) => failure.reason_code), expected, label);
      }

      await client.query("begin");
      await client.query("set local session_replication_role = replica");
      await client.query(`update financial_results set payload = jsonb_set(payload, '{value}', '"0.5"') where run_id = $1 and output_id = 'out_gm'`, [runId]);
      await client.query("set local session_replication_role = origin");
      const rejected = await sealSnapshotInTransaction(client, seal);
      const snapshots = (await client.query(`select count(*)::int as n from snapshots where snapshot_id = $1`, [SNAPSHOT])).rows[0].n;
      const logged = (await client.query(`select reason_code from verifier_fail_logs where snapshot_id = $1`, [SNAPSHOT])).rows.map((row) => row.reason_code);
      await client.query("rollback");
      assert.equal(rejected.ok, false);
      assert.deepEqual(rejected.verification.failures.map((failure) => failure.reason_code), ["financial_recompute_mismatch"]);
      assert.equal(snapshots, 0, "nothing is sealed");
      assert.deepEqual(logged, ["financial_recompute_mismatch"], "the failure is logged with a sanitized reason");
    } finally {
      client.release();
    }
  });

  await t.test("a financial claim without a transaction client cannot pass", async () => {
    const { verifySnapshotSeal } = await import("../src/snapshot-verifier.ts");
    const outcome = await verifySnapshotSeal({
      snapshot_id: SNAPSHOT,
      manifest: { subject_refs: [{ kind: "issuer", id: IDS.issuerA }], fact_refs: [], claim_refs: [], event_refs: [], document_refs: [], source_ids: [], as_of: cutoff, basis: "unadjusted", normalization: "raw" },
      blocks: [],
      financial: { owner_user_id: IDS.owner, run_id: runId, unit_id: "rev_unit" },
    });
    assert.deepEqual(outcome.failures.map((failure) => failure.reason_code), ["financial_verification_unavailable"]);
  });

  await t.test("a financial_answer block outside a financial seal is an unknown kind", async () => {
    const { verifySnapshotSeal } = await import("../src/snapshot-verifier.ts");
    const certified = await inRolledBack(db, () => verify("rev_unit"));
    assert.ok(certified.ok);
    const outcome = await verifySnapshotSeal({
      snapshot_id: SNAPSHOT,
      manifest: { subject_refs: [{ kind: "issuer", id: IDS.issuerA }], fact_refs: [], claim_refs: [], event_refs: [], document_refs: [], source_ids: [...certified.block.source_refs], as_of: cutoff, basis: "unadjusted", normalization: "raw" },
      blocks: [structuredClone(certified.block) as never],
    });
    assert.ok(outcome.failures.some((failure) => failure.reason_code === "invalid_block_binding" && failure.details.reason === "unknown_block_kind"), JSON.stringify(outcome.failures));
  });
});
