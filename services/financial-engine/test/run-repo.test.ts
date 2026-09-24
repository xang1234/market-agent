import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Client } from "pg";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createRuntimeAuthority } from "../../financial-core/src/index.ts";
import { getRun, reserveRun } from "../src/run-repo.ts";
import { authorityFor, connectExtraClient, engineDatabase, IDS, revenuePlan, waitForLockWaiters } from "./db-fixtures.ts";

function samePlanNewId() {
  return { ...revenuePlan(), plan_id: randomUUID() };
}

test("financial run reservation", { timeout: 240_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for run repository coverage");
    return;
  }
  const db = await engineDatabase(t, "fin-run-repo");
  const [clientA, clientB, blocker] = [await connectExtraClient(t, db), await connectExtraClient(t, db), await connectExtraClient(t, db)];
  const authority = authorityFor();

  await t.test("two concurrent creators with one owner, parent, and request key get one run", async () => {
    const plan = revenuePlan();
    await blocker.query("begin");
    await blocker.query("lock table financial_runs in exclusive mode");
    const first = reserveRun(clientA, { authority, request_key: "turn-concurrent", plan });
    const second = reserveRun(clientB, { authority, request_key: "turn-concurrent", plan: { ...plan, plan_id: randomUUID() } });
    await waitForLockWaiters(db, 2);
    await blocker.query("commit");
    const results = await Promise.all([first, second]);

    assert.deepEqual(results.map((result) => result.status).sort(), ["created", "existing"]);
    const runIds = results.map((result) => (result.status === "conflict" ? result.run_id : result.run.run_id));
    assert.equal(runIds[0], runIds[1]);
    assert.equal((await db.query(`select count(*)::int as n from financial_runs where request_key = 'turn-concurrent'`)).rows[0].n, 1);
    assert.equal((await db.query(`select count(*)::int as n from financial_run_events where run_id = $1 and event_kind = 'run_created'`, [runIds[0]])).rows[0].n, 1);
    const plans = (await db.query(`select count(*)::int as n from financial_plans p join financial_runs r on r.plan_id = p.plan_id where r.request_key = 'turn-concurrent'`)).rows[0].n;
    const orphanPlans = (await db.query(`select count(*)::int as n from financial_plans p where not exists (select 1 from financial_runs r where r.plan_id = p.plan_id)`)).rows[0].n;
    assert.equal(plans, 1);
    assert.equal(orphanPlans, 0, "the losing creator's plan rolled back");
  });

  await t.test("a retry with a new plan id but the same request reuses the run", async () => {
    const created = await reserveRun(db, { authority, request_key: "turn-retry", plan: samePlanNewId() });
    const retried = await reserveRun(db, { authority, request_key: "turn-retry", plan: samePlanNewId() });
    assert.equal(created.status, "created");
    assert.equal(retried.status, "existing");
    assert.equal(retried.status === "existing" && created.status === "created" && retried.run.run_id, created.status === "created" && created.run.run_id);
  });

  await t.test("the same key with a different request or parent version conflicts", async () => {
    await reserveRun(db, { authority, request_key: "turn-conflict", plan: revenuePlan() });
    const differentRequest = await reserveRun(db, { authority, request_key: "turn-conflict", plan: revenuePlan({ basis: "as_restated" }) });
    assert.deepEqual(differentRequest.status === "conflict" && differentRequest.reason, "request_hash_mismatch");
    const newerParent = createRuntimeAuthority({ ...authority, parent: { ...authority.parent, version: "2" } });
    const differentParent = await reserveRun(db, { authority: newerParent, request_key: "turn-conflict", plan: revenuePlan() });
    assert.deepEqual(differentParent.status === "conflict" && differentParent.reason, "parent_version_mismatch");
  });

  await t.test("owners never share runs, even for semantically identical plans", async () => {
    const mine = await reserveRun(db, { authority, request_key: "turn-shared", plan: revenuePlan() });
    const theirs = await reserveRun(db, { authority: authorityFor(IDS.other), request_key: "turn-shared", plan: revenuePlan() });
    assert.ok(mine.status === "created" && theirs.status === "created");
    if (mine.status !== "created" || theirs.status !== "created") return;
    assert.notEqual(mine.run.run_id, theirs.run.run_id);
    assert.equal(mine.run.request_hash, theirs.run.request_hash);
    assert.equal(await getRun(db, IDS.other, mine.run.run_id), null);
    assert.equal((await getRun(db, IDS.owner, mine.run.run_id))?.execution_state, "pending");
  });

  await t.test("the run persists the server-selected mode and cutoff", async () => {
    const enforce = authorityFor(IDS.owner, { mode: "enforce" });
    const result = await reserveRun(db, { authority: enforce, request_key: "turn-mode", plan: revenuePlan() });
    assert.ok(result.status === "created");
    if (result.status !== "created") return;
    assert.equal(result.run.feature_mode, "enforce");
    assert.equal(result.run.knowledge_cutoff, "2024-01-16T04:59:59.999Z");
  });
});
