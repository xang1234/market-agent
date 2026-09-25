import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { thesisReuseProjection } from "../src/financial-thesis-adapter.ts";
import { assess, revenueCondition, saveVersion, thesisDatabase } from "./financial-thesis-fixtures.ts";

test("thesis freshness and reuse", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for thesis freshness coverage");
    return;
  }
  const { pool, agentId } = await thesisDatabase(t, "thesis-fresh");
  // FY2023 ends 2023-12-31: 61 days old on 2024-03-01, 106 days old on 2024-04-15.
  const condition = revenueCondition("gt", "1", { max_age_days: 90 });
  const thesis = await saveVersion(pool, agentId, 0, [condition]);

  await t.test("unchanged evidence crossing the saved maximum age becomes unresolved, not a reused supported", async () => {
    const [fresh] = await assess(pool, thesis, "2024-03-01T00:00:00.000Z");
    assert.equal(fresh!.status, "supported");
    const [stale] = await assess(pool, thesis, "2024-04-15T00:00:00.000Z");
    assert.equal(stale!.status, "unresolved");
    assert.match(stale!.reason, /older than the saved maximum age/u);
    assert.notDeepEqual(thesisReuseProjection([stale!]), thesisReuseProjection([fresh!]), "the reuse key sees the boundary crossing");
  });

  await t.test("the boundary is the period end's age in whole days at the pinned cutoff", async () => {
    const [lastFreshDay] = await assess(pool, thesis, "2024-03-30T23:59:59.000Z");
    const [firstStaleDay] = await assess(pool, thesis, "2024-03-31T00:00:00.000Z");
    assert.deepEqual([lastFreshDay!.status, firstStaleDay!.status], ["supported", "unresolved"]);
  });

  await t.test("the same evidence at the same cutoff reuses: new runs, identical reuse key", async () => {
    const [first] = await assess(pool, thesis, "2024-03-01T00:00:00.000Z");
    const [second] = await assess(pool, thesis, "2024-03-01T00:00:00.000Z");
    assert.notEqual(first!.financial!.run_id, second!.financial!.run_id);
    assert.notEqual(first!.financial!.snapshot_id, second!.financial!.snapshot_id);
    assert.deepEqual(thesisReuseProjection([second!]), thesisReuseProjection([first!]), "no engine or snapshot identity alone can look like a change");
  });
});
