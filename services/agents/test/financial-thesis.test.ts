import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { IDS, ORIGINAL_REVENUE } from "../../financial-engine/test/db-fixtures.ts";
import { translateThesisCondition } from "../src/financial-thesis-adapter.ts";
import { parseConditionAssessments } from "../src/thesis-types.ts";
import { assess, revenueCondition, saveVersion, thesisDatabase } from "./financial-thesis-fixtures.ts";

const CUTOFF = "2024-03-01T00:00:00.000Z";

test("thesis conditions through the financial engine", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for thesis financial coverage");
    return;
  }
  const { db, pool, agentId } = await thesisDatabase(t, "thesis-fin");

  await t.test("a value just beyond a decimal threshold keeps its exact result", async () => {
    const below = revenueCondition("gt", "383285000000.123456789012345677");
    const above = revenueCondition("gt", "383285000000.123456789012345679");
    const equal = revenueCondition("eq", ORIGINAL_REVENUE);
    const narrative = { condition_id: crypto.randomUUID(), statement: "Enterprise demand stays durable.", falsifier: "Enterprise demand contracts.", horizon: "12 months" };
    const thesis = await saveVersion(pool, agentId, 0, [below, above, equal, narrative]);
    const results = await assess(pool, thesis, CUTOFF);
    assert.deepEqual(results.map((result) => [result.condition_id, result.status, result.method]), [
      [below.condition_id, "supported", "metric"],
      [above.condition_id, "challenged", "metric"],
      [equal.condition_id, "supported", "metric"],
    ], "narrative conditions are left to the narrative method");
    for (const result of results) {
      assert.deepEqual(result.fact_refs, [IDS.original], "the as-reported FY2023 disclosure is the cited input");
      assert.ok(result.financial?.certificate_digest && result.financial.snapshot_id && result.financial.result_hash);
    }
    const plans = (await db.query(`select plan->'thresholds'->0 as threshold from financial_plans p join financial_runs r on r.plan_id = p.plan_id where r.parent_id = $1 order by r.created_at`, [thesis.thesis_version_id])).rows;
    assert.deepEqual(plans[0].threshold.attribution, { kind: "saved_thesis_condition", ref: below.condition_id });
    assert.equal(plans[0].threshold.value, "383285000000.123456789012345677", "the saved threshold, verbatim");
    assert.deepEqual(parseConditionAssessments(JSON.parse(JSON.stringify(results))), results, "results round-trip through storage");
  });

  await t.test("conditions the verified definitions cannot express are unresolved, never approximated", async () => {
    for (const [metric, reason] of [
      [{ metric_key: "market_cap", unit: "currency", period_kind: "point", operator: "gt", threshold: "1", max_age_days: 30 }, "metric_has_no_verified_definition"],
      [{ metric_key: "revenue", unit: "currency", period_kind: "point", operator: "gt", threshold: "1", max_age_days: 30 }, "point_in_time_metric_not_certified"],
      [{ metric_key: "revenue", unit: "shares", period_kind: "fiscal_y", operator: "gt", threshold: "1", max_age_days: 30 }, "unit_does_not_match_definition"],
      [{ metric_key: "total_assets", unit: "currency", period_kind: "ttm", operator: "gt", threshold: "1", max_age_days: 30 }, "trailing_sum_needs_a_flow_metric"],
    ] as const) {
      assert.deepEqual(await translateThesisCondition(db, IDS.issuerA, metric), { ok: false, reason }, JSON.stringify(metric));
    }
    const thesis = await saveVersion(pool, agentId, 1, [revenueCondition("gt", "1", { period_kind: "point" })]);
    const [result] = await assess(pool, thesis, CUTOFF);
    assert.deepEqual([result!.status, result!.method, result!.financial], ["unresolved", "no_evidence", undefined]);
  });

  await t.test("a retry of the same assessment resumes its run; nothing is computed twice", async () => {
    const thesis = await saveVersion(pool, agentId, 2, [revenueCondition("gt", "1")]);
    const first = await assess(pool, thesis, CUTOFF, "run-retry");
    const computations = async () => Number((await db.query(`select count(*)::int as n from computations c join financial_runs r on r.run_id = c.financial_run_id where r.parent_id = $1`, [thesis.thesis_version_id])).rows[0].n);
    const before = await computations();
    assert.deepEqual(await assess(pool, thesis, CUTOFF, "run-retry"), first);
    assert.equal(await computations(), before);
  });

  await t.test("a condition is sealed only while its thesis version is current", async () => {
    const stale = await saveVersion(pool, agentId, 3, [revenueCondition("gt", "1")]);
    await saveVersion(pool, agentId, 4, [revenueCondition("gt", "2")]);
    const [result] = await assess(pool, stale, CUTOFF);
    assert.equal(result!.status, "unresolved");
    const certificates = (await db.query(`select count(*)::int as n from snapshot_financial_runs c join financial_runs r on r.run_id = c.run_id where r.parent_id = $1`, [stale.thesis_version_id])).rows[0].n;
    assert.equal(certificates, 0, "an edited thesis gets no certificate for its old version");
  });
});
