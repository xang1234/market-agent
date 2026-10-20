import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "./docker-pg.ts";
import { applyCanonicalSchema, applyMigration, createDatabase, expectRejected, startServer } from "./financial-migration-helpers.ts";

const SOURCE_ID = "0f000000-0000-4000-8000-0000000000c1";
const SEC_SOURCE_ID = "0f000000-0000-4000-8000-0000000000c2";

const fixtureProofOn = (sourceId: string) => `
  insert into source_publication_attestations
    (source_id, source_version_hash, available_no_later_than, timing_precision, source_timezone, proof_method, proof_ref, proof_hash, mapping_version)
  values ('${sourceId}', '${"a".repeat(64)}', '2026-09-01T00:00:00Z', 'instant', 'UTC', 'fixture_declaration',
          'golden_fixture:dataset.ts', '${"b".repeat(64)}', 'golden-fixture-declaration.v1')`;
const insertFixtureProof = fixtureProofOn(SOURCE_ID);

test("0063 adds the fixture_declaration publication method", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for migration coverage");
    return;
  }
  const server = await startServer(t, "fixture-declaration-0063");
  const db = await createDatabase(t, server, "fixture_declaration_0063");
  await applyCanonicalSchema(db);
  await db.query(`
    insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at)
    values ('${SOURCE_ID}', 'golden_fixture', 'filing', 'primary', 'internal', '2026-09-01T00:00:00Z'),
           ('${SEC_SOURCE_ID}', 'sec_edgar', 'filing', 'primary', 'public', '2026-09-01T00:00:00Z')`);
  const fixtureProofs = async () =>
    Number((await db.query(`select count(*)::int as n from source_publication_attestations where proof_method = 'fixture_declaration'`)).rows[0].n);

  await db.query(insertFixtureProof);
  assert.equal(await fixtureProofs(), 1, "the canonical schema accepts a fixture_declaration proof");
  await expectRejected(db, fixtureProofOn(SEC_SOURCE_ID), /may only attest a golden_fixture source/);
  await assert.rejects(() => applyMigration(db, "0063", "down"), /source_publication_attestations_proof_method_check/);
  assert.equal(await fixtureProofs(), 1, "the refused down keeps the proof");
  await expectRejected(db, fixtureProofOn(SEC_SOURCE_ID), /may only attest a golden_fixture source/);

  await db.query(`delete from source_publication_attestations`);
  await applyMigration(db, "0063", "down");
  await expectRejected(db, insertFixtureProof, /source_publication_attestations_proof_method_check/);
  const fence = (await db.query(
    `select (select count(*)::int from pg_trigger where tgname = 'source_publication_attestations_fixture_source') as triggers,
            (select count(*)::int from pg_proc where proname = 'require_fixture_source_for_fixture_proof') as functions`,
  )).rows[0];
  assert.deepEqual(fence, { triggers: 0, functions: 0 }, "down removes the fixture-source trigger and its function");

  await applyMigration(db, "0063", "up");
  await applyMigration(db, "0063", "up");
  await db.query(insertFixtureProof);
  assert.equal(await fixtureProofs(), 1, "up restores the method and reruns safely");
  await expectRejected(db, fixtureProofOn(SEC_SOURCE_ID), /may only attest a golden_fixture source/);
});
