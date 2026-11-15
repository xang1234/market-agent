// The thesis agent loop with verified numerical conditions: each run computes
// its conditions at its own cutoff, records the certified reference with the
// assessment, and an unchanged outcome is recorded again over the snapshot
// that already seals it, with no alert, even though the engine ran again.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createAgent, getAgent } from "../../agents/src/agent-repo.ts";
import { runAgentLoop } from "../../agents/src/agent-loop.ts";
import { loadThesisHistory, saveThesis } from "../../agents/src/thesis-repo.ts";
import type { ThesisLlm } from "../../agents/src/thesis-evaluator.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { inspectCommittedResult } from "../../financial-engine/src/inspection.ts";
import { databaseUrl, engineDatabase, IDS, seedReportedFact } from "../../financial-engine/test/db-fixtures.ts";
import { createThesisAgentLoopStages } from "../src/thesis-runtime.ts";

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
    const stages = createThesisAgentLoopStages({
      db: pool, userId: IDS.owner, runId: randomUUID(), agent: fresh, thesis,
      financial: { pool, evidence: createEvidenceFinancialPort },
      getModel: async () => { throw new Error("no model is needed for numerical conditions"); },
    });
    return runAgentLoop({ pool, agent_id: agent.agent_id, current_watermarks: fresh.watermarks, stages });
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
    const stages = createThesisAgentLoopStages({
      db: pool, userId: IDS.owner, runId: randomUUID(), agent: fresh, thesis,
      financial: { pool, evidence: createEvidenceFinancialPort },
      getModel: async () => ({ llm, identity: "scripted" }),
    });
    return runAgentLoop({ pool, agent_id: agent.agent_id, current_watermarks: fresh.watermarks, stages });
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
