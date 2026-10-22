import assert from "node:assert/strict";
import test from "node:test";
import type { Client } from "pg";
import { dockerAvailable } from "./docker-pg.ts";
import { applyCanonicalSchema, applyMigration, catalogSnapshot, createDatabase, expectRejected, IDS, seedLegacyEvidence, startServer } from "./financial-migration-helpers.ts";

const HASH = "a".repeat(64);
const PLAN = "0f000000-0000-4000-8000-0000000000e5";
const DERIVATION = JSON.stringify({ version: "period_difference.v1", concept: "Revenues", unit: "USD", terms: [] });

async function attest(db: Client, precisionClass: string, derivation: string | null, supersedes: string | null = null): Promise<string> {
  return (await db.query<{ id: string }>(
    `insert into fact_precision_attestations (fact_id, source_id, precision_class, raw_token, token_proof_hash, value_text, scale_text,
                                              validation_method, derivation, supersedes)
     values ($1, $2, $3, '383285000000.123456789012345678', $4, '383285000000.123456789012345678', '1', 'test', $5::jsonb, $6)
     returning precision_attestation_id::text as id`,
    [IDS.originalFact, IDS.publicSource, precisionClass, HASH, derivation, supersedes],
  )).rows[0]!.id;
}

async function bindRun(db: Client, precisionId: string): Promise<string> {
  await db.query(
    `insert into financial_plans (plan_id, user_id, origin_kind, origin_ref, catalog_version, plan, semantic_hash, binding_hash)
     values ($1, $2, 'grid_run', 'grid:1', 'catalog.v1', $3::jsonb, $4, $4) on conflict do nothing`,
    [PLAN, IDS.owner, JSON.stringify({ plan_id: PLAN, schema_version: "financial_plan.v1" }), HASH],
  );
  const runId = (await db.query<{ run_id: string }>(
    `insert into financial_runs (user_id, parent_kind, parent_id, parent_version, request_key, request_hash, plan_id, feature_mode, knowledge_cutoff, policies)
     values ($1, 'analyst_grid_run', $1, 'grid-run.v1', gen_random_uuid()::text, $2, $3, 'enforce', '2026-10-21T00:00:00Z', '{}') returning run_id::text`,
    [IDS.owner, HASH, PLAN],
  )).rows[0]!.run_id;
  const publication = (await db.query<{ id: string }>(
    `insert into source_publication_attestations (source_id, source_version_hash, available_no_later_than, timing_precision, source_timezone,
                                                  proof_method, proof_ref, proof_hash, mapping_version)
     values ($1, $2, '2024-01-10T23:59:59.999-05:00', 'date', 'America/New_York', 'accession_bound_archive', 'proof', $2, 'test.v1')
     returning attestation_id::text as id`,
    [IDS.publicSource, HASH],
  )).rows[0]!.id;
  await db.query(
    `insert into financial_run_inputs (run_id, input_slot, binding_status, fact_id, publication_attestation_id, precision_attestation_id,
                                       bound_payload, payload_hash, selection_policy_version, candidate_set_digest, candidate_count)
     values ($1, 'a_rev', 'bound', $2, $3, $4, '{}', $5, 'public-information-selection.v6', $5, 1)`,
    [runId, IDS.originalFact, publication, precisionId, HASH],
  );
  return runId;
}

