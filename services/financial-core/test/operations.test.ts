import assert from "node:assert/strict";
import test from "node:test";
import type { ChangeNode, MarginNode, RatioNode, TrailingSumNode } from "../src/contracts.ts";
import { OPERATION_CATALOG_V1, RATIO_CATALOG_V1 } from "../src/definitions.ts";
import { convertDimensionless } from "../src/dimensions.ts";
import { canonicalDecimalString, parseFinancialDecimal, type ExactDecimal } from "../src/exact-decimal.ts";
import {
  absoluteChange,
  FinancialIntegrityError,
  margin,
  operandFromBoundInput,
  percentChangePositiveBase,
  ratio,
  trailingSum,
  type OperandOutcome,
} from "../src/operations.ts";
import { boundInput, FY2022, FY2023, operand, SLOTS, type InputSpec } from "./operand-fixtures.ts";
import { divideRational, equalRational, rational } from "./rational-oracle.ts";

const change = (operation: ChangeNode["operation"]): ChangeNode => ({ node_id: "chg", operation, operation_version: `${operation}.v1`, current: "cur", prior: "pri" });
const grossMargin: MarginNode = { node_id: "gm", operation: "gross_margin", operation_version: "gross_margin.v1", numerator: "gp", revenue: "rev" };
const ttm: TrailingSumNode = { node_id: "ttm", operation: "trailing_sum", operation_version: "trailing_sum.v1", quarters: ["q1", "q2", "q3", "q4"] };

function value(outcome: OperandOutcome): string {
  assert.ok(outcome.ok, `expected success: ${JSON.stringify(!outcome.ok && outcome)}`);
  return outcome.ok ? outcome.payload.value : "";
}

function gap(outcome: OperandOutcome): [string, string] {
  assert.equal(outcome.ok, false, "expected a gap");
  return outcome.ok ? ["", ""] : [outcome.disposition, outcome.reason_code];
}

function dec(token: string): ExactDecimal {
  const parsed = parseFinancialDecimal(token);
  assert.ok(parsed.ok);
  return (parsed as { value: ExactDecimal }).value;
}

test("the catalog registers exactly the approved operations, each versioned", () => {
  assert.deepEqual(
    [...OPERATION_CATALOG_V1.keys()].sort(),
    ["absolute_change", "gross_margin", "net_margin", "operating_margin", "peer_compare", "percent_change_positive_base", "ratio", "reported_metric", "threshold", "trailing_sum"],
  );
  for (const definition of OPERATION_CATALOG_V1.values()) assert.match(definition.operation_version, /\.v1$/u);
});

// --- reported_metric -------------------------------------------------------

test("reported_metric applies scale exactly once and exposes agreeing lineage", () => {
  const revenue = operand("rev", { metric: "revenue", value: "383285", scale: "1000000", native: "383285000000", ...FY2023 });
  assert.equal(canonicalDecimalString(revenue.value), "383285000000");
  assert.equal(revenue.exact, true);
  assert.equal(revenue.context.period.end, "2023-12-31");

  const precise = operand("big", { metric: "revenue", value: "9007199254740993", ...FY2023 });
  assert.equal(canonicalDecimalString(precise.value), "9007199254740993");
});

test("reported_metric rejects a native value that disagrees with value x scale", () => {
  const input = boundInput({ metric: "revenue", value: "383285", scale: "1000000", native: "383285", ...FY2023 });
  assert.throws(
    () =>
      operandFromBoundInput(
        input,
        { node_id: "rev", operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "a", metric_key: "revenue", period: { kind: "fiscal_period", fiscal_year: 2023, fiscal_period: "FY" } },
        { slot: SLOTS.a, definition_version: "revenue.v1" },
      ),
    FinancialIntegrityError,
  );
});

test("reported_metric rejects bindings for another subject or metric as integrity failures", () => {
  const input = boundInput({ slot: "b", metric: "revenue", value: "1", ...FY2023 });
  const node = { node_id: "rev", operation: "reported_metric" as const, operation_version: "reported_metric.v1", subject_slot: "a", metric_key: "revenue", period: { kind: "fiscal_period" as const, fiscal_year: 2023, fiscal_period: "FY" as const } };
  assert.throws(() => operandFromBoundInput(input, node, { slot: SLOTS.a, definition_version: "revenue.v1" }), FinancialIntegrityError);
  const otherMetric = boundInput({ metric: "gross_profit", value: "1", ...FY2023 });
  assert.throws(() => operandFromBoundInput(otherMetric, node, { slot: SLOTS.a, definition_version: "revenue.v1" }), FinancialIntegrityError);
});

