// The thesis agent loop with verified numerical conditions: each run computes
// its conditions at its own cutoff, records the certified reference with the
// assessment, and an unchanged outcome is recorded again over the snapshot
// that already seals it, with no alert, even though the engine ran again.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createAgent, getAgent } from "../../agents/src/agent-repo.ts";
import { loadThesisHistory, saveThesis } from "../../agents/src/thesis-repo.ts";
import { UNCHECKED_REPLY, type ThesisLlm } from "../../agents/src/thesis-evaluator.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { inspectCommittedResult } from "../../financial-engine/src/inspection.ts";
import { databaseUrl, engineDatabase, IDS, seedReportedFact } from "../../financial-engine/test/db-fixtures.ts";
import { createThesisAgentLoopStages } from "../src/thesis-runtime.ts";
import { runClaimedAgentLoop } from "./claimed-agent-loop.ts";

test("thesis runtime with verified numerical conditions", { skip: !dockerAvailable(), timeout: 300_000 }, async (t) => {
  const db = await engineDatabase(t, "thesis-fin-runtime");
  const pool = await connectedPool(t, databaseUrl(db));
  const agent = await createAgent(db, {
    user_id: IDS.owner, name: "Alpha monitor", thesis: "Alpha's revenue base holds.", cadence: "daily",
    universe: { mode: "static", subject_refs: [{ kind: "issuer", id: IDS.issuerA }] },
  });
  const conditionId = randomUUID();
  const thesis = await saveThesis(db, {
    agent_id: agent.agent_id, user_id: IDS.owner, expected_version: 0, thesis: agent.thesis,
    subject_ref: { kind: "issuer", id: IDS.issuerA },
    conditions: [{
      condition_id: conditionId, statement: "Annual revenue stays above the saved level.", falsifier: "Annual revenue falls below the saved level.",
      horizon: "12 months", metric: { metric_key: "revenue", unit: "currency", period_kind: "fiscal_y", operator: "gt", threshold: "1", max_age_days: 730 },
    }],
  });
  const run = async () => {
    const fresh = (await getAgent(db, agent.agent_id))!;
    const runId = randomUUID();
    const stages = createThesisAgentLoopStages({
      db: pool, userId: IDS.owner, runId, agent: fresh, thesis,
      financial: { pool, evidence: createEvidenceFinancialPort },
      getModel: async () => { throw new Error("no model is needed for numerical conditions"); },
    });
    return runClaimedAgentLoop({ pool, agent_id: agent.agent_id, run_id: runId, current_watermarks: fresh.watermarks, stages });
  };

  await run();
  let history = await loadThesisHistory(db, { agent_id: agent.agent_id, user_id: IDS.owner });
  assert.equal(history.assessments.length, 1);
  const [result] = history.assessments[0]!.results;
  // FY2023 is the latest filing in the fixture; at today's cutoff it is older than the saved 730 days.
  assert.deepEqual([result!.condition_id, result!.status], [conditionId, "unresolved"]);
  assert.match(result!.reason, /older than the saved maximum age/u);
  assert.ok(result!.financial?.certificate_digest, "the stale outcome is itself certified");
  assert.equal(history.assessments[0]!.model_version, null);

  await run();
  history = await loadThesisHistory(db, { agent_id: agent.agent_id, user_id: IDS.owner });
  assert.equal(history.assessments.length, 2, "each run records its own dated assessment");
  assert.equal(history.assessments[0]!.snapshot_id, history.assessments[1]!.snapshot_id, "an unchanged verified outcome reuses the sealed snapshot");
  assert.deepEqual(history.assessments[0]!.results, history.assessments[1]!.results);
  const findings = Number((await db.query(`select count(*)::int as n from findings where agent_id = $1`, [agent.agent_id])).rows[0].n);
  assert.equal(findings, 0, "no alert without a meaningful transition");
  const runs = Number((await db.query(`select count(*)::int as n from financial_runs where parent_id = $1`, [thesis.thesis_version_id])).rows[0].n);
  assert.equal(runs, 2, "each run computed at its own cutoff");
});

