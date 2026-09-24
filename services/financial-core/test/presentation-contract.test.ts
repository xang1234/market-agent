// The presentation contract: everything presentFinancialUnit can produce must
// satisfy the canonical block schema, and the web's financial_answer fixture is
// this generator's output, not a hand-maintained copy. Regenerate the fixture
// with `UPDATE_FIXTURES=1 node --experimental-strip-types --test
// test/presentation-contract.test.ts` after an intentional change.

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import type { FinancialPlanV1 } from "../src/contracts.ts";
import { presentationHash, presentFinancialUnit, type CommittedResult, type FinancialAnswerContent } from "../src/presentation.ts";
import { mutable, planFixture } from "./fixtures.ts";

const SCHEMA = JSON.parse(readFileSync(new URL("../../../spec/finance_research_block_schema.json", import.meta.url), "utf8"));
const WEB_FIXTURE = new URL("../../../web/src/blocks/financialAnswer.fixture.json", import.meta.url);
const HASH = "a".repeat(64);
const RUN_ID = "99999999-9999-4999-9999-999999999999";
const SNAPSHOT_ID = "11111111-1111-4111-9111-111111111111";

const uuid = (n: number) => `9${String(n).repeat(7)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-9${String(n).repeat(3)}-${String(n).repeat(12)}`;
const committed = (n: number, output_id: string, node_id: string, payload: unknown, disposition: CommittedResult["disposition"] = "computed"): CommittedResult =>
  ({ result_id: uuid(n), output_id, node_id, disposition, payload, result_hash: HASH });
const ratio = (value: string) => ({ kind: "value", value, unit: { kind: "ratio" }, exact: true, rounding: null });
const usd = (value: string) => ({ kind: "value", value, unit: { kind: "currency", currency: "USD" }, exact: true, rounding: null });
const missing = { kind: "gap", reason_code: "missing_input", explanation: "A required input or calculation is unavailable." };

function block(content: FinancialAnswerContent) {
  return {
    id: `financial-answer-${content.unit_id}`,
    kind: "financial_answer",
    snapshot_id: SNAPSHOT_ID,
    data_ref: { kind: "financial_answer", id: `${content.run_id}:${content.unit_id}` },
    source_refs: ["44444444-4444-4444-9444-444444444444"],
    as_of: "2024-01-16T04:59:59.999Z",
    presentation_hash: presentationHash(content),
    financial: content,
  };
}

/** Two companies, one gap, an incomplete ranking: the web fixture. */
function comparison(): FinancialAnswerContent {
  return presentFinancialUnit({
    plan: planFixture(), run_id: RUN_ID, unit_id: "section",
    subject_names: { a: "Apple Inc.", b: "Microsoft Corp." },
    results: [
      committed(1, "out_a_rev", "a_rev", usd("391035000000")),
      committed(2, "out_a_gm", "a_gm", ratio("0.46206")),
      committed(3, "out_b_gm", "b_gm", missing, "missing"),
      committed(4, "out_check", "a_gm_check", { kind: "predicate", predicate: "threshold", comparison: "gte", outcome: true }),
      committed(5, "out_rank", "gm_rank", { kind: "ranking", direction: "highest", population: { requested: 2, evaluated: 1 }, complete: false, ranks: [{ node_id: "a_gm", rank: 1 }], extreme: null }),
    ],
  });
}

/** One company over two periods with a complete two-member ranking elsewhere: series and scalars. */
function series(): FinancialAnswerContent {
  const plan = mutable(planFixture()) as FinancialPlanV1;
  plan.subjects = { ...plan.subjects, requested_count: 1, resolved_count: 1, members: [plan.subjects.members[0]!] };
  plan.operations = [
    { node_id: "rev23", operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "a", metric_key: "revenue", period: { kind: "fiscal_period", fiscal_year: 2023, fiscal_period: "FY" } },
    { node_id: "rev22", operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "a", metric_key: "revenue", period: { kind: "fiscal_period", fiscal_year: 2022, fiscal_period: "FY" } },
    { node_id: "growth", operation: "percent_change_positive_base", operation_version: "percent_change_positive_base.v1", current: "rev23", prior: "rev22" },
  ];
  plan.outputs = [
    { output_id: "o22", node_id: "rev22", unit_id: "section" },
    { output_id: "o23", node_id: "rev23", unit_id: "section" },
    { output_id: "og", node_id: "growth", unit_id: "section" },
  ];
  plan.thresholds = [];
  return presentFinancialUnit({
    plan, run_id: RUN_ID, unit_id: "section", subject_names: { a: "Apple Inc." },
    results: [committed(6, "o22", "rev22", usd("100")), committed(7, "o23", "rev23", usd("125")), committed(8, "og", "growth", { kind: "value", value: "25", unit: { kind: "percent" }, exact: true, rounding: null })],
  });
}

function validator() {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  ajv.addSchema(SCHEMA);
  const validate = ajv.getSchema(`${SCHEMA.$id}#/$defs/Block`)!;
  return (value: unknown, label: string) => assert.ok(validate(value), `${label}: ${JSON.stringify(validate.errors?.slice(0, 3))}`);
}

test("every presentation shape the generator produces satisfies the canonical block schema", () => {
  const valid = validator();
  valid(block(comparison()), "table, gap, predicate, incomplete ranking");
  valid(block(series()), "series and scalar");
});

test("the web financial_answer fixture is the generator's output", () => {
  const expected = `${JSON.stringify(block(comparison()), null, 2)}\n`;
  if (process.env.UPDATE_FIXTURES === "1") writeFileSync(WEB_FIXTURE, expected);
  assert.equal(readFileSync(WEB_FIXTURE, "utf8"), expected, "regenerate with UPDATE_FIXTURES=1");
});
