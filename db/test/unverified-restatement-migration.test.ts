import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "./docker-pg.ts";
import { applyCanonicalSchema, applyMigration, createDatabase, expectRejected, IDS, seedLegacyEvidence, startServer } from "./financial-migration-helpers.ts";

function context(factId: string, relation: string): string {
  return `insert into fact_financial_contexts (fact_id, context_version, period_type, dimension_scope, reporting_basis, adjustment_basis,
                                               as_filed_on, share_basis, fiscal_calendar_version, disclosure_relation)
          values ('${factId}', 'context.v1', 'duration', 'consolidated', 'as_restated', 'as_filed',
                  '2025-02-26', 'diluted', 'fiscal-calendar.v1', '${relation}')`;
}

test("0067 a later filing's statement can be an unverified restatement", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for migration coverage");
    return;
  }
  const server = await startServer(t, "unverified-0067");
  const db = await createDatabase(t, server, "unverified_0067");
  await applyCanonicalSchema(db);
  await seedLegacyEvidence(db);
  const relations = async () => (await db.query(`select fact_id::text, disclosure_relation from fact_financial_contexts order by fact_id`)).rows;

  await t.test("a context may name an unverified restatement, and no relation outside the vocabulary", async () => {
    await expectRejected(db, context(IDS.restatedFact, "split_recast"), /fact_financial_contexts_disclosure_relation_check/);
    await db.query(context(IDS.restatedFact, "unverified_restatement"));
    await db.query(context(IDS.originalFact, "original"));
    assert.deepEqual(await relations(), [
      { fact_id: IDS.originalFact, disclosure_relation: "original" },
      { fact_id: IDS.restatedFact, disclosure_relation: "unverified_restatement" },
    ]);
  });

  await t.test("down removes the unverified contexts and the relation; up restores it, and reruns cleanly", async () => {
    await applyMigration(db, "0067", "down");
    assert.deepEqual(await relations(), [{ fact_id: IDS.originalFact, disclosure_relation: "original" }]);
    await expectRejected(db, context(IDS.restatedFact, "unverified_restatement"), /fact_financial_contexts_disclosure_relation_check/);
    await applyMigration(db, "0067", "up");
    await applyMigration(db, "0067", "up");
    await db.query(context(IDS.restatedFact, "unverified_restatement"));
    assert.deepEqual((await relations()).map((row) => row.disclosure_relation), ["original", "unverified_restatement"]);
  });
});
