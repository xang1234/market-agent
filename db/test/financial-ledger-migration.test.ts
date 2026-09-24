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
const PLAN_ID = "0f000000-0000-4000-8000-0000000000e1";
const PARENT_ID = "0f000000-0000-4000-8000-0000000000f1";

async function insertPlan(db: Client, planId: string, userId: string): Promise<void> {
  await db.query(
    `insert into financial_plans (plan_id, user_id, origin_kind, origin_ref, catalog_version, plan, semantic_hash, binding_hash)
     values ($1, $2, 'chat_request', 'chat:turn:1', 'catalog.v1', $3::jsonb, $4, $4)`,
    [planId, userId, JSON.stringify({ plan_id: planId, schema_version: "financial_plan.v1" }), HASH],
  );
}

async function insertRun(db: Client, overrides: Partial<Record<"user_id" | "request_key" | "request_hash" | "plan_id", string>> = {}): Promise<string> {
  const values = { user_id: IDS.owner, request_key: "turn-1", request_hash: HASH, plan_id: PLAN_ID, ...overrides };
  const result = await db.query(
    `insert into financial_runs (user_id, parent_kind, parent_id, parent_version, request_key, request_hash, plan_id,
                                 feature_mode, knowledge_cutoff, policies)
     values ($1, 'chat_thread', $2, '1', $3, $4, $5, 'shadow', '2024-01-15T23:59:59.999-05:00', '{"reporting_basis":"as_reported"}')
     returning run_id`,
    [values.user_id, PARENT_ID, values.request_key, values.request_hash, values.plan_id],
  );
  return result.rows[0].run_id;
}

