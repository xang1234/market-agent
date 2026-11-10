// Net cash and total debt (ADR 0006, #602): cash and securities less debt, and
// the debt alone, over one 10-K's balance sheet.

import assert from "node:assert/strict";
import test from "node:test";
import { presentFinancialUnit } from "../src/presentation.ts";
import { aapl, AAPL, balance, balancePlan, gapOf, plan, publish, USD, valueOf, type Node } from "./balance-fixtures.ts";

test("AAPL FY2026: net cash is 56,824,000,000 and total debt 80,111,000,000, exactly", () => {
  const results = publish();
  assert.deepEqual(results.net_cash!.payload, { kind: "value", value: "56824000000", unit: USD, exact: true, rounding: null });
  assert.deepEqual(results.total_debt!.payload, { kind: "value", value: "80111000000", unit: USD, exact: true, rounding: null });
});

test("a component the 10-K does not report is left out of the sum, never read as a number", () => {
  // Without the noncurrent securities, 136.935B − 80.213B of cash and securities less 80.111B of debt.
  assert.equal(valueOf(publish(aapl({ marketable_securities_noncurrent: "missing_input" })).net_cash), "-23389000000");
  assert.equal(valueOf(publish(aapl({ short_term_borrowings: "missing_input", commercial_paper: "missing_input" })).total_debt), "78114000000");
});

test("a component that is reported but unusable, or unread, blocks the figure instead of being left out", () => {
  for (const reason of ["ineligible_input", "context_unverified", "restatement_unverified", "conflicting_evidence", "database_error"] as const) {
    const results = publish(aapl({ marketable_securities_noncurrent: reason, long_term_debt_current: reason }));
    assert.deepEqual([gapOf(results.net_cash), gapOf(results.total_debt)], [["blocked_dependency", "blocked_by_dependency"], ["blocked_dependency", "blocked_by_dependency"]], reason);
  }
});

test("no cash and equivalents is a missing input for net cash; total debt still computes", () => {
  const results = publish(aapl({ cash_and_equivalents: "missing_input" }));
  assert.deepEqual(gapOf(results.net_cash), ["missing", "missing_input"]);
  assert.equal(valueOf(results.total_debt), "80111000000");
});

test("no debt key at all is a missing input for both, never zero debt", () => {
  const results = publish(aapl({}, { cash_and_equivalents: "36305000000", marketable_securities_current: "20417000000" }));
  assert.deepEqual([gapOf(results.net_cash), gapOf(results.total_debt)], [["missing", "missing_input"], ["missing", "missing_input"]]);
});

test("short-term investments or current debt securities beside current marketable securities is conflicting evidence, not a sum", () => {
  for (const overlap of ["short_term_investments", "debt_securities_current"]) {
    const results = publish(aapl({ [overlap]: balance(overlap, "1000000000") }));
    assert.deepEqual(gapOf(results.net_cash), ["incompatible", "conflicting_evidence"], overlap);
    assert.equal(valueOf(results.total_debt), "80111000000", overlap);
  }
  // Without current marketable securities, the two are distinct lines and add.
  const distinct = publish(aapl({}, { cash_and_equivalents: "100", short_term_investments: "10", debt_securities_current: "5", long_term_debt_noncurrent: "50" }));
  assert.equal(valueOf(distinct.net_cash), "65");
});

test("a component from another filing or another balance-sheet date is an incompatible period", () => {
  const otherFiling = publish(aapl({ commercial_paper: balance("commercial_paper", "1997000000", { source_id: "99999999-9999-4999-8999-999999999999" }) }));
  assert.deepEqual([gapOf(otherFiling.net_cash), gapOf(otherFiling.total_debt)], [["incompatible", "incompatible_period"], ["incompatible", "incompatible_period"]]);
  const otherDate = publish(aapl({ cash_and_equivalents: balance("cash_and_equivalents", "29943000000", { end: "2025-09-27" }) }));
  assert.deepEqual(gapOf(otherDate.net_cash), ["incompatible", "incompatible_period"]);
  assert.equal(valueOf(otherDate.total_debt), "80111000000");
});

test("a quarter's balance sheet is not a 10-K's: net cash v1 is a fiscal year-end figure", () => {
  const quarter = { end: "2026-06-27", fiscal_period: "Q3" as const };
  const inputs = Object.fromEntries(Object.entries(AAPL).map(([key, value]) => [key, balance(key, value, quarter)]));
  const results = publish(aapl(inputs));
  assert.deepEqual([gapOf(results.net_cash), gapOf(results.total_debt)], [["unsupported", "unsupported_period"], ["unsupported", "unsupported_period"]]);
});

test("components in another currency do not add, and a negative balance is not one", () => {
  const euro = publish(aapl({ commercial_paper: balance("commercial_paper", "1997000000", { unit: { kind: "currency", currency: "EUR" } }) }));
  assert.deepEqual(gapOf(euro.net_cash), ["incompatible", "incompatible_currency"]);
  const negative = publish(aapl({ long_term_debt_current: balance("long_term_debt_current", "-9906000000") }));
  assert.deepEqual([gapOf(negative.net_cash), gapOf(negative.total_debt)], [["incompatible", "incompatible_definition"], ["incompatible", "incompatible_definition"]]);
});

test("the answer labels net cash so a net debt reads as negative net cash", () => {
  const built = plan();
  const results = Object.values(publish(aapl({}, { cash_and_equivalents: "10000000000", long_term_debt_noncurrent: "30000000000" })))
    .map((result) => ({ ...result, result_id: `r_${result.output_id}` }));
  const content = presentFinancialUnit({ plan: built, run_id: "run", unit_id: "balance", results, subject_names: { a: "Apple Inc." }, periods: new Map() });
  assert.deepEqual(content.results.map((result) => [content.labels[result.measure_label_id]!.text, result.presented.kind === "value" && result.presented.full_text]), [
    ["Net cash (cash and securities less debt)", "USD -20000000000"],
    ["Total debt (long-term debt, commercial paper and short-term borrowings)", "USD 30000000000"],
  ]);
});

test("a plan wires every component to that company's balance of that key, for one fiscal year", () => {
  const issues = (edit: (operations: Node[]) => Node[]) => {
    const validated = balancePlan(edit);
    return validated.ok ? [] : validated.issues.map((issue) => issue.code);
  };
  const retarget = (key: string, change: Partial<Node>) => (operations: Node[]) => operations.map((node) => node.node_id === key ? { ...node, ...change } : node);
  assert.deepEqual(issues((operations) => operations), []);
  assert.deepEqual(issues(retarget("commercial_paper", { metric_key: "total_liabilities" })), ["invalid_balance_component", "invalid_balance_component"]);
  assert.deepEqual(issues(retarget("commercial_paper", { period: { kind: "fiscal_period", fiscal_year: 2025, fiscal_period: "FY" } })), ["invalid_balance_component", "invalid_balance_component"]);
  assert.deepEqual(issues(retarget("cash_and_equivalents", { period: { kind: "latest", period_type: "quarterly", offset: 0 } })), ["invalid_balance_component"]);
  const latestYear = (operations: Node[]) => operations.map((node) => node.operation === "reported_metric" ? { ...node, period: { kind: "latest", period_type: "annual", offset: 0 } } : node);
  assert.deepEqual(issues(latestYear), []);
});
