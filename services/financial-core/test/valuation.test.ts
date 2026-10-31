// Market cap and P/E (#444): a share price with a share count or diluted EPS,
// every operand restated to the plan's reference date R on the company's one
// listing. NVDA's numbers: Friday 2024-06-07 closed at 1200.00, its 10-Q cover
// counted 2,464,000,000 shares at 2024-05-17, its FY2024 10-K filed diluted
// EPS of 11.93 on 2024-02-21, and its 10-for-1 split executed on 2024-06-10.
// R is 2024-06-11.

import assert from "node:assert/strict";
import test from "node:test";
import { hashCanonical } from "../src/canonical.ts";
import type { BoundFinancialInputV1, FinancialPlanV1, FinancialUnit, LocalId, PeriodSelector, ReasonCode } from "../src/contracts.ts";
import { evaluateBoundPlan, nodeLineageHashes, unitPublication, type ExpectedResult, type SlotBinding } from "../src/bound-evaluation.ts";
import { presentFinancialUnit } from "../src/presentation.ts";
import { validateFinancialPlan } from "../src/validate.ts";
import { planFixture } from "./fixtures.ts";
import { boundInput, priceInput, SLOTS, SPLIT_CUTOFF, splitAdjustment } from "./operand-fixtures.ts";

const LATEST_YEAR: PeriodSelector = { kind: "latest", period_type: "annual", offset: 0 };
const PER_SHARE_USD: FinancialUnit = { kind: "currency_per_share", currency: "USD" };
const DIGEST = "c".repeat(64);