test("0072 derived precision proofs", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for migration coverage");
    return;
  }
  const server = await startServer(t, "derived-precision-0072");
  const db = await createDatabase(t, server, "derived_precision_0072");
  await applyCanonicalSchema(db);
  await seedLegacyEvidence(db);
  const chain = async () => (await db.query(
    `select precision_class, derivation is not null as derived from fact_precision_attestations order by attested_at, precision_attestation_id`,
  )).rows;

  await t.test("down then up rebuilds exactly what the canonical schema defines", async () => {
    const canonical = await catalogSnapshot(db);
    await applyMigration(db, "0072", "down");
    assert.equal((await db.query(`select count(*)::int as n from information_schema.columns where table_name = 'fact_precision_attestations' and column_name = 'derivation'`)).rows[0].n, 0);
    await applyMigration(db, "0072", "up");
    await applyMigration(db, "0072", "up");
    assert.deepEqual(await catalogSnapshot(db), canonical);
  });

  await t.test("a derived proof carries its derivation, and no other proof does", async () => {
    await expectRejected(db, `insert into fact_precision_attestations (fact_id, source_id, precision_class, raw_token, token_proof_hash, value_text, scale_text, validation_method)
                              values ('${IDS.originalFact}', '${IDS.publicSource}', 'derived_from_source_tokens', '1', '${HASH}', '1', '1', 'test')`, /fact_precision_attestations_derivation/);
    await expectRejected(db, `insert into fact_precision_attestations (fact_id, source_id, precision_class, raw_token, token_proof_hash, value_text, scale_text, validation_method, derivation)
                              values ('${IDS.originalFact}', '${IDS.publicSource}', 'source_token_preserved', '1', '${HASH}', '1', '1', 'test', '${DERIVATION}')`, /fact_precision_attestations_derivation/);
    await expectRejected(db, `insert into fact_precision_attestations (fact_id, source_id, precision_class, raw_token, token_proof_hash, value_text, scale_text, validation_method, derivation)
                              values ('${IDS.originalFact}', '${IDS.publicSource}', 'derived_from_source_tokens', '1', '${HASH}', '1', '1', 'test', '[]')`, /fact_precision_attestations_derivation/);
    await expectRejected(db, `insert into fact_precision_attestations (fact_id, source_id, precision_class, validation_method, derivation)
                              values ('${IDS.originalFact}', '${IDS.publicSource}', 'derived_from_source_tokens', 'test', '${DERIVATION}')`, /fact_precision_attestations_proof/);
    const derived = await attest(db, "derived_from_source_tokens", DERIVATION);
    assert.deepEqual((await db.query(`select precision_class, derivation from current_fact_precision_attestations where fact_id = $1`, [IDS.originalFact])).rows, [
      { precision_class: "derived_from_source_tokens", derivation: JSON.parse(DERIVATION) },
    ]);
    await attest(db, "source_token_preserved", null, derived);
    assert.deepEqual(await chain(), [
      { precision_class: "derived_from_source_tokens", derived: true },
      { precision_class: "source_token_preserved", derived: false },
    ]);
  });

  await t.test("down refuses while a run bound a derived proof or one superseding it; otherwise it removes each derived proof and every proof superseding it", async () => {
    const proofs = (await db.query<{ id: string; precision_class: string }>(`select precision_attestation_id::text as id, precision_class from fact_precision_attestations`)).rows;
    for (const precisionClass of ["derived_from_source_tokens", "source_token_preserved"]) {
      const runId = await bindRun(db, proofs.find((proof) => proof.precision_class === precisionClass)!.id);
      await assert.rejects(() => applyMigration(db, "0072", "down"), /reverting 0072 would orphan its proof/, precisionClass);
      await db.query(`delete from financial_runs where run_id = $1`, [runId]);
    }
    await applyMigration(db, "0072", "down");
    assert.equal((await db.query(`select count(*)::int as n from fact_precision_attestations`)).rows[0].n, 0);
    await expectRejected(db, `insert into fact_precision_attestations (fact_id, source_id, precision_class, raw_token, token_proof_hash, value_text, scale_text, validation_method)
                              values ('${IDS.originalFact}', '${IDS.publicSource}', 'derived_from_source_tokens', '1', '${HASH}', '1', '1', 'test')`, /fact_precision_attestations_precision_class_check/);
    await applyMigration(db, "0072", "up");
    await attest(db, "derived_from_source_tokens", DERIVATION);
    assert.deepEqual(await chain(), [{ precision_class: "derived_from_source_tokens", derived: true }]);
  });
});