test("a narrative condition citing a figure reuses its assessment on unchanged evidence, though the engine numbers each run's results anew", { skip: !dockerAvailable(), timeout: 300_000 }, async (t) => {
  const db = await engineDatabase(t, "thesis-figure-reuse");
  const pool = await connectedPool(t, databaseUrl(db));
  const year = new Date().getUTCFullYear() - 1;
  await seedReportedFact(db, { metric_key: "revenue", value: "130497000000", fiscal_year: year });
  await seedReportedFact(db, { metric_key: "gross_profit", value: "97858000000", fiscal_year: year });
  const agent = await createAgent(db, {
    user_id: IDS.owner, name: "Margin monitor", thesis: "Alpha's gross margin holds.", cadence: "daily",
    universe: { mode: "static", subject_refs: [{ kind: "issuer", id: IDS.issuerA }] },
  });
  const conditionId = randomUUID();
  const thesis = await saveThesis(db, {
    agent_id: agent.agent_id, user_id: IDS.owner, expected_version: 0, thesis: agent.thesis,
    subject_ref: { kind: "issuer", id: IDS.issuerA },
    conditions: [{ condition_id: conditionId, statement: "Gross margin holds above 70 percent.", falsifier: "Gross margin falls below 70 percent.", horizon: "Next fiscal year" }],
  });
  let calls = 0;
  const llm: ThesisLlm = {
    async complete(input) {
      calls += 1;
      const { evidence } = JSON.parse(input.messages[1]!.content) as { evidence: { figures: Array<{ id: string; metric: string }> } };
      const margin = evidence.figures.find((figure) => figure.metric.startsWith("Gross margin"))!;
      return { text: JSON.stringify({ results: [{ condition_id: conditionId, status: "supported", refs: [margin.id] }] }), deployment: { channel: "test", model: "scripted" } };
    },
  };
  const run = async () => {
    const fresh = (await getAgent(db, agent.agent_id))!;
    const runId = randomUUID();
    const stages = createThesisAgentLoopStages({
      db: pool, userId: IDS.owner, runId, agent: fresh, thesis,
      financial: { pool, evidence: createEvidenceFinancialPort },
      getModel: async () => ({ llm, identity: "scripted" }),
    });
    return runClaimedAgentLoop({ pool, agent_id: agent.agent_id, run_id: runId, current_watermarks: fresh.watermarks, stages });
  };

  await run();
  await run();
  const history = await loadThesisHistory(db, { agent_id: agent.agent_id, user_id: IDS.owner });
  assert.equal(calls, 1, "the second run reads the same evidence, so it calls no model");
  assert.equal(history.assessments.length, 2);
  assert.deepEqual(history.assessments[0]!.results, history.assessments[1]!.results);
  const [figure] = history.assessments[0]!.results[0]!.figure_refs ?? [];
  assert.deepEqual({ ...figure, result_id: undefined }, { result_id: undefined, measure: "Gross margin (gross profit / revenue)", period: `FY${year} (ended ${year}-12-31)`, value: "74.99%" });
  assert.equal((await inspectCommittedResult(pool, IDS.owner, figure!.result_id))?.availability, "available", "the reused figure still opens its calculation");
});

