// The plan and bindings net cash and total debt are tested on (ADR 0006,
// #602): one subject's nine balances at AAPL's FY2026 10-K (accession
// 0000320193-26-000026, 2026-09-26), which reports cash 36.305B, marketable
// securities 20.417B current and 80.213B noncurrent, commercial paper 1.997B
// and long-term debt 9.906B current and 68.208B noncurrent.

import assert from "node:assert/strict";
import { hashCanonical } from "../src/canonical.ts";
import type { BoundFinancialInputV1, FinancialPlan, LocalId, PeriodSelector, ReasonCode } from "../src/contracts.ts";
import { evaluateBoundPlan, nodeLineageHashes, unitPublication, type ExpectedResult, type SlotBinding } from "../src/bound-evaluation.ts";
import { validateFinancialPlan } from "../src/validate.ts";
import { planFixture } from "./fixtures.ts";
import { boundInput, SLOTS, type InputSpec } from "./operand-fixtures.ts";

export const CASH = ["cash_and_equivalents", "marketable_securities_current", "marketable_securities_noncurrent", "short_term_investments", "debt_securities_current"];
export const DEBT = ["long_term_debt_current", "long_term_debt_noncurrent", "commercial_paper", "short_term_borrowings"];
export const FY2026: PeriodSelector = { kind: "fiscal_period", fiscal_year: 2026, fiscal_period: "FY" };
export const USD = { kind: "currency", currency: "USD" };
export const DIGEST = "c".repeat(64);

export type Node = Record<string, unknown> & { node_id: string };

export function balancePlan(edit: (operations: Node[]) => Node[] = (operations) => operations) {
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

export function plan(): FinancialPlan {
  const validated = balancePlan();
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

export const balance = (metric: string, value: string, extra: Partial<InputSpec> = {}) =>
  boundInput({ metric, value, kind: "instant", end: "2026-09-26", fiscal_year: 2026, fiscal_period: "FY", ...extra });

export const AAPL: Record<string, string> = {
  cash_and_equivalents: "36305000000",
  marketable_securities_current: "20417000000",
  marketable_securities_noncurrent: "80213000000",
  commercial_paper: "1997000000",
  long_term_debt_current: "9906000000",
  long_term_debt_noncurrent: "68208000000",
};

export type Inputs = Record<string, BoundFinancialInputV1 | ReasonCode>;

/** Each component's binding: the given input or gap, else AAPL's figure, else no figure at all. */
export function aapl(inputs: Inputs = {}, values: Record<string, string> = AAPL): Inputs {
  return Object.fromEntries([...CASH, ...DEBT].map((key) => [key, inputs[key] ?? (values[key] === undefined ? "missing_input" : balance(key, values[key]!))]));
}

export function publish(inputs: Inputs = aapl()): Record<string, ExpectedResult> {
  const bindings = new Map<LocalId, SlotBinding>(Object.entries(inputs).map(([slot, input]) => [slot, typeof input === "string"
    ? { status: "gap", reason_code: input, candidate_set_digest: DIGEST }
    : { status: "bound", input, payload_hash: hashCanonical("bound_input", input), candidate_set_digest: DIGEST }]));
  const built = plan();
  const evaluation = evaluateBoundPlan(built, bindings);
  const publication = unitPublication(built, evaluation, nodeLineageHashes(built, evaluation, bindings), "balance");
  return Object.fromEntries(publication.results.map((result) => [result.output_id, result]));
}

export function valueOf(result: ExpectedResult | undefined): string {
  assert.ok(result?.payload.kind === "value", JSON.stringify(result));
  return result.payload.value;
}

export function gapOf(result: ExpectedResult | undefined): [string, string] {
  assert.ok(result?.payload.kind === "gap", JSON.stringify(result));
  return [result.disposition, result.payload.reason_code];
}
