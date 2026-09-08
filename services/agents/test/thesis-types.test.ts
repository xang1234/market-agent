import assert from "node:assert/strict";
import test from "node:test";

import { parseThesisConditions, ThesisValidationError } from "../src/thesis-types.ts";

const CONDITION_ID = "11111111-1111-4111-8111-111111111111";

function validCondition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    condition_id: CONDITION_ID,
    statement: "Revenue growth remains above the peer group.",
    falsifier: "Reported growth falls below the peer median.",
    horizon: "12 months",
    ...overrides,
  };
}

test("parseThesisConditions returns validated narrative and metric conditions", () => {
  const input = [
    validCondition(),
    validCondition({
      condition_id: "22222222-2222-4222-8222-222222222222",
      metric: {
        metric_key: "revenue_growth_yoy",
        unit: "ratio",
        period_kind: "fiscal_q",
        operator: "gte",
        threshold: 0.15,
        max_age_days: 120,
      },
    }),
  ];

  assert.deepEqual(parseThesisConditions(input), input);
});

test("parseThesisConditions enforces condition count and unique UUIDs", () => {
  assert.throws(() => parseThesisConditions([]), ThesisValidationError);
  assert.throws(
    () => parseThesisConditions(Array.from({ length: 6 }, (_, index) => validCondition({
      condition_id: `${index + 1}1111111-1111-4111-8111-111111111111`,
    }))),
    /between 1 and 5/i,
  );
  assert.throws(
    () => parseThesisConditions([validCondition(), validCondition()]),
    /condition_id.*unique/i,
  );
  assert.throws(
    () => parseThesisConditions([validCondition({ condition_id: "not-a-uuid" })]),
    /condition_id.*UUID/i,
  );
});

test("parseThesisConditions enforces trimmed condition text and horizon bounds", () => {
  for (const [field, value] of [
    ["statement", " short "],
    ["statement", `x${"y".repeat(500)}`],
    ["falsifier", "too few"],
    ["horizon", " 12 months"],
    ["horizon", "x".repeat(121)],
  ] as const) {
    assert.throws(
      () => parseThesisConditions([validCondition({ [field]: value })]),
      new RegExp(field),
    );
  }

  assert.equal(
    parseThesisConditions([validCondition({ horizon: "x".repeat(120) })])[0]?.horizon.length,
    120,
  );
});

test("parseThesisConditions enforces the metric vocabulary and numeric bounds", () => {
  const baseMetric = {
    metric_key: "revenue_growth_yoy",
    unit: "ratio",
    period_kind: "fiscal_q",
    operator: "gte",
    threshold: 0.15,
    max_age_days: 120,
  };
  const invalidMetrics: Array<[string, Record<string, unknown>]> = [
    ["metric_key", { ...baseMetric, metric_key: "" }],
    ["unit", { ...baseMetric, unit: "x".repeat(101) }],
    ["period_kind", { ...baseMetric, period_kind: "calendar_q" }],
    ["operator", { ...baseMetric, operator: "eq" }],
    ["threshold", { ...baseMetric, threshold: Number.POSITIVE_INFINITY }],
    ["max_age_days", { ...baseMetric, max_age_days: 1.5 }],
    ["max_age_days", { ...baseMetric, max_age_days: 0 }],
    ["max_age_days", { ...baseMetric, max_age_days: 731 }],
  ];

  for (const [field, metric] of invalidMetrics) {
    assert.throws(
      () => parseThesisConditions([validCondition({ metric })]),
      new RegExp(field),
    );
  }
});