function valuationPlan(earnings: { metric_key: string; period: PeriodSelector } = { metric_key: "eps_diluted", period: LATEST_YEAR }): FinancialPlanV1 {
  const reported = (node_id: string, metric_key: string, period: PeriodSelector) =>
    ({ node_id, operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "a", metric_key, period });
  const validated = validateFinancialPlan({
    ...planFixture(),
    subjects: { membership: "explicit", requested_count: 1, resolved_count: 1, omitted_count: 0, members: [SLOTS.a] },
    time: { knowledge_cutoff: SPLIT_CUTOFF, cutoff_timezone: "America/New_York", time_mode: "public_information" },
    metric_definitions: ["share_price", "shares_outstanding", earnings.metric_key].map((key) => ({ metric_key: key, definition_version: `${key}.v1` })),
    operations: [
      reported("px", "share_price", { kind: "at_cutoff" }),
      reported("shares", "shares_outstanding", { kind: "latest", period_type: "quarterly", offset: 0 }),
      reported("eps", earnings.metric_key, earnings.period),
      { node_id: "cap", operation: "market_cap", operation_version: "market_cap.v1", price: "px", shares: "shares" },
      { node_id: "pe", operation: "pe_ratio", operation_version: "pe_ratio.v1", price: "px", earnings: "eps" },
    ],
    outputs: ["px", "shares", "eps", "cap", "pe"].map((node) => ({ output_id: `out_${node}`, node_id: node, unit_id: "valuation" })),
    publication_units: [{ unit_id: "valuation", kind: "chat_section" }],
    thresholds: [],
  });
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

const friday = () => priceInput("1200.00", "1200", "2024-06-07");

/** The 10-Q cover's count at S = 2024-05-17, restated to R. */
function coverCount(value = "2464000000", overrides: { listing?: string; restated?: boolean } = {}): BoundFinancialInputV1 {
  return boundInput({
    metric: "shares_outstanding", value, unit: { kind: "shares" }, kind: "instant", end: "2024-05-17", fiscal_year: 2025, fiscal_period: "Q1",
    ...(overrides.restated === false ? {} : { split_adjustment: splitAdjustment(value, "share_count", "2024-05-17", overrides.listing) }),
  });
}

/** FY2024 diluted EPS from the 10-K filed 2024-02-21, restated to R. */
function annualEps(value = "11.93", overrides: { metric?: string; currency?: string } = {}): BoundFinancialInputV1 {
  return boundInput({
    metric: overrides.metric ?? "eps_diluted", value, unit: { kind: "currency_per_share", currency: overrides.currency ?? "USD" },
    start: "2023-01-30", end: "2024-01-28", fiscal_year: 2024, fiscal_period: "FY", share_basis: overrides.metric === "eps_basic" ? "basic" : "diluted",
    split_adjustment: splitAdjustment(value, "per_share", "2024-02-21"),
  });
}

type Inputs = Record<"px" | "shares" | "eps", BoundFinancialInputV1 | ReasonCode>;

/** The unit's results as the engine checkpoints them and the verifier recomputes them. */
function publish(inputs: Partial<Inputs> = {}, plan = valuationPlan()): Record<string, ExpectedResult> {
  const all: Inputs = { px: friday(), shares: coverCount(), eps: annualEps(), ...inputs };
  const bindings = new Map<LocalId, SlotBinding>(Object.entries(all).map(([slot, input]) => [slot, typeof input === "string"
    ? { status: "gap", reason_code: input, candidate_set_digest: DIGEST }
    : { status: "bound", input, payload_hash: hashCanonical("bound_input", input), candidate_set_digest: DIGEST }]));
  const evaluation = evaluateBoundPlan(plan, bindings);
  const publication = unitPublication(plan, evaluation, nodeLineageHashes(plan, evaluation, bindings), "valuation");
  return Object.fromEntries(publication.results.map((result) => [result.output_id, result]));
}

function gapOf(result: ExpectedResult | undefined): [string, string] {
  assert.ok(result?.payload.kind === "gap", JSON.stringify(result));
  return [result.disposition, result.payload.reason_code];
}

test("NVDA after its split: the price restates to 120, the count to 24,640,000,000, and market cap is 2,956,800,000,000", () => {
  const results = publish();
  assert.deepEqual(["out_px", "out_shares", "out_eps"].map((id) => [results[id]!.disposition, results[id]!.payload.kind === "value" && results[id]!.payload.value]), [
    ["computed", "120"], ["computed", "24640000000"], ["computed", "1.193"],
  ]);
  assert.deepEqual(results.out_cap!.payload, { kind: "value", value: "2956800000000", unit: { kind: "currency", currency: "USD" }, exact: true, rounding: null });
});

test("P/E is the restated price over the restated diluted EPS, 120 / 1.193, rounded like every division", () => {
  assert.deepEqual(publish().out_pe!.payload, {
    kind: "value",
    value: "100.58675607711651299245599329421626152556580050293",
    unit: { kind: "ratio" },
    exact: false,
    rounding: { policy_version: "numeric-policy.v1", significant_digits: 50, mode: "half_even" },
  });
});

test("the presentation reads market cap in currency and P/E as a multiple, both dated by the price", () => {
  const plan = valuationPlan();
  const results = Object.values(publish()).map((result) => ({ ...result, result_id: `r_${result.output_id}` }));
  const content = presentFinancialUnit({ plan, run_id: "run", unit_id: "valuation", results, subject_names: { a: "NVIDIA Corporation" }, periods: {} });
  const shown = Object.fromEntries(content.results.map((result) => [result.output_id, [content.labels[result.measure_label_id]!.text, content.labels[result.period_label_id]!.text, result.presented.text]]));
  assert.deepEqual([shown.out_cap, shown.out_pe], [
    ["Market capitalization (share price × shares outstanding)", "latest known at the cutoff", "USD 2,956,800,000,000.00"],
    ["P/E ratio (share price / latest fiscal year diluted EPS)", "latest known at the cutoff", "100.59x"],
  ]);
});

test("each valuation gap is typed", () => {
  assert.deepEqual(gapOf(publish({ eps: annualEps("-1.25") }).out_pe), ["not_applicable", "non_positive_denominator"]);
  assert.deepEqual(gapOf(publish({ eps: annualEps("0") }).out_pe), ["not_applicable", "non_positive_denominator"]);
  assert.deepEqual(gapOf(publish({ shares: coverCount("0") }).out_cap), ["not_applicable", "non_positive_base"]);
  assert.deepEqual(gapOf(publish({ eps: annualEps("11.93", { currency: "EUR" }) }).out_pe), ["incompatible", "incompatible_currency"]);
  // A count stored before #387 has no split basis: it may predate the split.
  assert.deepEqual(gapOf(publish({ shares: coverCount("2464000000", { restated: false }) }).out_cap), ["incompatible", "incompatible_basis"]);
  // Basic EPS never stands in for diluted.
  const basic = valuationPlan({ metric_key: "eps_basic", period: LATEST_YEAR });
  assert.deepEqual(gapOf(publish({ eps: annualEps("11.93", { metric: "eps_basic" }) }, basic).out_pe), ["incompatible", "incompatible_definition"]);
  // A named year is not the latest one at every cutoff, so it is not P/E.
  const named = valuationPlan({ metric_key: "eps_diluted", period: { kind: "fiscal_period", fiscal_year: 2024, fiscal_period: "FY" } });
  assert.deepEqual(gapOf(publish({}, named).out_pe), ["unsupported", "unsupported_period"]);
});

test("an input's gap blocks the figures that read it, and only those", () => {
  const stalePrice = publish({ px: "stale_input" });
  assert.deepEqual([gapOf(stalePrice.out_px), gapOf(stalePrice.out_cap), gapOf(stalePrice.out_pe)], [
    ["missing", "stale_input"], ["blocked_dependency", "blocked_by_dependency"], ["blocked_dependency", "blocked_by_dependency"],
  ]);
  const staleCount = publish({ shares: "stale_input" });
  assert.deepEqual([gapOf(staleCount.out_shares), gapOf(staleCount.out_cap)], [["missing", "stale_input"], ["blocked_dependency", "blocked_by_dependency"]]);
  assert.equal(staleCount.out_pe!.disposition, "computed");
});

test("operands restated on different listings, or a tampered price, fail the unit's integrity", () => {
  const relisted = publish({ shares: coverCount("2464000000", { listing: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }) });
  assert.deepEqual(Object.values(relisted).map(gapOf), Array(5).fill(["execution_error", "integrity_failure"]));
  const tampered = publish({ px: { ...friday(), numeric: { raw_token: "1100.00", value: "1200" } } });
  assert.deepEqual(Object.values(tampered).map(gapOf), Array(5).fill(["execution_error", "integrity_failure"]));
});