test("a run that keeps results from two snapshots seals a new one holding every fact they cite", { skip: !dockerAvailable(), timeout: 300_000 }, async (t) => {
  const db = await engineDatabase(t, "thesis-two-kept-snapshots");
  const pool = await connectedPool(t, databaseUrl(db));
  const year = new Date().getUTCFullYear() - 1;
  const revenueFact = await seedReportedFact(db, { metric_key: "revenue", value: "130497000000", fiscal_year: year });
  const grossProfitFact = await seedReportedFact(db, { metric_key: "gross_profit", value: "97858000000", fiscal_year: year });
  const agent = await createAgent(db, {
    user_id: IDS.owner, name: "Two-line monitor", thesis: "Alpha's revenue and gross profit hold.", cadence: "daily",
    universe: { mode: "static", subject_refs: [{ kind: "issuer", id: IDS.issuerA }] },
  });
  const [revenueCondition, grossProfitCondition] = [randomUUID(), randomUUID()];
  const thesis = await saveThesis(db, {
    agent_id: agent.agent_id, user_id: IDS.owner, expected_version: 0, thesis: agent.thesis,
    subject_ref: { kind: "issuer", id: IDS.issuerA },
    conditions: [
      { condition_id: revenueCondition, statement: "Annual revenue holds near its level.", falsifier: "Annual revenue falls by a third.", horizon: "Next fiscal year" },
      { condition_id: grossProfitCondition, statement: "Gross profit holds near its level.", falsifier: "Gross profit falls by a third.", horizon: "Next fiscal year" },
    ],
  });
  const asked: string[][] = [];
  const citing = (metricFor: Record<string, string>): ThesisLlm => ({
    async complete(input) {
      const { conditions, evidence } = JSON.parse(input.messages[1]!.content) as { conditions: Array<{ condition_id: string }>; evidence: { figures: Array<{ id: string; metric: string }> } };
      asked.push(conditions.map((condition) => condition.condition_id));
      const ref = (id: string) => evidence.figures.find((figure) => figure.metric.trim() === metricFor[id])?.id ?? "F99";
      return { text: JSON.stringify({ results: conditions.map((condition) => ({ condition_id: condition.condition_id, status: "supported", refs: [ref(condition.condition_id)] })) }), deployment: { channel: "test", model: "scripted" } };
    },
  });
  const run = async (llm: ThesisLlm) => {
    const fresh = (await getAgent(db, agent.agent_id))!;
    const runId = randomUUID();
    const stages = createThesisAgentLoopStages({
      db: pool, userId: IDS.owner, runId, agent: fresh, thesis,
      financial: { pool, evidence: createEvidenceFinancialPort },
      getModel: async () => ({ llm, identity: "scripted" }),
    });
    return runClaimedAgentLoop({ pool, agent_id: agent.agent_id, run_id: runId, current_watermarks: fresh.watermarks, stages });
  };

  await run(citing({ [revenueCondition]: "Revenue" }));
  await run(citing({ [grossProfitCondition]: "Gross profit" }));
  // Runs that overlapped before #661 could leave each condition last checked in a different snapshot.
  await db.query(
    `update agent_thesis_assessments a
        set results = (select jsonb_agg(case when e.r->>'condition_id' = $1 then $2::jsonb else e.r end order by e.i)
                         from jsonb_array_elements(a.results) with ordinality as e(r, i))
      where a.assessed_at = (select max(assessed_at) from agent_thesis_assessments)`,
    [revenueCondition, JSON.stringify({ condition_id: revenueCondition, status: "unresolved", reason: UNCHECKED_REPLY, claim_refs: [], fact_refs: [], method: "unchecked_reply" })],
  );
  await run(citing({}));
  const [third, ...earlier] = (await loadThesisHistory(db, { agent_id: agent.agent_id, user_id: IDS.owner })).assessments;
  assert.equal(asked.length, 2, "the third run keeps each condition's checked result and calls no model");
  assert.deepEqual(third!.results.map((result) => [result.method, result.fact_refs]), [["model", [revenueFact]], ["model", [grossProfitFact]]]);
  assert.equal(new Set(earlier.map((assessment) => assessment.snapshot_id)).size, 2, "each earlier run sealed its own snapshot");
  assert.ok(!earlier.some((assessment) => assessment.snapshot_id === third!.snapshot_id), "neither snapshot seals both conditions' facts, so the run seals its own");
  const sealed = (await db.query<{ fact_refs: string[] }>(`select fact_refs from snapshots where snapshot_id = $1::uuid`, [third!.snapshot_id])).rows[0]!.fact_refs;
  assert.deepEqual([revenueFact, grossProfitFact].filter((fact) => !sealed.includes(fact)), [], "every cited fact is sealed in the run's snapshot");
});
