import assert from "node:assert/strict";
import test from "node:test";
import type { Client } from "pg";
import { dockerAvailable } from "./docker-pg.ts";
import {
  applyFinancialMigrations,
  applyFrozenBase,
  applyMigration,
  catalogSnapshot,
  createDatabase,
  expectRejected,
  IDS,
  seedLegacyEvidence,
  startServer,
} from "./financial-migration-helpers.ts";

const HASH = "a".repeat(64);
const DIGEST = "d".repeat(64);
const LEGACY_COMPUTATION = "0f000000-0000-4000-8000-000000000101";
const LEGACY_SNAPSHOT = "0f000000-0000-4000-8000-000000000201";
const PLAN_ID = "0f000000-0000-4000-8000-0000000000e1";

async function seedLegacyPublication(db: Client): Promise<void> {
  await db.query(`
    insert into computations (computation_id, formula_id, code_version, input_refs, output_ref)
      values ('${LEGACY_COMPUTATION}', 'gross_margin', 'legacy.1', '[{"kind":"fact"}]', '{"kind":"fact"}');
    insert into snapshots (snapshot_id, subject_refs, as_of, basis, normalization, allowed_transforms)
      values ('${LEGACY_SNAPSHOT}', '[]', '2024-01-15T00:00:00Z', 'as_reported', 'none', '{}');
  `);
}

async function newRun(db: Client, requestKey: string): Promise<string> {
  const runId = (await db.query(
    `insert into financial_runs (user_id, parent_kind, parent_id, parent_version, request_key, request_hash, plan_id, feature_mode, knowledge_cutoff, policies)
     values ($1, 'chat_thread', $2, '1', $3, $4, $5, 'shadow', '2024-01-15T00:00:00Z', '{}') returning run_id`,
    [IDS.owner, "0f000000-0000-4000-8000-0000000000f1", requestKey, HASH, PLAN_ID],
  )).rows[0].run_id;
  await db.query(
    `insert into financial_run_units (run_id, unit_id, unit_kind, output_ids, closure_node_ids, closure_hash)
     values ($1, 'section', 'chat_section', '["out_gm"]', '["gm"]', $2)`,
    [runId, HASH],
  );
  return runId;
}

async function newSnapshot(db: Client): Promise<string> {
  return (await db.query(
    `insert into snapshots (subject_refs, as_of, basis, normalization, allowed_transforms)
     values ('[]', '2024-01-15T00:00:00Z', 'as_reported', 'none', '{}') returning snapshot_id`,
  )).rows[0].snapshot_id;
}

function insertComputation(runId: string, nodeId: string, extra = "") {
  return `insert into computations (formula_id, code_version, input_refs, output_ref, financial_run_id, node_id, operation_version,
                                    numeric_policy_version, definition_versions, output_hash${extra ? ", " + extra.split("=")[0] : ""})
          values ('gross_margin', 'financial-core.v1', '[]', '{}', '${runId}', '${nodeId}', 'gross_margin.v1', 'numeric-policy.v1',
                  '{"gross_profit":"gross_profit.v1"}', '${HASH}'${extra ? ", " + extra.split("=")[1] : ""}) returning computation_id`;
}

function insertResult(runId: string, outputId: string, computationId: string | null, state = "draft", disposition = "computed") {
  return `insert into financial_results (run_id, output_id, node_id, unit_id, computation_id, state, disposition, payload, dependencies, result_hash, finalized_at)
          values ('${runId}', '${outputId}', 'gm', 'section', ${computationId ? `'${computationId}'` : "null"}, '${state}', '${disposition}',
                  '{"kind":"value","value":"0.44"}', '["gp","rev"]', '${HASH}', ${state === "finalized" ? "now()" : "null"}) returning result_id`;
}

