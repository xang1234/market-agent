import assert from "node:assert/strict";
import test from "node:test";

import type { QueryExecutor } from "../../agents/src/agent-repo.ts";
import { evaluateThesisMetrics } from "../../agents/src/thesis-evaluator.ts";
import type { ThesisVersion } from "../../agents/src/thesis-types.ts";
import { loadThesisPacket } from "../src/thesis-evidence.ts";

const ISSUER = "20000000-0000-4000-8000-000000000001";
const HIGH_PRECISION_FACT = "30000000-0000-4000-8000-000000000001";
const UNSAFE_INTEGER_FACT = "30000000-0000-4000-8000-000000000002";

test("loadThesisPacket preserves PostgreSQL numeric text through exact metric evaluation", async () => {
  const statements: string[] = [];
  const db: QueryExecutor = {
    async query(text) {
      statements.push(text);
      if (!text.includes("jsonb_to_recordset($2::jsonb) requested")) return { rows: [] } as never;

      // Faithfully emulate the existing PostgreSQL projection: numeric::float8
      // truncates the boundary fact and rounds the unsafe integer before it
      // reaches the shared evaluator. The text projection must retain both.
      const exactTextProjection = text.includes("f.value_num::text as value_num")
        && text.includes("f.scale::text as scale");
      return {
        rows: [
          fact({
            fact_id: HIGH_PRECISION_FACT,
            metric_key: "margin_ratio",
            value_num: exactTextProjection ? "0.1000000000000000000001" : 0.1,
            scale: exactTextProjection ? "3" : 3,
            unit: "ratio",
          }),
          fact({
            fact_id: UNSAFE_INTEGER_FACT,
            metric_key: "enterprise_value",
            value_num: exactTextProjection ? "9007199254740993" : Number("9007199254740993"),
            scale: exactTextProjection ? "1" : 1,
            unit: "USD",
          }),
        ],
      } as never;
    },
  };

  const packet = await loadThesisPacket(db, {
    thesis: thesisVersion(),
    userId: "10000000-0000-4000-8000-000000000001",
    asOf: "2026-09-22T00:00:00.000Z",
  });
  const results = evaluateThesisMetrics(thesisVersion().conditions, packet.facts, "2026-09-22T00:00:00.000Z");

  assert.deepEqual(results.map((result) => result.status), ["challenged", "supported"]);
  assert.deepEqual(packet.facts.map((row) => [row.value_num, row.scale]), [
    ["0.1000000000000000000001", "3"],
    ["9007199254740993", "1"],
  ]);
  const factQuery = statements.find((statement) => statement.includes("jsonb_to_recordset($2::jsonb) requested")) ?? "";
  assert.match(factQuery, /f\.value_num::text as value_num/);
  assert.match(factQuery, /f\.scale::text as scale/);
  assert.doesNotMatch(factQuery, /(?:value_num|scale)::float8/);
  assert.match(factQuery, /f\.value_num is not null/);
  assert.match(factQuery, /f\.value_num not in \('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric\)/);
});

function thesisVersion(): ThesisVersion {
  return {
    thesis_version_id: "40000000-0000-4000-8000-000000000001",
    agent_id: "50000000-0000-4000-8000-000000000001",
    version: 1,
    thesis: "Exact numeric facts determine the monitored thesis result.",
    subject_ref: { kind: "issuer", id: ISSUER },
    created_at: "2026-09-01T00:00:00.000Z",
    conditions: [
      {
        condition_id: "60000000-0000-4000-8000-000000000001",
        statement: "Margin remains at or below the exact limit.",
        falsifier: "Margin exceeds the exact limit.",
        horizon: "Next quarter",
        metric: { metric_key: "margin_ratio", unit: "ratio", period_kind: "point", operator: "lte", threshold: "0.3", max_age_days: 30 },
      },
      {
        condition_id: "60000000-0000-4000-8000-000000000002",
        statement: "Enterprise value remains at the precise threshold.",
        falsifier: "Enterprise value differs from the precise threshold.",
        horizon: "Next quarter",
        metric: { metric_key: "enterprise_value", unit: "USD", period_kind: "point", operator: "eq", threshold: "9007199254740993", max_age_days: 30 },
      },
    ],
  };
}

function fact(input: { fact_id: string; metric_key: string; value_num: number | string; scale: number | string; unit: string }) {
  return {
    ...input,
    period_kind: "point",
    period_end: null,
    period_start: null,
    fiscal_year: null,
    fiscal_period: null,
    as_of: "2026-09-21T00:00:00.000Z",
    source_id: "70000000-0000-4000-8000-000000000001",
    confidence: 1,
    trust_tier: "primary",
  };
}
