// Cross-surface parity: equivalent requests routed through each surface's
// real adapter — Chat's model-planned turn, an Analyze memo section, a grid
// cell, a thesis condition, and a Discovery criterion — against one evidence
// database. Numbers, predicates, basis, input lineage, and coverage must agree
// wherever the request is the same. What may differ is stated explicitly:
// surface ids, layout, and parent semantics; Chat's cutoff (the turn's own
// time); and the saved rules' basis (as restated), which binds the restated
// disclosure instead of the original.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Client } from "pg";
import { connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { assess, revenueCondition, saveVersion } from "../../agents/test/financial-thesis-fixtures.ts";
import { cellsByPosition, settled, startRun, waitForRun } from "../../analyst-grids/test/financial-fixtures.ts";
import { createMemoRun } from "../../analyze/test/financial-fixtures.ts";
import { chatHarness, completed, revenueModel } from "../../chat/test/financial-fixtures.ts";
import { REVENUE_ID, setupFinancialCampaign } from "../../discovery/test/financial-fixtures.ts";
import { databaseUrl, engineDatabase, IDS } from "./db-fixtures.ts";

const CUTOFF = "2024-03-01T00:00:00.000Z";

type Certified = Readonly<{
  cutoff: string;
  basis: string;
  unit_state: string;
  coverage: string;
  disposition: string;
  payload: Record<string, unknown>;
  /** The bound facts behind the output, with the period each was bound for. */
  inputs: ReadonlyArray<Readonly<{ fact_id: string; period: unknown }>>;
}>;

/** One committed output as the certificate covers it, read from the ledger rather than any surface's copy. */
async function certified(db: Client, runId: string, outputId: string): Promise<Certified> {
  const row = (await db.query(
    `select to_char(r.knowledge_cutoff at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as cutoff, p.plan->'policies'->>'reporting_basis' as basis,
            u.state as unit_state, u.coverage_state as coverage, res.disposition, res.payload, res.node_id, res.dependencies
       from financial_runs r
       join financial_plans p on p.plan_id = r.plan_id and p.user_id = r.user_id
       join financial_results res on res.run_id = r.run_id and res.output_id = $2
       join financial_run_units u on u.run_id = r.run_id and u.unit_id = res.unit_id
      where r.run_id = $1`,
    [runId, outputId],
  )).rows[0];
  assert.ok(row, `run ${runId} has no committed output ${outputId}`);
  const slots = [row.node_id, ...(row.dependencies as string[])];
  const inputs = (await db.query(
    `select fact_id::text, bound_payload->'period' as period from financial_run_inputs
      where run_id = $1 and binding_status = 'bound' and input_slot = any($2::text[]) order by fact_id`,
    [runId, slots],
  )).rows;
  return { cutoff: row.cutoff, basis: row.basis, unit_state: row.unit_state, coverage: row.coverage, disposition: row.disposition, payload: row.payload, inputs };
}

async function runFor(db: Client, parentId: string): Promise<string> {
  const rows = (await db.query(`select run_id::text from financial_runs where parent_id = $1`, [parentId])).rows;
  assert.equal(rows.length, 1, `one financial run for parent ${parentId}`);
  return rows[0].run_id;
}

test("cross-surface parity", { skip: !dockerAvailable(), timeout: 300_000 }, async (t) => {
  const db = await engineDatabase(t, "cross-surface-parity");
  const pool = await connectedPool(t, databaseUrl(db), { max: 8 });

  // Chat: a model-planned turn for AAA's FY2023 revenue.
  const threadId = randomUUID();
  await db.query(`insert into chat_threads (thread_id, user_id) values ($1, $2)`, [threadId, IDS.owner]);
  completed((await chatHarness(pool, { model: revenueModel(["AAA"]) }).run({ threadId, userId: IDS.owner, userIntent: "Revenue for AAA" })).events);
  const chat = await certified(db, await runFor(db, threadId), "a_out");

  // Analyze: the revenue-trend section's latest annual revenue.
  const templateId = (await db.query(
    `insert into analyze_templates (user_id, name, prompt_template) values ($1, 'Parity memo', 'Analyze {subject}') returning template_id::text`,
    [IDS.owner],
  )).rows[0].template_id;
  const memo = await createMemoRun(db, pool, { templateId, playbookId: "earnings_quality" });
  await memo.publish();
  const analyze = await certified(db, await runFor(db, memo.runId), "revenue_trend_current");

  // Grid: the latest-revenue cell for AAA (row 0).
  const grid = await startRun(pool, { columns: [{ column_key: "latest_revenue" }] });
  assert.equal(cellsByPosition(await waitForRun(pool, grid.runId, settled))["0:c0"]!.status, "ok");
  const cell = await certified(db, await runFor(db, grid.runId), "o_c0_r0");

  // Thesis: the saved condition "annual revenue > 1".
  const agentId = randomUUID();
  await db.query(
    `insert into agents (agent_id, user_id, name, thesis, universe, cadence) values ($1, $2, 'Parity monitor', 'Legacy thesis', $3::jsonb, 'daily')`,
    [agentId, IDS.owner, JSON.stringify({ mode: "static", subject_refs: [{ kind: "issuer", id: IDS.issuerA }] })],
  );
  const [condition] = await assess(pool, await saveVersion(pool, agentId, 0, [revenueCondition("gt", "1")]), CUTOFF);
  const thesisRun = condition!.financial!.run_id;

  // Discovery: the approved criterion "annual revenue > 1" for the same company.
  const campaign = await setupFinancialCampaign(db, pool);
  const discoveryRun = (await campaign.evaluate()).get(REVENUE_ID)!.certified!.run_id;

  await t.test("chat, a memo section, and a grid cell certify the same as-reported value from the same disclosure", () => {
    for (const [surface, result] of Object.entries({ analyze, cell })) {
      assert.deepEqual(result.payload, chat.payload, `${surface} value`);
      assert.deepEqual(result.inputs, chat.inputs, `${surface} lineage`);
      assert.deepEqual([result.basis, result.unit_state, result.coverage, result.disposition], [chat.basis, chat.unit_state, chat.coverage, chat.disposition], surface);
    }
    assert.deepEqual([chat.basis, chat.coverage, chat.inputs.map((input) => input.fact_id)], ["as_reported", "complete", [IDS.original]]);
    // Allowed difference: Chat answers at the turn's own time; memo and grid pin theirs.
    assert.deepEqual([analyze.cutoff, cell.cutoff], [CUTOFF, CUTOFF]);
    assert.ok(chat.cutoff > CUTOFF);
  });

  await t.test("a thesis condition and a Discovery criterion saving the same rule certify the same value and verdict", async () => {
    for (const output of ["value", "predicate"]) {
      const thesis = await certified(db, thesisRun, output);
      const discovery = await certified(db, discoveryRun, output);
      assert.deepEqual(discovery, thesis, output);
    }
    const predicate = await certified(db, thesisRun, "predicate");
    assert.deepEqual([predicate.basis, predicate.cutoff, (predicate.payload as { outcome: boolean }).outcome], ["as_restated", CUTOFF, true]);
  });

  await t.test("the only difference between the two groups is the stated basis: the restated disclosure", async () => {
    const saved = await certified(db, thesisRun, "value");
    assert.deepEqual(saved.inputs.map((input) => input.fact_id), [IDS.restated]);
    assert.deepEqual(saved.inputs.map((input) => input.period), chat.inputs.map((input) => input.period), "the same fiscal period");
    assert.notDeepEqual(saved.payload, chat.payload, "a restatement changed the reported number");
  });
});
