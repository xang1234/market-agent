import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "./docker-pg.ts";
import { applyCanonicalSchema, applyMigration, createDatabase, expectRejected, IDS, seedLegacyEvidence, startServer } from "./financial-migration-helpers.ts";

function context(factId: string, adjustment: string, asFiledOn: string | null): string {
  return `insert into fact_financial_contexts (fact_id, context_version, period_type, dimension_scope, reporting_basis, adjustment_basis,
                                               as_filed_on, share_basis, fiscal_calendar_version, disclosure_relation)
          values ('${factId}', 'context.v1', 'duration', 'consolidated', 'as_reported', '${adjustment}',
                  ${asFiledOn === null ? "null" : `'${asFiledOn}'`}, 'diluted', 'fiscal-calendar.v1', 'original')`;
}

test("0066 as-filed contexts name their filing date", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for migration coverage");
    return;
  }
  const server = await startServer(t, "as-filed-0066");
  const db = await createDatabase(t, server, "as_filed_0066");
  await applyCanonicalSchema(db);
  await seedLegacyEvidence(db);
  const contexts = async () => (await db.query(
    `select fact_id::text, adjustment_basis, as_filed_on::text as as_filed_on from fact_financial_contexts order by fact_id`,
  )).rows;
  const column = async () => (await db.query(
    `select count(*)::int as n from information_schema.columns where table_name = 'fact_financial_contexts' and column_name = 'as_filed_on'`,
  )).rows[0].n;

  await t.test("an as-filed context needs its filing date, and no other context has one", async () => {
    await expectRejected(db, context(IDS.originalFact, "as_filed", null), /fact_financial_contexts_as_filed/);
    await expectRejected(db, context(IDS.originalFact, "unadjusted", "2024-02-21"), /fact_financial_contexts_as_filed/);
    await expectRejected(db, context(IDS.originalFact, "restated", null), /fact_financial_contexts_adjustment_basis_check/);
    await db.query(context(IDS.originalFact, "as_filed", "2024-02-21"));
    await db.query(context(IDS.restatedFact, "unadjusted", null));
    assert.deepEqual(await contexts(), [
      { fact_id: IDS.originalFact, adjustment_basis: "as_filed", as_filed_on: "2024-02-21" },
      { fact_id: IDS.restatedFact, adjustment_basis: "unadjusted", as_filed_on: null },
    ]);
  });

  await t.test("down removes the as-filed contexts and the date; up restores the basis, and reruns cleanly", async () => {
    await applyMigration(db, "0066", "down");
    assert.equal(await column(), 0);
    const remaining = (await db.query(`select fact_id::text, adjustment_basis from fact_financial_contexts order by fact_id`)).rows;
    assert.deepEqual(remaining, [{ fact_id: IDS.restatedFact, adjustment_basis: "unadjusted" }]);
    await applyMigration(db, "0066", "up");
    await applyMigration(db, "0066", "up");
    assert.equal(await column(), 1);
    await db.query(context(IDS.originalFact, "as_filed", "2024-02-21"));
    await expectRejected(db, context(IDS.privateFact, "as_filed", null), /fact_financial_contexts_as_filed/);
  });
});
