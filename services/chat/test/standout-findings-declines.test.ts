// How runDetectors names an engine gap it cannot state a finding over, read
// from published results alone (no database): each reason the engine can
// give maps to the decline that claims no more than the gap shows.

import assert from "node:assert/strict";
import test from "node:test";
import type { FinancialAnswerContent, GapDisposition, PresentedResult, ReasonCode } from "../../financial-core/src/index.ts";
import { runDetectors } from "../src/standout-findings.ts";

const gapResult = (output_id: string, disposition: GapDisposition, reason_code: ReasonCode): PresentedResult => ({
  result_id: `r_${output_id}`,
  output_id,
  disposition,
  subject_label_id: "s",
  measure_label_id: "m",
  period_label_id: "p",
  presented: { kind: "gap", text: "gap text", reason_code },
  result_hash: "0".repeat(64),
} as unknown as PresentedResult);

// Every detector's latest measure is the given gap; its rankings are absent.
const declines = (disposition: GapDisposition, reason: ReasonCode) => {
  const outputs = ["out_operating_margin_y0", "out_sbc_to_fcf_y0", "out_cash_conversion_y0"];
  const content = { labels: {}, results: outputs.map((id) => gapResult(id, disposition, reason)) } as unknown as FinancialAnswerContent;
  return runDetectors(content, "AAA").map((outcome) => ("reason" in outcome ? outcome.reason : "finding"));
};

test("a blocked latest year claims only that an input was not certified, never that a year has no value", () => {
  assert.deepEqual(declines("blocked_dependency", "blocked_by_dependency"), ["uncertified_input", "uncertified_input", "uncertified_input"]);
});

test("a failed execution is an engine gap whatever its reason code", () => {
  assert.deepEqual(declines("execution_error", "blocked_by_dependency"), ["engine_gap", "engine_gap", "engine_gap"]);
  assert.deepEqual(declines("execution_error", "database_error"), ["engine_gap", "engine_gap", "engine_gap"]);
});

test("a figure filed under another concept is a tag change", () => {
  assert.deepEqual(declines("incompatible", "incompatible_definition"), ["tag_change", "tag_change", "tag_change"]);
});

test("a reason no decline names is an engine gap", () => {
  assert.deepEqual(declines("incompatible", "incompatible_currency"), ["engine_gap", "engine_gap", "engine_gap"]);
});

test("a ranking that published no result is an engine gap", () => {
  const content = {
    labels: {},
    results: [{ ...gapResult("out_operating_margin_y0", "missing", "missing_input"), presented: { kind: "value", text: "19.00%" } }],
  } as unknown as FinancialAnswerContent;
  assert.equal((runDetectors(content, "AAA")[0] as { reason: string }).reason, "engine_gap");
});