test("0047 financial run ledger", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for financial migration coverage");
    return;
  }
  const server = await startServer(t, "fin-ledger-0047");
  const db = await createDatabase(t, server, "ledger_0047");
  await applyFrozenBase(db);
  await seedLegacyEvidence(db);
  await applyFinancialMigrations(db);
  await insertPlan(db, PLAN_ID, IDS.owner);
  const runId = await insertRun(db);

  await t.test("one run per owner, parent, and request key; conflicting hashes cannot reuse it", async () => {
    await expectRejected(db, `insert into financial_runs (user_id, parent_kind, parent_id, parent_version, request_key, request_hash, plan_id, feature_mode, knowledge_cutoff, policies)
      values ($1, 'chat_thread', $2, '1', 'turn-1', $3, $4, 'shadow', now(), '{}')`, /financial_runs_user_id_parent_kind_parent_id_request_key_key/, [IDS.owner, PARENT_ID, "b".repeat(64), PLAN_ID]);
    // Another owner with the same parent id and request key is a different run.
    await insertPlan(db, "0f000000-0000-4000-8000-0000000000e2", IDS.otherOwner);
    await insertRun(db, { user_id: IDS.otherOwner, plan_id: "0f000000-0000-4000-8000-0000000000e2" });
  });

  await t.test("a run cannot bind another owner's plan", async () => {
    await assert.rejects(() => insertRun(db, { user_id: IDS.otherOwner, request_key: "turn-2" }), /foreign key/);
  });

  await t.test("plans are immutable and self-identifying", async () => {
    await expectRejected(db, `update financial_plans set interpretation = 'changed' where plan_id = $1`, /append-only/, [PLAN_ID]);
    await expectRejected(
      db,
      `insert into financial_plans (plan_id, user_id, origin_kind, origin_ref, catalog_version, plan, semantic_hash, binding_hash)
       values ('0f000000-0000-4000-8000-0000000000e3', $1, 'chat_request', 'x', 'catalog.v1', '{"plan_id":"someone-else"}', $2, $2)`,
      /financial_plans_identity/,
      [IDS.owner, HASH],
    );
  });

  await t.test("lifecycle columns change while identity, plan, and policies stay immutable", async () => {
    await db.query(`update financial_runs set execution_state = 'running', lease_owner = 'worker-1', lease_epoch = 1,
                    lease_expires_at = now() + interval '1 minute' where run_id = $1`, [runId]);
    for (const assignment of ["request_hash = 'b'", "plan_id = null", "feature_mode = 'enforce'", "knowledge_cutoff = now()", "policies = '{}'", "parent_version = '2'"]) {
      await expectRejected(db, `update financial_runs set ${assignment} where run_id = $1`, /immutable|violates/, [runId]);
    }
    await expectRejected(db, `update financial_runs set lease_epoch = 0 where run_id = $1`, /never decrease/, [runId]);
    await expectRejected(db, `update financial_runs set lease_owner = null where run_id = $1`, /financial_runs_lease/, [runId]);
    await expectRejected(db, `update financial_runs set execution_state = 'failed' where run_id = $1`, /financial_runs_failure/, [runId]);
  });

  await t.test("terminal runs cannot be revived", async () => {
    const cancelled = await insertRun(db, { request_key: "turn-cancelled" });
    await db.query(`update financial_runs set execution_state = 'cancelled' where run_id = $1`, [cancelled]);
    await expectRejected(db, `update financial_runs set execution_state = 'running' where run_id = $1`, /terminal/, [cancelled]);
  });

  await t.test("units have one immutable closure per run, and sealing requires a snapshot certificate", async () => {
    const insertUnit = (unitId: string) =>
      db.query(
        `insert into financial_run_units (run_id, unit_id, unit_kind, output_ids, closure_node_ids, closure_hash)
         values ($1, $2, 'chat_section', '["out_a"]', '["a_rev"]', $3)`,
        [runId, unitId, HASH],
      );
    await insertUnit("section");
    await assert.rejects(() => insertUnit("section"), /duplicate key/);
    await expectRejected(db, `update financial_run_units set closure_node_ids = '["a_rev","b_rev"]' where run_id = $1`, /immutable/, [runId]);
    await expectRejected(db, `update financial_run_units set state = 'sealed' where run_id = $1`, /financial_run_units_sealed/, [runId]);
    await db.query(`update financial_run_units set state = 'rejected', rejection_code = 'integrity_failure' where run_id = $1`, [runId]);
    await expectRejected(db, `update financial_run_units set state = 'pending', rejection_code = null where run_id = $1`, /final/, [runId]);
  });

  await t.test("inputs are unique per slot, fully proven when bound, and immutable", async () => {
    const attestation = (await db.query(
      `insert into source_publication_attestations (source_id, source_version_hash, available_no_later_than, timing_precision, source_timezone,
                                                    proof_method, proof_ref, proof_hash, mapping_version)
       values ($1, $2, '2024-01-10T23:59:59.999-05:00', 'date', 'America/New_York', 'accession_bound_archive', 'proof', $2, 'm.v1')
       returning attestation_id`,
      [IDS.publicSource, HASH],
    )).rows[0].attestation_id;
    const precision = (await db.query(
      `insert into fact_precision_attestations (fact_id, source_id, precision_class, raw_token, token_proof_hash, value_text, scale_text, validation_method)
       values ($1, $2, 'source_token_preserved', '383285000000.123456789012345678', $3, '383285000000.123456789012345678', '1', 'lossless_json_token')
       returning precision_attestation_id`,
      [IDS.originalFact, IDS.publicSource, HASH],
    )).rows[0].precision_attestation_id;
    const bind = (slot: string, withPrecision: boolean) =>
      db.query(
        `insert into financial_run_inputs (run_id, input_slot, binding_status, fact_id, publication_attestation_id, precision_attestation_id,
                                           bound_payload, payload_hash, selection_policy_version, candidate_set_digest, candidate_count)
         values ($1, $2, 'bound', $3, $4, $5, '{"input_slot":"a_rev"}', $6, 'selection.v1', $6, 2)`,
        [runId, slot, IDS.originalFact, attestation, withPrecision ? precision : null, HASH],
      );
    await bind("a_rev", true);
    await assert.rejects(() => bind("a_rev", true), /duplicate key/);
    await assert.rejects(() => bind("a_gp", false), /financial_run_inputs_binding/);
    await db.query(
      `insert into financial_run_inputs (run_id, input_slot, binding_status, gap_reason, selection_policy_version, candidate_set_digest, candidate_count)
       values ($1, 'b_rev', 'gap', 'publication_time_unknown', 'selection.v1', $2, 0)`,
      [runId, HASH],
    );
    await expectRejected(db, `update financial_run_inputs set bound_payload = '{"input_slot":"tampered"}' where run_id = $1`, /append-only/, [runId]);
  });

  await t.test("events are append-only and ordered per run", async () => {
    await db.query(`insert into financial_run_events (run_id, sequence, event_kind, payload) values ($1, 1, 'run_created', '{}')`, [runId]);
    await assert.rejects(
      () => db.query(`insert into financial_run_events (run_id, sequence, event_kind) values ($1, 1, 'inputs_bound')`, [runId]),
      /duplicate key/,
    );
    await expectRejected(db, `insert into financial_run_events (run_id, sequence, event_kind) values ($1, 2, 'draft_value_leaked')`, /event_kind/, [runId]);
    await expectRejected(db, `update financial_run_events set event_kind = 'run_failed' where run_id = $1`, /append-only/, [runId]);
  });

  await t.test("down refuses while run history exists; an empty ledger cycles cleanly", async (t) => {
    await assert.rejects(() => applyMigration(db, "0047", "down"), /refusing to drop the financial run ledger/);
    const cycle = await createDatabase(t, server, "cycle_0047");
    await applyFrozenBase(cycle);
    await applyMigration(cycle, "0046", "up");
    const base = await catalogSnapshot(cycle);
    await applyMigration(cycle, "0047", "up");
    const migrated = await catalogSnapshot(cycle);
    await applyMigration(cycle, "0047", "down");
    assert.deepEqual(await catalogSnapshot(cycle), base);
    await applyMigration(cycle, "0047", "up");
    assert.deepEqual(await catalogSnapshot(cycle), migrated);
  });
});
