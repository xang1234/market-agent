// Shared harness for the thesis financial-condition tests: a real engine
// database with an agent watching the seeded issuer and saved thesis versions.

import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import type { Client, Pool } from "pg";
import { connectedPool } from "../../../db/test/docker-pg.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { databaseUrl, engineDatabase, IDS } from "../../financial-engine/test/db-fixtures.ts";
import type { QueryExecutor } from "../src/agent-repo.ts";
import { evaluateFinancialThesisConditions } from "../src/financial-thesis-adapter.ts";
import { saveThesis } from "../src/thesis-repo.ts";
import type { ThesisCondition, ThesisMetricCheck, ThesisVersion } from "../src/thesis-types.ts";

export async function thesisDatabase(t: TestContext, prefix: string): Promise<{ db: Client; pool: Pool; agentId: string }> {
  const db = await engineDatabase(t, prefix);
  const pool = await connectedPool(t, databaseUrl(db));
  const agentId = randomUUID();
  await db.query(
    `insert into agents (agent_id, user_id, name, thesis, universe, cadence) values ($1, $2, 'Alpha monitor', 'Legacy thesis', $3::jsonb, 'daily')`,
    [agentId, IDS.owner, JSON.stringify({ mode: "static", subject_refs: [{ kind: "issuer", id: IDS.issuerA }] })],
  );
  return { db, pool, agentId };
}

/** A revenue condition on the FY value, exactly as a user would save it. */
export function revenueCondition(operator: ThesisMetricCheck["operator"], threshold: string, overrides: Partial<ThesisMetricCheck> = {}): ThesisCondition {
  return {
    condition_id: randomUUID(),
    statement: `Annual revenue stays ${operator} the saved level.`,
    falsifier: "Annual revenue moves to the other side of the saved level.",
    horizon: "12 months",
    metric: { metric_key: "revenue", unit: "currency", period_kind: "fiscal_y", operator, threshold, max_age_days: 730, ...overrides },
  };
}

export async function saveVersion(pool: Pool, agentId: string, expectedVersion: number, conditions: ThesisCondition[]): Promise<ThesisVersion> {
  return saveThesis(pool as unknown as QueryExecutor, {
    agent_id: agentId,
    user_id: IDS.owner,
    expected_version: expectedVersion,
    thesis: "Alpha's revenue base holds through the next cycle.",
    subject_ref: { kind: "issuer", id: IDS.issuerA },
    conditions,
  });
}

export function assess(pool: Pool, thesis: ThesisVersion, asOf: string, runKey: string = randomUUID()) {
  return evaluateFinancialThesisConditions({ pool, evidence: createEvidenceFinancialPort }, { user_id: IDS.owner, thesis, run_key: runKey, as_of: asOf });
}