test("reported_metric withholds values whose unit or period shape contradicts the definition", () => {
  const node = { node_id: "rev", operation: "reported_metric" as const, operation_version: "reported_metric.v1", subject_slot: "a", metric_key: "revenue", period: { kind: "fiscal_period" as const, fiscal_year: 2023, fiscal_period: "FY" as const } };
  const shares = boundInput({ metric: "revenue", value: "1", unit: { kind: "shares" }, ...FY2023 });
  assert.deepEqual(gap(operandFromBoundInput(shares, node, { slot: SLOTS.a, definition_version: "revenue.v1" })), ["incompatible", "incompatible_unit"]);
  const instant = boundInput({ metric: "revenue", value: "1", kind: "instant", end: "2023-12-31" });
  assert.deepEqual(gap(operandFromBoundInput(instant, node, { slot: SLOTS.a, definition_version: "revenue.v1" })), ["incompatible", "incompatible_period"]);
  const oldDefinition = boundInput({ metric: "revenue", value: "1", definition_version: "revenue.v0", ...FY2023 });
  assert.deepEqual(gap(operandFromBoundInput(oldDefinition, node, { slot: SLOTS.a, definition_version: "revenue.v1" })), ["incompatible", "incompatible_definition"]);
});

// --- absolute_change / percent_change_positive_base -----------------------

test("absolute_change: success, negative result, and incompatible inputs", () => {
  const cur = operand("cur", { metric: "revenue", value: "120.5", ...FY2023 });
  const pri = operand("pri", { metric: "revenue", value: "100", ...FY2022 });
  assert.equal(value(absoluteChange(change("absolute_change"), cur, pri)), "20.5");
  const lower = operand("cur", { metric: "revenue", value: "79.5", ...FY2023 });
  assert.equal(value(absoluteChange(change("absolute_change"), lower, pri)), "-20.5");

  const eur = operand("pri", { metric: "revenue", value: "100", unit: { kind: "currency", currency: "EUR" }, ...FY2022 });
  assert.deepEqual(gap(absoluteChange(change("absolute_change"), cur, eur)), ["incompatible", "incompatible_currency"]);
  const segment = operand("pri", { metric: "revenue", value: "100", scope: "segment", members: [{ axis: "srt:Segment", member: "Cloud" }], ...FY2022 });
  assert.deepEqual(gap(absoluteChange(change("absolute_change"), cur, segment)), ["incompatible", "incompatible_scope"]);
  const restated = operand("pri", { metric: "revenue", value: "100", reporting: "as_restated", ...FY2022 });
  assert.deepEqual(gap(absoluteChange(change("absolute_change"), cur, restated)), ["incompatible", "incompatible_basis"]);
  const quarter = operand("pri", { metric: "revenue", value: "25", start: "2023-01-01", end: "2023-03-31", fiscal_period: "Q1" });
  assert.deepEqual(gap(absoluteChange(change("absolute_change"), cur, quarter)), ["incompatible", "incompatible_period"]);
  const otherMetric = operand("pri", { metric: "net_income", value: "100", ...FY2022 });
  assert.deepEqual(gap(absoluteChange(change("absolute_change"), cur, otherMetric)), ["incompatible", "incompatible_definition"]);
  const otherSubject = operand("pri", { slot: "b", metric: "revenue", value: "100", ...FY2022 });
  assert.deepEqual(gap(absoluteChange(change("absolute_change"), cur, otherSubject)), ["incompatible", "incompatible_scope"]);
  // Prior must precede current.
  assert.deepEqual(gap(absoluteChange(change("absolute_change"), pri, cur)), ["incompatible", "incompatible_period"]);
});

test("absolute_change requires the prior period to end before the current period", () => {
  const cur = operand("cur", { metric: "revenue", value: "120", ...FY2023 });
  const same = operand("pri", { metric: "revenue", value: "100", ...FY2023 });
  assert.deepEqual(gap(absoluteChange(change("absolute_change"), cur, same)), ["incompatible", "incompatible_period"]);
});

