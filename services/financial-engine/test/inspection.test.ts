import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Client } from "pg";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import type { SnapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { inspectCommittedResult, type ResultInspection } from "../src/inspection.ts";
import type { SqlExecutor } from "../src/ports.ts";
import { completedRun, engineDatabase, IDS, marginPlan, pinnedClients, readyRun } from "./db-fixtures.ts";

function available(inspection: ResultInspection | null): Extract<ResultInspection, { availability: "available" }> {
  assert.ok(inspection && inspection.availability === "available", JSON.stringify(inspection));
  return inspection;
}

type Statement = Readonly<{ sql: string; params: unknown[] }>;

/** Applies `change` for the duration of `action`, bypassing immutability guards, then applies `restore`. */
async function whileChanged<T>(db: Client, change: Statement, restore: Statement, action: () => Promise<T>): Promise<T> {
  const bypass = async ({ sql, params }: Statement) => {
    await db.query("begin");
    try {
      await db.query("set local session_replication_role = replica");
      await db.query(sql, params);
      await db.query("commit");
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  };
  await bypass(change);
  try {
    return await action();
  } finally {
    await bypass(restore);
  }
}

test("committed result inspection", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for inspection coverage");
    return;
  }
  const db = await engineDatabase(t, "fin-inspect");
  const [client] = await pinnedClients(t, db, 1) as [SnapshotTransactionClient];
  const { runId, results } = await completedRun(db, client);
  const inspect = (outputId: string, owner: string = IDS.owner) => inspectCommittedResult(db, owner, results[outputId]!);

  await t.test("a derived result carries its formula, definitions, inputs, time, coverage, and publication", async () => {
    const margin = available(await inspect("out_gm"));
    assert.equal(margin.run_id, runId);
    assert.equal(margin.disposition, "verified");
    assert.deepEqual(margin.formula, { operation: "gross_margin", operation_version: "gross_margin.v1", numeric_policy_version: margin.formula!.numeric_policy_version });
    assert.deepEqual(margin.definitions.map((definition) => definition.metric_key).sort(), ["gross_profit", "revenue"]);
    assert.deepEqual(margin.inputs.map((input) => [input.input_slot, input.status, input.status === "bound" ? input.fact_id : null]), [
      ["a_gp", "bound", IDS.grossProfit2023],
      ["a_rev", "bound", IDS.original],
    ]);
    const revenue = margin.inputs.find((input) => input.input_slot === "a_rev")!;
    assert.ok(revenue.status === "bound");
    assert.equal(revenue.source.source_id, IDS.sourceV1);
    assert.equal(revenue.period.fiscal_year, 2023);
    assert.match(revenue.publication.available_no_later_than, /^2024-/u);
    assert.equal(margin.time.time_mode, "public_information");
    assert.equal(margin.coverage_state, "partial", "the unit's FY2022 margin is a gap");
    const unit = (await db.query(`select snapshot_id::text, certificate_digest from financial_run_units where run_id = $1 and unit_id = 'margin_unit'`, [runId])).rows[0];
    assert.deepEqual(margin.publication, { snapshot_id: unit.snapshot_id, certificate_digest: unit.certificate_digest });

    const reported = available(await inspect("out_rev"));
    assert.equal(reported.formula, null, "a reported value has no formula");
    assert.deepEqual(reported.definitions, [{ metric_key: "revenue", definition_version: "revenue.v1" }]);
  });

  await t.test("a gap shows the missing input and its reason", async () => {
    const blocked = available(await inspect("out_gm22"));
    assert.equal(blocked.disposition, "blocked_dependency");
    assert.deepEqual(blocked.inputs.find((input) => input.input_slot === "a_gp22"), { input_slot: "a_gp22", status: "gap", reason_code: "missing_input" });
  });

  await t.test("another owner, an unknown id, and an uncommitted result are all not found", async () => {
    assert.equal(await inspect("out_gm", IDS.other), null);
    assert.equal(await inspectCommittedResult(db, IDS.owner, randomUUID()), null);
    const draft = await readyRun(db, marginPlan());
    const draftResult = (await db.query(`select result_id::text from financial_results where run_id = $1 and output_id = 'out_gm'`, [draft.runId])).rows[0].result_id;
    assert.equal(await inspectCommittedResult(db, IDS.owner, draftResult), null);
  });

  await t.test("one revoked input anywhere in the transitive closure hides the result", async () => {
    const fact = [IDS.grossProfit2023];
    await whileChanged(db, { sql: `update facts set invalidated_at = now() where fact_id = $1`, params: fact }, { sql: `update facts set invalidated_at = null where fact_id = $1`, params: fact }, async () => {
      assert.equal(await inspect("out_gm"), null, "a direct input");
      assert.equal(await inspect("out_check"), null, "an input two operations away");
      assert.ok(available(await inspect("out_rev")), "a result outside that closure is unaffected");
    });
    const revoke = { sql: `update sources set user_id = $2 where source_id = $1`, params: [IDS.sourceV1, IDS.other] };
    await whileChanged(db, revoke, { sql: `update sources set user_id = null where source_id = $1`, params: [IDS.sourceV1] }, async () => {
      assert.equal(await inspect("out_rev"), null, "a source the owner can no longer read");
    });
    assert.ok(available(await inspect("out_gm")), "access returns with the evidence");
  });

  await t.test("an unsupported certificate version is unavailable, never reinterpreted", async () => {
    const change = `update snapshot_financial_runs set certificate = jsonb_set(certificate, '{verifier_version}', '"snapshot-financial-verifier.v0"') where run_id = $1`;
    const restore = `update snapshot_financial_runs set certificate = jsonb_set(certificate, '{verifier_version}', '"snapshot-financial-verifier.v1"') where run_id = $1`;
    await whileChanged(db, { sql: change, params: [runId] }, { sql: restore, params: [runId] }, async () => {
      const inspection = await inspect("out_gm");
      assert.deepEqual(inspection, { schema_version: "financial_result_inspection.v1", availability: "unsupported_version", result_id: results.out_gm, run_id: runId, reason_code: "unsupported_version" });
    });
  });

  await t.test("inspection only reads", async () => {
    const statements: string[] = [];
    const recording: SqlExecutor = { query: (text, values) => { statements.push(text); return db.query(text, values as unknown[]) as never; } };
    available(await inspectCommittedResult(recording, IDS.owner, results.out_gm!));
    assert.ok(statements.length > 0);
    for (const statement of statements) assert.match(statement.trimStart(), /^select\b/iu);
  });
});
