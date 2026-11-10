// Net cash and total debt (ADR 0006, #602): cash and securities less debt, and
// the debt alone, over one 10-K's balance sheet. AAPL's FY2026 10-K
// (accession 0000320193-26-000026, 2026-09-26) reports cash 36.305B,
// marketable securities 20.417B current and 80.213B noncurrent, commercial
// paper 1.997B and long-term debt 9.906B current and 68.208B noncurrent.

import assert from "node:assert/strict";
import test from "node:test";
import { hashCanonical } from "../src/canonical.ts";
import type { BoundFinancialInputV1, FinancialPlan, LocalId, PeriodSelector, ReasonCode } from "../src/contracts.ts";
import { evaluateBoundPlan, nodeLineageHashes, unitPublication, type ExpectedResult, type SlotBinding } from "../src/bound-evaluation.ts";
import { presentFinancialUnit } from "../src/presentation.ts";
import { validateFinancialPlan } from "../src/validate.ts";
import { planFixture } from "./fixtures.ts";
import { boundInput, SLOTS, type InputSpec } from "./operand-fixtures.ts";

const CASH = ["cash_and_equivalents", "marketable_securities_current", "marketable_securities_noncurrent", "short_term_investments", "debt_securities_current"];
const DEBT = ["long_term_debt_current", "long_term_debt_noncurrent", "commercial_paper", "short_term_borrowings"];
const FY2026: PeriodSelector = { kind: "fiscal_period", fiscal_year: 2026, fiscal_period: "FY" };
const USD = { kind: "currency", currency: "USD" };
const DIGEST = "c".repeat(64);

type Node = Record<string, unknown> & { node_id: string };

function balancePlan(edit: (operations: Node[]) => Node[] = (operations) => operations) {
  const reported = (key: string): Node => ({ node_id: key, operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "a", metric_key: key, period: FY2026 });
  const wired = (keys: string[]) => Object.fromEntries(keys.map((key) => [key, key]));
  const operations = edit([
    ...[...CASH, ...DEBT].map(reported),
    { node_id: "net_cash", operation: "net_cash", operation_version: "net_cash.v1", ...wired([...CASH, ...DEBT]) },
    { node_id: "total_debt", operation: "total_debt", operation_version: "total_debt.v1", ...wired(DEBT) },
  ]);
  return validateFinancialPlan({
    ...planFixture(),
    subjects: { membership: "explicit", requested_count: 1, resolved_count: 1, omitted_count: 0, members: [SLOTS.a] },
    time: { knowledge_cutoff: "2026-11-09T23:59:59.999-05:00", cutoff_timezone: "America/New_York", time_mode: "public_information" },
    metric_definitions: [...new Set(operations.flatMap((node) => typeof node.metric_key === "string" ? [node.metric_key] : []))].map((key) => ({ metric_key: key, definition_version: `${key}.v1` })),
    operations,
    outputs: ["net_cash", "total_debt"].map((node) => ({ output_id: node, node_id: node, unit_id: "balance" })),
    publication_units: [{ unit_id: "balance", kind: "chat_section" }],
    thresholds: [],
  });
}

function plan(): FinancialPlan {
  const validated = balancePlan();
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

const balance = (metric: string, value: string, extra: Partial<InputSpec> = {}) =>
  boundInput({ metric, value, kind: "instant", end: "2026-09-26", fiscal_year: 2026, fiscal_period: "FY", ...extra });

const AAPL: Record<string, string> = {
  cash_and_equivalents: "36305000000",
  marketable_securities_current: "20417000000",
  marketable_securities_noncurrent: "80213000000",
  commercial_paper: "1997000000",
  long_term_debt_current: "9906000000",
  long_term_debt_noncurrent: "68208000000",
};

type Inputs = Record<string, BoundFinancialInputV1 | ReasonCode>;

/** Each component's binding: the given input or gap, else AAPL's figure, else no figure at all. */
function aapl(inputs: Inputs = {}, values: Record<string, string> = AAPL): Inputs {
  return Object.fromEntries([...CASH, ...DEBT].map((key) => [key, inputs[key] ?? (values[key] === undefined ? "missing_input" : balance(key, values[key]!))]));
}

function publish(inputs: Inputs = aapl()): Record<string, ExpectedResult> {
  const bindings = new Map<LocalId, SlotBinding>(Object.entries(inputs).map(([slot, input]) => [slot, typeof input === "string"
    ? { status: "gap", reason_code: input, candidate_set_digest: DIGEST }
    : { status: "bound", input, payload_hash: hashCanonical("bound_input", input), candidate_set_digest: DIGEST }]));
  const built = plan();
  const evaluation = evaluateBoundPlan(built, bindings);
  const publication = unitPublication(built, evaluation, nodeLineageHashes(built, evaluation, bindings), "balance");
  return Object.fromEntries(publication.results.map((result) => [result.output_id, result]));
}

function valueOf(result: ExpectedResult | undefined): string {
  assert.ok(result?.payload.kind === "value", JSON.stringify(result));
  return result.payload.value;
}

function gapOf(result: ExpectedResult | undefined): [string, string] {
  assert.ok(result?.payload.kind === "gap", JSON.stringify(result));
  return [result.disposition, result.payload.reason_code];
}

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
  for (const reason of ["context_unverified", "restatement_unverified", "conflicting_evidence", "database_error"] as const) {
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
