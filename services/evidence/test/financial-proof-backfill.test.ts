import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { backfillFactPrecisionProofs, type RetainedSourceReader } from "../src/financial-proof-backfill.ts";
import { financialDatabase, H, IDS, ORIGINAL_VALUE } from "./financial-fixtures.ts";

function reader(tokens: Record<string, string>): RetainedSourceReader {
  return async (fact) =>
    tokens[fact.fact_id] === undefined ? null : { raw_token: tokens[fact.fact_id]!, token_proof_hash: H.proof, source_locator: `retained:${fact.fact_id}` };
}

test("legacy precision proof backfill", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for proof backfill coverage");
    return;
  }
  const db = await financialDatabase(t, "fin-proof-backfill");
  const valuesBefore = (await db.query(`select fact_id::text, value_num::text from facts order by fact_id`)).rows;
  const attestations = async () =>
    (await db.query<{ fact_id: string; precision_class: string }>(
      `select fact_id::text, precision_class from fact_precision_attestations order by attested_at, precision_attestation_id`,
    )).rows;
  const retained = reader({
    [IDS.original]: "3.83285000000123456789012345678e11",
    [IDS.fy2022]: "365817000000.5",
    [IDS.restated]: "not-a-number",
  });

  await t.test("a dry run reports outcomes and writes nothing", async () => {
    const report = await backfillFactPrecisionProofs(db, { dry_run: true, limit: 100, after_fact_id: null, reader: retained, validation_method: "retained_bytes.v1" });
    const byFact = Object.fromEntries(report.outcomes.map((entry) => [entry.fact_id, entry.outcome]));
    assert.equal(byFact[IDS.original], "revalidated");
    assert.equal(byFact[IDS.fy2022], "value_mismatch");
    assert.equal(byFact[IDS.restated], "invalid_token");
    assert.equal(byFact[IDS.privateFact], "missing_source_bytes");
    assert.equal(byFact[IDS.estimated], undefined, "estimated facts are never candidates");
    assert.equal(byFact[IDS.derived], undefined, "derived facts are never candidates");
    assert.equal(report.revalidated, 1);
    assert.deepEqual(await attestations(), []);
  });

  await t.test("a write run proves exact matches only and records explicit gaps for the rest", async () => {
    const report = await backfillFactPrecisionProofs(db, { dry_run: false, limit: 100, after_fact_id: null, reader: retained, validation_method: "retained_bytes.v1" });
    const rows = await attestations();
    assert.equal(rows.find((row) => row.fact_id === IDS.original)?.precision_class, "revalidated_against_source");
    for (const factId of [IDS.fy2022, IDS.restated, IDS.privateFact]) {
      assert.equal(rows.find((row) => row.fact_id === factId)?.precision_class, "legacy_unverified", factId);
    }
    assert.equal(rows.length, report.examined);
    const proof = (await db.query(`select value_text from fact_precision_attestations where fact_id = $1`, [IDS.original])).rows[0];
    assert.equal(proof.value_text, ORIGINAL_VALUE);
    assert.deepEqual((await db.query(`select fact_id::text, value_num::text from facts order by fact_id`)).rows, valuesBefore, "no stored value changes");
  });

  await t.test("reruns are idempotent", async () => {
    const before = await attestations();
    await backfillFactPrecisionProofs(db, { dry_run: false, limit: 100, after_fact_id: null, reader: retained, validation_method: "retained_bytes.v1" });
    assert.deepEqual(await attestations(), before);
  });

  await t.test("bytes retained later upgrade a gap with a superseding proof", async () => {
    await backfillFactPrecisionProofs(db, {
      dry_run: false,
      limit: 100,
      after_fact_id: null,
      reader: reader({ [IDS.fy2022]: "365817000000" }),
      validation_method: "retained_bytes.v2",
    });
    const latest = (await db.query(
      `select precision_class, supersedes is not null as supersedes from current_fact_precision_attestations where fact_id = $1`,
      [IDS.fy2022],
    )).rows[0];
    assert.deepEqual(latest, { precision_class: "revalidated_against_source", supersedes: true });
  });

  await t.test("a pass pages past unresolved gaps with a cursor instead of re-reading them", async () => {
    const unresolved = (await backfillFactPrecisionProofs(db, { dry_run: true, limit: 100, after_fact_id: null, reader: retained, validation_method: "retained_bytes.v1" }))
      .outcomes.map((entry) => entry.fact_id);
    assert.ok(unresolved.length >= 2, "legacy gaps remain eligible for later passes");
    const visited: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await backfillFactPrecisionProofs(db, { dry_run: true, limit: 1, after_fact_id: cursor, reader: retained, validation_method: "retained_bytes.v1" });
      visited.push(...page.outcomes.map((entry) => entry.fact_id));
      cursor = page.next_after_fact_id;
    } while (cursor !== null);
    assert.deepEqual(visited, unresolved);
  });
});
