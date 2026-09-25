import assert from "node:assert/strict";
import test from "node:test";
import { validateAnalystOutput } from "../src/assessment-validation.ts";
import { assertApprovedBrief, numericalCriteria } from "../src/financial-criteria.ts";
import { parseBrief } from "../src/validation.ts";
import { analystFixture, packetFixture } from "./fixtures.ts";
import { MARGIN_ID, NARRATIVE_ID, numericalBrief, REVENUE_ID } from "./financial-fixtures.ts";

test("numerical criteria are exactly the approved brief's structured metric rules", () => {
  const brief = parseBrief(numericalBrief());
  assert.deepEqual(numericalCriteria(brief).map((criterion) => [criterion.criterion_id, criterion.importance, criterion.metric.metric_key, criterion.metric.threshold]), [
    [REVENUE_ID, "must", "revenue", "1"],
    [MARGIN_ID, "prefer", "gross_profit", "1"],
  ]);
});

test("prose that mentions a threshold stays a narrative criterion", () => {
  const brief = numericalBrief();
  brief.criteria[0] = { ...brief.criteria[0]!, statement: "Annual revenue exceeds $1,000,000,000 per the latest filing." };
  assert.ok(!numericalCriteria(parseBrief(brief)).some((criterion) => criterion.criterion_id === NARRATIVE_ID));
});

test("a model role cannot add or change a numerical threshold", () => {
  const brief = parseBrief(numericalBrief());
  const packet = packetFixture();
  const criteria = (extra: Record<string, unknown> = {}) => brief.criteria.map((criterion) => ({
    criterion_id: criterion.criterion_id, outcome: "unknown", explanation: "Not established.", citations: [], ...extra,
  }));
  const output = (overrides: Record<string, unknown>) => ({ ...analystFixture(), ...overrides });
  assert.ok(validateAnalystOutput(output({ criteria: criteria() }), brief, packet), "the brief's own criteria validate");
  for (const extra of [{ metric: brief.criteria[1]!.metric }, { threshold: "0.5" }, { certified: { run_id: crypto.randomUUID() } }]) {
    assert.throws(() => validateAnalystOutput(output({ criteria: criteria(extra) }), brief, packet), /not allowed|unknown|unsupported/iu, JSON.stringify(extra));
  }
  const invented = [...criteria(), { criterion_id: crypto.randomUUID(), outcome: "pass", explanation: "Revenue above 1B.", citations: [] }];
  assert.throws(() => validateAnalystOutput(output({ criteria: invented }), brief, packet), /every criterion exactly once|unsupported/iu);
});

test("numerical criteria are evaluated only for an approved brief version", () => {
  assert.throws(() => assertApprovedBrief({ approved_at: null } as never), /approved brief/u);
  assert.doesNotThrow(() => assertApprovedBrief({ approved_at: "2026-09-10T00:00:00.000Z" } as never));
});
