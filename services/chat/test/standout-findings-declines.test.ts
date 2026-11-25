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

test("a failed execution is an engine gap", () => {
  assert.deepEqual(declines("execution_error", "database_error"), ["engine_gap", "engine_gap", "engine_gap"]);
});

// The latest year is certified; a read of an earlier year failed, which is the only gap a ranking blocks on.
test("a blocked ranking beside a certified latest year is an engine gap, not an uncertified latest input", () => {
  const latest = { ...gapResult("out_operating_margin_y0", "missing", "missing_input"), disposition: "verified", presented: { kind: "value", text: "19.00%" } };
  const content = {
    labels: {},
    results: [latest, gapResult("out_operating_margin_extreme_highest", "blocked_dependency", "blocked_by_dependency")],
  } as unknown as FinancialAnswerContent;
  assert.equal((runDetectors(content, "AAA")[0] as { reason: string }).reason, "engine_gap");
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

test("get_findings declares every decline reason the detectors can return", async () => {
  const { DECLINE_WORDS } = await import("../src/standout-findings.ts");
  const { readFile } = await import("node:fs/promises");
  const registry = JSON.parse(await readFile(new URL("../../../spec/finance_research_tool_registry.json", import.meta.url), "utf8"));
  const declared = new Set<string>();
  const walk = (node: unknown, inFindings: boolean): void => {
    if (Array.isArray(node)) return node.forEach((child) => walk(child, inFindings));
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const here = inFindings || record.name === "get_findings";
    if (here && record.reason && typeof record.reason === "object" && Array.isArray((record.reason as { enum?: unknown }).enum)) {
      for (const value of (record.reason as { enum: string[] }).enum) declared.add(value);
    }
    for (const child of Object.values(record)) walk(child, here);
  };
  walk(registry, false);
  assert.deepEqual([...declared].sort(), Object.keys(DECLINE_WORDS).sort());
});