test("percent_change_positive_base: exact growth, rounded repeating growth, and non-positive bases", () => {
  const cur = operand("cur", { metric: "revenue", value: "125", ...FY2023 });
  const pri = operand("pri", { metric: "revenue", value: "100", ...FY2022 });
  const growth = percentChangePositiveBase(change("percent_change_positive_base"), cur, pri);
  assert.equal(value(growth), "0.25");
  assert.deepEqual(growth.ok && growth.payload.unit, { kind: "ratio" });
  assert.equal(growth.ok && growth.payload.exact, true);

  const third = percentChangePositiveBase(
    change("percent_change_positive_base"),
    operand("cur", { metric: "revenue", value: "4", ...FY2023 }),
    operand("pri", { metric: "revenue", value: "3", ...FY2022 }),
  );
  assert.equal(value(third), `0.${"3".repeat(50)}`);
  assert.equal(third.ok && third.payload.exact, false);
  assert.deepEqual(third.ok && third.payload.rounding, { policy_version: "numeric-policy.v1", significant_digits: 50, mode: "half_even" });
  // Exact lineage survives rounding.
  assert.ok(third.ok && third.operand.rational !== null);
  assert.ok(
    third.ok &&
      equalRational(
        divideRational(rational(canonicalDecimalString(third.operand.rational!.numerator)), rational(canonicalDecimalString(third.operand.rational!.denominator))),
        { n: 1n, d: 3n },
      ),
  );

  const zeroBase = operand("pri", { metric: "revenue", value: "0", ...FY2022 });
  assert.deepEqual(gap(percentChangePositiveBase(change("percent_change_positive_base"), cur, zeroBase)), ["not_applicable", "non_positive_base"]);
  const negativeBase = operand("pri", { metric: "net_income", value: "-50", ...FY2022 });
  const curIncome = operand("cur", { metric: "net_income", value: "10", ...FY2023 });
  assert.deepEqual(gap(percentChangePositiveBase(change("percent_change_positive_base"), curIncome, negativeBase)), ["not_applicable", "non_positive_base"]);
  // The absolute change on the same negative base remains valid.
  assert.equal(value(absoluteChange(change("absolute_change"), curIncome, negativeBase)), "60");
});

// --- margins ---------------------------------------------------------------

test("gross_margin: success, zero revenue, negative revenue, and mismatched contexts", () => {
  const rev = operand("rev", { metric: "revenue", value: "383285", scale: "1000000", native: "383285000000", ...FY2023 });
  const gp = operand("gp", { metric: "gross_profit", value: "169148", scale: "1000000", native: "169148000000", ...FY2023 });
  const result = margin(grossMargin, gp, rev);
  assert.ok(result.ok);
  // Exact lineage is the reduced fraction 169148/383285.
  assert.ok(
    result.ok &&
      equalRational(
        divideRational(rational(canonicalDecimalString(result.operand.rational!.numerator)), rational(canonicalDecimalString(result.operand.rational!.denominator))),
        divideRational(rational("169148"), rational("383285")),
      ),
  );
  // Independently computed with Python decimal (prec 50, ROUND_HALF_EVEN).
  assert.equal(value(result), "0.44131129577207560953337594740206373847137247739932");
  assert.equal(result.ok && result.payload.exact, false);

  const zero = operand("rev", { metric: "revenue", value: "0", ...FY2023 });
  assert.deepEqual(gap(margin(grossMargin, gp, zero)), ["undefined", "zero_denominator"]);
  const negative = operand("rev", { metric: "revenue", value: "-5", ...FY2023 });
  assert.deepEqual(gap(margin(grossMargin, gp, negative)), ["not_applicable", "non_positive_denominator"]);

  const priorRevenue = operand("rev", { metric: "revenue", value: "365817", ...FY2022 });
  assert.deepEqual(gap(margin(grossMargin, gp, priorRevenue)), ["incompatible", "incompatible_period"]);
  const segmentRevenue = operand("rev", { metric: "revenue", value: "1", scope: "segment", members: [{ axis: "srt:Segment", member: "Cloud" }], ...FY2023 });
  assert.deepEqual(gap(margin(grossMargin, gp, segmentRevenue)), ["incompatible", "incompatible_scope"]);
  const eurRevenue = operand("rev", { metric: "revenue", value: "1", unit: { kind: "currency", currency: "EUR" }, ...FY2023 });
  assert.deepEqual(gap(margin(grossMargin, gp, eurRevenue)), ["incompatible", "incompatible_currency"]);
  const wrongNumerator = operand("gp", { metric: "net_income", value: "1", ...FY2023 });
  assert.deepEqual(gap(margin(grossMargin, wrongNumerator, rev)), ["incompatible", "incompatible_definition"]);
});

test("margins are exact when the quotient terminates", () => {
  const rev = operand("rev", { metric: "revenue", value: "200", ...FY2023 });
  const op = operand("op", { metric: "operating_income", value: "50", ...FY2023 });
  const result = margin({ node_id: "om", operation: "operating_margin", operation_version: "operating_margin.v1", numerator: "op", revenue: "rev" }, op, rev);
  assert.equal(value(result), "0.25");
  assert.equal(result.ok && result.payload.exact, true);
  assert.equal(result.ok && result.payload.rounding, null);
});

