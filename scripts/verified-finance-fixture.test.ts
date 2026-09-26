import assert from "node:assert/strict";
import test from "node:test";

import { evaluateBoundPlan, type GraphEvaluation } from "../services/financial-core/src/index.ts";
import { selectInput } from "../services/financial-engine/src/select-inputs.ts";
import { verifyFinancialUnit } from "../services/snapshot/src/financial-verifier.ts";
import { SEAL_CONTEXT } from "../services/snapshot/test/financial-fixtures.ts";
import {
  COMPUTATION_CASES,
  MUTANTS,
  runGoldenCases,
  runMutationSuite,
  SELECTION_CASES,
  type EngineUnderTest,
  type GoldenCategory,
  type MutantKind,
} from "./verified-finance-fixtures.ts";

const PRODUCTION: EngineUnderTest = { evaluate: evaluateBoundPlan, select: selectInput };
const productionVerifier = (records: Parameters<typeof verifyFinancialUnit>[0]) => verifyFinancialUnit(records, "section", SEAL_CONTEXT).ok;

const failed = (engine: EngineUnderTest) => runGoldenCases(engine).filter((result) => !result.passed).map((result) => result.id);

test("the golden cases cover every reviewed rule the release gate names", () => {
  const categories = new Set<GoldenCategory>([...COMPUTATION_CASES, ...SELECTION_CASES].map((golden) => golden.category));
  assert.deepEqual([...categories].sort(), [
    "calendar_53_week", "date_only_uncertainty", "exact_source_token", "negative_base", "partial_cohort",
    "precision_limit", "public_versus_ingestion", "restatement", "zero_denominator",
  ]);
});

test("production matches the independent oracle on every golden case", () => {
  for (const result of runGoldenCases(PRODUCTION)) assert.ok(result.passed, `${result.id}: ${result.mismatches.join("; ")}`);
});

test("an engine that only ever declares gaps fails the valid golden cases", () => {
  const gapsOnly: EngineUnderTest = {
    evaluate: (plan, bindings) => {
      const evaluation = evaluateBoundPlan(plan, bindings);
      return { ...evaluation, outputs: evaluation.outputs.map((output) => ({ ...output, state: { status: "gap", disposition: "missing", reason_code: "missing_input", explanation: "", cause: "evidence" } })) } as GraphEvaluation;
    },
    select: () => ({ status: "gap", reason_code: "missing_input" }),
  };
  const expectsOnlyGaps = [
    ...COMPUTATION_CASES.filter((golden) => Object.values(golden.expected).every((expected) => expected.kind === "gap")),
    ...SELECTION_CASES.filter((golden) => "gap" in golden.expected),
  ].map((golden) => golden.id);
  const caught = new Set(failed(gapsOnly));
  for (const golden of [...COMPUTATION_CASES, ...SELECTION_CASES]) {
    if (!expectsOnlyGaps.includes(golden.id)) assert.ok(caught.has(golden.id), `${golden.id} passed an engine that computes nothing`);
  }
});

test("a rounding, restatement, or timing defect is caught", () => {
  // Off by one unit in the last kept digit on every inexact division.
  const offByOne: EngineUnderTest = {
    ...PRODUCTION,
    evaluate: (plan, bindings) => {
      const evaluation = evaluateBoundPlan(plan, bindings);
      return {
        ...evaluation,
        outputs: evaluation.outputs.map((output) => output.state.status === "computed" && output.state.payload.kind === "value" && !output.state.payload.exact
          ? { ...output, state: { ...output.state, payload: { ...output.state.payload, value: output.state.payload.value.replace(/\d$/u, (digit) => String((Number(digit) + 1) % 10)) } } }
          : output),
      } as GraphEvaluation;
    },
  };
  assert.ok(failed(offByOne).some((id) => id.startsWith("margin-precision")));

  // Always prefers the newest disclosure public by the cutoff, whatever the basis.
  const latestAlways: EngineUnderTest = { ...PRODUCTION, select: (node, candidates, policy) => selectInput(node, candidates, { ...policy, reporting_basis: "as_restated" }) };
  assert.deepEqual(failed(latestAlways), ["restatement-as-reported"]);

  // Treats a date-only proof as public from the start of its day.
  const eagerDates: EngineUnderTest = {
    ...PRODUCTION,
    select: (node, candidates, policy) => selectInput(node, candidates.map((candidate) => ({
      ...candidate,
      publication: candidate.publication.map((proof) => ({ ...proof, timing: { ...proof.timing, timing_precision: "instant" as const } })),
    })), policy),
  };
  assert.deepEqual(failed(eagerDates), ["date-only-same-day"]);
});

test("the verifier rejects every mutant, and the mutants cover every tampering the gate names", () => {
  assert.deepEqual([...new Set(MUTANTS.map((mutant) => mutant.kind))].sort(), [
    "cutoff", "definition", "numeric_result", "peer_count", "period", "unit", "word_only_claim",
  ] satisfies MutantKind[]);
  const report = runMutationSuite(productionVerifier);
  assert.equal(report.baseline_verified, true);
  assert.deepEqual(report.mutants.filter((mutant) => !mutant.rejected).map((mutant) => mutant.id), []);
  assert.equal(report.passed, true);
});

test("a verifier that rejects everything, or accepts everything, fails the gate", () => {
  const rejectsAll = runMutationSuite(() => false);
  assert.deepEqual([rejectsAll.baseline_verified, rejectsAll.passed], [false, false]);
  const acceptsAll = runMutationSuite(() => true);
  assert.equal(acceptsAll.passed, false);
  assert.equal(acceptsAll.mutants.filter((mutant) => !mutant.rejected).length, MUTANTS.length);
});
