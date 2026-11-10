import assert from "node:assert/strict";
import test from "node:test";

import { assembleCall, type CallContent } from "../services/financial-core/src/index.ts";
import { AAPL, buildCallReport, CALL_CASES, scoreCall } from "./call-eval.ts";

test("every generated Call passes its rubric, and no factual answer on file says stance wording", () => {
  const report = buildCallReport();
  assert.deepEqual(report.cases.filter((entry) => entry.failures.length > 0), []);
  assert.equal(report.passed, true);
  assert.deepEqual(report.stance_leaks, []);
  assert.equal(report.factual_answers, 6);
  assert.deepEqual(
    report.cases.filter((entry) => ["aapl", "nvda-free-cash-flow-blocked", "stale-price"].includes(entry.id)).map((entry) => [entry.id, entry.rule]),
    [["aapl", 1], ["nvda-free-cash-flow-blocked", 0], ["stale-price", 0]],
  );
});

test("AAPL is a full declined Call with required growth at today's multiple", () => {
  const call = assembleCall(AAPL);
  assert.deepEqual([call.assumptions[1]!.figure.text, call.requires[0]!.figure.text, call.stance.rule], ["36.15x", "7.3% a year", 1]);
});

test("the rubric fails a Call that breaks each check", () => {
  const call = assembleCall(AAPL);
  const expected = CALL_CASES[0]!;
  const broken = (change: Partial<CallContent>) => scoreCall({ ...call, ...change }, expected).map((failure) => failure.split(":")[0]);
  assert.deepEqual(broken({ stance: { ...call.stance, reasons: [{ cites: "hurdle_price" as never, text: "x" }] } }), ["reasons_cite_rows", "declines_when_required"]);
  assert.deepEqual(broken({ assumptions: call.assumptions.map((row) => row.id === "share_change" ? { ...row, basis: "SBC over market cap" } : row) }), ["rows_labelled"]);
  assert.deepEqual(broken({ facts: call.facts.map((row) => row.id === "net_cash" ? { ...row, basis: " " } : row) }), ["rows_labelled"]);
  assert.deepEqual(broken({ facts: call.facts.map((row) => row.id === "share_price" ? { ...row, citations: [] } : row) }), ["rows_labelled"]);
  assert.deepEqual(broken({ stance: { ...call.stance, rule: 0 } }), ["declines_when_required"]);
  assert.deepEqual(broken({ stance: { ...call.stance, text: "Clears your hurdle." } }), ["no_advice_wording"]);
  assert.deepEqual(broken({ stance: { ...call.stance, text: "Upside to the price." } }), ["no_advice_wording"]);
});

test("stance wording in a factual answer fails the eval", () => {
  const report = buildCallReport(CALL_CASES, { revenue: "Revenue was USD 1. It is near your hurdle." });
  assert.deepEqual([report.passed, report.stance_leaks], [false, ["revenue"]]);
});
