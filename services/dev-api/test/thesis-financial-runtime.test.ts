// The thesis agent loop with verified numerical conditions: each run computes
// its conditions at its own cutoff, records the certified reference with the
// assessment, and an unchanged outcome is reused without a new assessment or
// alert even though the engine ran again.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createAgent, getAgent } from "../../agents/src/agent-repo.ts";
import { runAgentLoop } from "../../agents/src/agent-loop.ts";
import { loadThesisHistory, saveThesis } from "../../agents/src/thesis-repo.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { databaseUrl, engineDatabase, IDS } from "../../financial-engine/test/db-fixtures.ts";
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
  assert.equal(history.assessments.length, 1, "an unchanged verified outcome reuses the assessment");
  const findings = Number((await db.query(`select count(*)::int as n from findings where agent_id = $1`, [agent.agent_id])).rows[0].n);
  assert.equal(findings, 0, "no alert without a meaningful transition");
  const runs = Number((await db.query(`select count(*)::int as n from financial_runs where parent_id = $1`, [thesis.thesis_version_id])).rows[0].n);
  assert.equal(runs, 2, "each run computed at its own cutoff");
});