test("0048 financial publication lineage", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for financial migration coverage");
    return;
  }
  const server = await startServer(t, "fin-publication-0048");
  const db = await createDatabase(t, server, "publication_0048");
  await applyFrozenBase(db);
  await seedLegacyEvidence(db);
  await seedLegacyPublication(db);
  await applyFinancialMigrations(db);
  await db.query(
    `insert into financial_plans (plan_id, user_id, origin_kind, origin_ref, catalog_version, plan, semantic_hash, binding_hash)
     values ($1, $2, 'chat_request', 'chat:turn:1', 'catalog.v1', $3::jsonb, $4, $4)`,
    [PLAN_ID, IDS.owner, JSON.stringify({ plan_id: PLAN_ID }), HASH],
  );
  const runId = await newRun(db, "turn-1");

  await t.test("legacy computations and snapshots stay readable and gain no certificate", async () => {
    const legacy = (await db.query(`select formula_id, code_version, financial_run_id from computations where computation_id = $1`, [LEGACY_COMPUTATION])).rows[0];
    assert.deepEqual(legacy, { formula_id: "gross_margin", code_version: "legacy.1", financial_run_id: null });
    await db.query(`update computations set code_version = 'legacy.2' where computation_id = $1`, [LEGACY_COMPUTATION]);
    assert.equal((await db.query(`select count(*)::int as n from snapshot_financial_runs`)).rows[0].n, 0);
    assert.equal((await db.query(`select count(*)::int as n from financial_results`)).rows[0].n, 0);
    await expectRejected(db, `update computations set financial_run_id = $1 where computation_id = $2`, /immutable/, [runId, LEGACY_COMPUTATION]);
  });

  await t.test("financial computations carry complete lineage, one per run node, and are immutable", async () => {
    const computationId = (await db.query(insertComputation(runId, "gm"))).rows[0].computation_id;
    await expectRejected(db, insertComputation(runId, "gm"), /computations_financial_node_uidx/);
    await expectRejected(
      db,
      `insert into computations (formula_id, code_version, input_refs, output_ref, financial_run_id, node_id)
       values ('x', 'y', '[]', '{}', '${runId}', 'orphan')`,
      /computations_financial_lineage/,
    );
    await expectRejected(db, `update computations set output_hash = $1 where computation_id = $2`, /immutable/, ["b".repeat(64), computationId]);
  });

  await t.test("results: one per output slot, same-run computations only, drafts never verified", async () => {
    const computationId = (await db.query(`select computation_id from computations where financial_run_id = $1 and node_id = 'gm'`, [runId])).rows[0].computation_id;
    const resultId = (await db.query(insertResult(runId, "out_gm", computationId))).rows[0].result_id;
    await expectRejected(db, insertResult(runId, "out_gm", computationId), /financial_results_run_id_output_id_key/);
    const otherRun = await newRun(db, "turn-2");
    await expectRejected(db, insertResult(otherRun, "out_gm", computationId), /foreign key/);
    await expectRejected(db, insertResult(runId, "out_verified", null, "draft", "verified"), /financial_results_state/);
    await expectRejected(db, `update financial_results set payload = '{"kind":"value","value":"0.99"}' where result_id = $1`, /immutable/, [resultId]);
    await expectRejected(db, `update financial_results set state = 'finalized', disposition = 'missing', finalized_at = now() where result_id = $1`, /may only verify/, [resultId]);
    await db.query(`update financial_results set state = 'finalized', disposition = 'verified', finalized_at = now() where result_id = $1`, [resultId]);
    await expectRejected(db, `update financial_results set finalized_at = now() where result_id = $1`, /finalized financial results are immutable/, [resultId]);
  });

  await t.test("a certificate commits only together with its sealed unit", async () => {
    const snapshotId = await newSnapshot(db);
    const certificate = `insert into snapshot_financial_runs (snapshot_id, run_id, unit_id, certificate, certificate_digest, result_ids, presentation_hash, verifier_version)
                         values ('${snapshotId}', '${runId}', 'section', '{}', '${DIGEST}', '[]', '${HASH}', 'financial-verifier.v1')`;
    const seal = `update financial_run_units set state = 'sealed', snapshot_id = '${snapshotId}', certificate_digest = '${DIGEST}'
                  where run_id = '${runId}' and unit_id = 'section'`;

    await assert.rejects(() => db.query(certificate), /does not match a sealed unit/);
    await assert.rejects(() => db.query(seal), /has no matching certificate/);
    // Deferred checks fire at commit: a certificate whose digest differs from the sealed unit's cannot commit.
    const mismatchedSeal = seal.replace(`certificate_digest = '${DIGEST}'`, `certificate_digest = '${"e".repeat(64)}'`);
    await expectRejected(db, `${certificate}; ${mismatchedSeal}; commit`, /does not match a sealed unit|no matching certificate/);

    await db.query("begin");
    await db.query(certificate);
    await db.query(seal);
    await db.query("commit");
    assert.equal((await db.query(`select state from financial_run_units where run_id = $1`, [runId])).rows[0].state, "sealed");
    await expectRejected(db, `update snapshot_financial_runs set presentation_hash = $1`, /append-only/, ["b".repeat(64)]);
    await expectRejected(
      db,
      `insert into snapshot_financial_runs (snapshot_id, run_id, unit_id, certificate, certificate_digest, result_ids, presentation_hash, verifier_version)
       values ('${snapshotId}', '${runId}', 'missing_unit', '{}', '${DIGEST}', '[]', '${HASH}', 'v1')`,
      /foreign key/,
    );
  });

  await t.test("down refuses while certified history exists; an empty database cycles cleanly", async (t) => {
    await assert.rejects(() => applyMigration(db, "0048", "down"), /refusing to drop financial publication records/);
    const cycle = await createDatabase(t, server, "cycle_0048");
    await applyFrozenBase(cycle);
    await applyMigration(cycle, "0046", "up");
    await applyMigration(cycle, "0047", "up");
    const base = await catalogSnapshot(cycle);
    await applyMigration(cycle, "0048", "up");
    const migrated = await catalogSnapshot(cycle);
    await applyMigration(cycle, "0048", "down");
    assert.deepEqual(await catalogSnapshot(cycle), base);
    await applyMigration(cycle, "0048", "up");
    assert.deepEqual(await catalogSnapshot(cycle), migrated);
  });
});