test("same numeric operands with different periods, currencies, or scopes never produce a ratio", () => {
  const node: RatioNode = { node_id: "lta", operation: "ratio", operation_version: "ratio.v1", ratio_key: "liabilities_to_assets", numerator: "tl", denominator: "ta" };
  const instant = (metric: string, extra: object = {}) => operand(metric, { metric, value: "100", kind: "instant", end: "2023-12-31", ...extra });
  assert.equal(value(ratio(node, instant("total_liabilities"), instant("total_assets"))), "1");
  assert.deepEqual(gap(ratio(node, instant("total_liabilities"), instant("total_assets", { end: "2022-12-31" }))), ["incompatible", "incompatible_period"]);
  assert.deepEqual(
    gap(ratio(node, instant("total_liabilities"), instant("total_assets", { unit: { kind: "currency", currency: "JPY" } }))),
    ["incompatible", "incompatible_currency"],
  );
  assert.deepEqual(
    gap(ratio(node, instant("total_liabilities"), instant("total_assets", { scope: "segment", members: [{ axis: "srt:Segment", member: "A" }] }))),
    ["incompatible", "incompatible_scope"],
  );
});

test("ratio accepts only approved pairs and enforces denominator constraints", () => {
  assert.ok(RATIO_CATALOG_V1.has("liabilities_to_equity"));
  const tl = operand("tl", { metric: "total_liabilities", value: "80", kind: "instant", end: "2023-12-31" });
  const eq = operand("eq", { metric: "stockholders_equity", value: "-20", kind: "instant", end: "2023-12-31" });
  const node: RatioNode = { node_id: "lte", operation: "ratio", operation_version: "ratio.v1", ratio_key: "liabilities_to_equity", numerator: "tl", denominator: "eq" };
  assert.deepEqual(gap(ratio(node, tl, eq)), ["not_applicable", "non_positive_denominator"]);
  const unknownPair = { ...node, ratio_key: "revenue_to_eps" };
  assert.deepEqual(gap(ratio(unknownPair, tl, eq)), ["unsupported", "unsupported_operation"]);
  const reversed = ratio({ ...node, ratio_key: "liabilities_to_assets" }, operand("ta", { metric: "total_assets", value: "1", kind: "instant", end: "2023-12-31" }), tl);
  assert.deepEqual(gap(reversed), ["incompatible", "incompatible_definition"]);
});

// --- trailing_sum ------------------------------------------------------------

const QUARTERS = [
  { start: "2023-01-01", end: "2023-03-31", fiscal_period: "Q1" as const },
  { start: "2023-04-01", end: "2023-06-30", fiscal_period: "Q2" as const },
  { start: "2023-07-01", end: "2023-09-30", fiscal_period: "Q3" as const },
  { start: "2023-10-01", end: "2023-12-31", fiscal_period: "Q4" as const },
];

function quarters(metric = "revenue", values = ["10.1", "20.2", "30.3", "40.4"], periods = QUARTERS, extra: Partial<InputSpec> = {}) {
  return periods.map((period, index) => operand(`q${index + 1}`, { metric, value: values[index]!, fiscal_year: 2023, ...period, ...extra }));
}

test("trailing_sum adds four consecutive quarters exactly, including 52/53-week quarters", () => {
  const result = trailingSum(ttm, quarters());
  assert.equal(value(result), "101");
  assert.ok(result.ok && result.operand.context.period.start === "2023-01-01" && result.operand.context.period.end === "2023-12-31");
  assert.equal(result.ok && result.operand.context.period.fiscal_period, "TTM");

  const weeks = [
    { start: "2022-09-25", end: "2022-12-31", fiscal_period: "Q1" as const },
    { start: "2023-01-01", end: "2023-04-01", fiscal_period: "Q2" as const },
    { start: "2023-04-02", end: "2023-07-01", fiscal_period: "Q3" as const },
    { start: "2023-07-02", end: "2023-09-30", fiscal_period: "Q4" as const },
  ];
  assert.equal(value(trailingSum(ttm, quarters("revenue", ["1", "2", "3", "4"], weeks))), "10");
  // Input order does not matter; exact dates do.
  assert.equal(value(trailingSum(ttm, quarters().reverse())), "101");
});

