import assert from "node:assert/strict";
import test from "node:test";
import type { Client } from "pg";
import { dockerAvailable } from "./docker-pg.ts";
import {
  applyCanonicalSchema,
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
const OTHER_HASH = "b".repeat(64);

async function count(client: Client, table: string): Promise<number> {
  return Number((await client.query(`select count(*)::int as n from ${table}`)).rows[0].n);
}

function insertSourceAttestation(overrides: Record<string, string> = {}): string {
  const values = {
    source_id: `'${IDS.publicSource}'`,
    source_version_hash: `'${HASH}'`,
    available_not_before: "null",
    available_no_later_than: "'2024-01-10T23:59:59.999-05:00'",
    timing_precision: "'date'",
    source_timezone: "'America/New_York'",
    proof_method: "'accession_bound_archive'",
    proof_ref: "'s3://proofs/0000320193-24-000006'",
    proof_hash: `'${OTHER_HASH}'`,
    mapping_version: "'sec-acceptance-mapping.v1'",
    ...overrides,
  };
  return `insert into source_publication_attestations (${Object.keys(values).join(", ")}) values (${Object.values(values).join(", ")}) returning attestation_id`;
}

test("0046 financial evidence attestations", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for financial migration coverage");
    return;
  }
  const server = await startServer(t, "fin-evidence-0046");

  await t.test("the frozen base upgraded through every financial migration matches the fresh canonical schema", async (t) => {
    const fresh = await createDatabase(t, server, "fresh_0046");
    await applyCanonicalSchema(fresh);
    const upgraded = await createDatabase(t, server, "upgraded_0046");
    await applyFrozenBase(upgraded);
    await applyFinancialMigrations(upgraded);
    assert.deepEqual(await catalogSnapshot(upgraded), await catalogSnapshot(fresh));
  });

  const db = await createDatabase(t, server, "evidence_0046");
  await applyFrozenBase(db);
  await seedLegacyEvidence(db);
  const before = (await db.query("select fact_id, value_num::text, superseded_by from facts order by fact_id")).rows;
  await applyMigration(db, "0046", "up");

  await t.test("existing facts are preserved and no legacy row acquires a proof", async () => {
    assert.deepEqual((await db.query("select fact_id, value_num::text, superseded_by from facts order by fact_id")).rows, before);
    assert.equal(before.find((row) => row.fact_id === IDS.originalFact)?.value_num, "383285000000.123456789012345678");
    for (const table of ["source_publication_attestations", "fact_precision_attestations", "fact_financial_contexts"]) {
      assert.equal(await count(db, table), 0, table);
    }
  });

  await t.test("publication attestations require ordered bounds, known enums, and hashes", async () => {
    const created = await db.query(insertSourceAttestation());
    assert.equal(created.rowCount, 1);
    await expectRejected(
      db,
      insertSourceAttestation({ available_not_before: "'2024-01-12T00:00:00Z'" }),
      /source_publication_attestations_bounds/,
    );
    await expectRejected(db, insertSourceAttestation({ timing_precision: "'guessed'" }), /timing_precision/);
    await expectRejected(db, insertSourceAttestation({ proof_method: "'model_assertion'" }), /proof_method/);
    await expectRejected(db, insertSourceAttestation({ source_version_hash: "'not-a-hash'" }), /source_version_hash/);
    await expectRejected(db, insertSourceAttestation({ source_timezone: "' '" }), /source_timezone/);
  });

  await t.test("attestations are append-only; corrections are superseding rows", async () => {
    const original = (await db.query(insertSourceAttestation({ source_version_hash: `'${"c".repeat(64)}'` }))).rows[0].attestation_id;
    await expectRejected(
      db,
      `update source_publication_attestations set available_no_later_than = '2020-01-01T00:00:00Z' where attestation_id = $1`,
      /append-only/,
      [original],
    );
    await expectRejected(db, insertSourceAttestation({ supersedes: `'${original}'` }), /source_publication_attestations_supersession/);
    await db.query(insertSourceAttestation({ supersedes: `'${original}'`, supersession_reason: "'correction'" }));
    await expectRejected(
      db,
      insertSourceAttestation({ supersedes: `'${original}'`, supersession_reason: "'correction'" }),
      /source_publication_attestations_successor_uidx/,
    );
  });

  await t.test("precision attestations must name the fact's own source and carry token proof", async () => {
    const insert = (sourceId: string, precisionClass: string, withProof: boolean, supersedes: string | null) => `
      insert into fact_precision_attestations (fact_id, source_id, precision_class, raw_token, token_proof_hash, value_text, scale_text, validation_method, supersedes)
      values ('${IDS.originalFact}', '${sourceId}', '${precisionClass}',
              ${withProof ? "'383285000000.123456789012345678'" : "null"}, ${withProof ? `'${HASH}'` : "null"},
              ${withProof ? "'383285000000.123456789012345678'" : "null"}, ${withProof ? "'1'" : "null"}, 'lossless_json_token',
              ${supersedes === null ? "null" : `'${supersedes}'`})
      returning precision_attestation_id::text as id`;
    const root = (await db.query(insert(IDS.publicSource, "source_token_preserved", true, null))).rows[0].id;
    const head = (await db.query(insert(IDS.publicSource, "legacy_unverified", false, root))).rows[0].id;
    await expectRejected(db, insert(IDS.publicSource, "legacy_unverified", false, null), /fact_precision_attestations_root_uidx/);
    await expectRejected(db, insert(IDS.publicSource, "legacy_unverified", false, root), /fact_precision_attestations_successor_uidx/);
    await expectRejected(db, insert(IDS.privateSource, "source_token_preserved", true, head), /foreign key/);
    await expectRejected(db, insert(IDS.publicSource, "source_token_preserved", false, head), /fact_precision_attestations_proof/);
    await expectRejected(db, insert(IDS.publicSource, "rounded_guess", true, head), /precision_class/);
    await expectRejected(
      db,
      `insert into fact_precision_attestations (fact_id, source_id, precision_class, raw_token, token_proof_hash, value_text, scale_text, validation_method, supersedes)
       values ('${IDS.originalFact}', '${IDS.publicSource}', 'source_token_preserved', '1.50', '${HASH}', '1.50', '1', 'x', '${head}')`,
      /value_text/,
    );
    const current = (await db.query(`select precision_attestation_id::text as id from current_fact_precision_attestations where fact_id = $1`, [IDS.originalFact])).rows;
    assert.deepEqual(current, [{ id: head }], "the view exposes exactly the chain head");
    await expectRejected(db, `update fact_precision_attestations set precision_class = 'revalidated_against_source'`, /append-only/);
  });

  await t.test("financial contexts are explicit and dimensionally consistent", async () => {
    const insert = (factId: string, scope: string, members: string) => `
      insert into fact_financial_contexts (fact_id, context_version, period_type, dimension_scope, dimension_members,
                                           reporting_basis, adjustment_basis, share_basis, fiscal_calendar_version, disclosure_relation)
      values ('${factId}', 'context.v1', 'duration', '${scope}', '${members}'::jsonb,
              'as_reported', 'unadjusted', 'not_applicable', 'fiscal-calendar.v1', 'original')`;
    await expectRejected(db, insert(IDS.originalFact, "segment", "[]"), /fact_financial_contexts_dimensions/);
    await expectRejected(db, insert(IDS.originalFact, "consolidated", `[{"axis":"srt:Segment","member":"Cloud"}]`), /fact_financial_contexts_dimensions/);
    await db.query(insert(IDS.originalFact, "consolidated", "[]"));
    await expectRejected(db, insert(IDS.originalFact, "consolidated", "[]"), /duplicate key/);
    await expectRejected(db, `update fact_financial_contexts set reporting_basis = 'as_restated'`, /append-only/);
  });

  await t.test("down refuses while proof history exists", async () => {
    await assert.rejects(() => applyMigration(db, "0046", "down"), /refusing to drop financial evidence attestations/);
    assert.equal(await count(db, "source_publication_attestations") > 0, true);
  });

  await t.test("down then up cycles cleanly on an empty database", async (t) => {
    const cycle = await createDatabase(t, server, "cycle_0046");
    await applyFrozenBase(cycle);
    const base = await catalogSnapshot(cycle);
    await applyMigration(cycle, "0046", "up");
    const migrated = await catalogSnapshot(cycle);
    await applyMigration(cycle, "0046", "down");
    assert.deepEqual(await catalogSnapshot(cycle), base);
    await applyMigration(cycle, "0046", "up");
    assert.deepEqual(await catalogSnapshot(cycle), migrated);
  });
});