test("trailing_sum rejects partial, gapped, overlapping, and year-to-date quarter sets", () => {
  assert.deepEqual(gap(trailingSum(ttm, quarters().slice(0, 3))), ["incompatible", "incomplete_quarter_set"]);
  const gapped = [...QUARTERS.slice(0, 3), { start: "2023-10-02", end: "2023-12-31", fiscal_period: "Q4" as const }];
  assert.deepEqual(gap(trailingSum(ttm, quarters("revenue", undefined, gapped))), ["incompatible", "incomplete_quarter_set"]);
  const duplicate = [QUARTERS[0]!, QUARTERS[0]!, QUARTERS[2]!, QUARTERS[3]!];
  assert.deepEqual(gap(trailingSum(ttm, quarters("revenue", undefined, duplicate))), ["incompatible", "overlapping_periods"]);
  const ytd = [QUARTERS[0]!, { start: "2023-01-01", end: "2023-06-30", fiscal_period: "Q2" as const }, QUARTERS[2]!, QUARTERS[3]!];
  assert.deepEqual(gap(trailingSum(ttm, quarters("revenue", undefined, ytd))), ["unsupported", "unsupported_period"]);
});

test("trailing_sum rejects non-additive metrics: EPS, balances, share averages, and margins", () => {
  const perShare = { unit: { kind: "currency_per_share" as const, currency: "USD" }, share_basis: "diluted" as const };
  assert.deepEqual(gap(trailingSum(ttm, quarters("eps_diluted", undefined, QUARTERS, perShare))), ["not_applicable", "non_additive_metric"]);
  const shares = { unit: { kind: "shares" as const }, share_basis: "diluted" as const };
  assert.deepEqual(gap(trailingSum(ttm, quarters("weighted_average_diluted_shares", undefined, QUARTERS, shares))), ["not_applicable", "non_additive_metric"]);
  const balances = QUARTERS.map((period, index) => operand(`q${index + 1}`, { metric: "total_assets", value: "1", kind: "instant", end: period.end, fiscal_period: period.fiscal_period, fiscal_year: 2023 }));
  assert.deepEqual(gap(trailingSum(ttm, balances)), ["not_applicable", "non_additive_metric"]);

  const margins = QUARTERS.map((period, index) => {
    const outcome = margin(
      { ...grossMargin, node_id: `q${index + 1}` },
      operand("gp", { metric: "gross_profit", value: "1", fiscal_year: 2023, ...period }),
      operand("rev", { metric: "revenue", value: "4", fiscal_year: 2023, ...period }),
    );
    assert.ok(outcome.ok);
    return (outcome as { operand: Parameters<typeof trailingSum>[1][number] }).operand;
  });
  assert.deepEqual(gap(trailingSum(ttm, margins)), ["not_applicable", "non_additive_metric"]);
});

test("trailing_sum rejects mixed subjects, currencies, and definitions", () => {
  const mixed = quarters();
  mixed[3] = operand("q4", { slot: "b", metric: "revenue", value: "1", fiscal_year: 2023, ...QUARTERS[3]! });
  assert.deepEqual(gap(trailingSum(ttm, mixed)), ["incompatible", "incompatible_scope"]);
  const currency = quarters();
  currency[1] = operand("q2", { metric: "revenue", value: "1", fiscal_year: 2023, unit: { kind: "currency", currency: "EUR" }, ...QUARTERS[1]! });
  assert.deepEqual(gap(trailingSum(ttm, currency)), ["incompatible", "incompatible_currency"]);
});

// --- dimensionless scaling ---------------------------------------------------

test("ratios, percentages, and basis points convert exactly with typed rules", () => {
  assert.equal(canonicalDecimalString(convertDimensionless(dec("0.4413"), "ratio", "percent")), "44.13");
  assert.equal(canonicalDecimalString(convertDimensionless(dec("0.4413"), "ratio", "basis_points")), "4413");
  assert.equal(canonicalDecimalString(convertDimensionless(dec("12.5"), "percent", "ratio")), "0.125");
  assert.equal(canonicalDecimalString(convertDimensionless(dec("25"), "basis_points", "percent")), "0.25");
  assert.equal(canonicalDecimalString(convertDimensionless(dec("0.1"), "ratio", "ratio")), "0.1");
});

test("net_margin: a loss yields a valid negative margin; only net income may be the numerator", () => {
  const node: MarginNode = { node_id: "nm", operation: "net_margin", operation_version: "net_margin.v1", numerator: "ni", revenue: "rev" };
  const rev = operand("rev", { metric: "revenue", value: "400", ...FY2023 });
  assert.equal(value(margin(node, operand("ni", { metric: "net_income", value: "-50", ...FY2023 }), rev)), "-0.125");
  assert.deepEqual(gap(margin(node, operand("gp", { metric: "gross_profit", value: "50", ...FY2023 }), rev)), ["incompatible", "incompatible_definition"]);
});
