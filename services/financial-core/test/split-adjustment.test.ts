import assert from "node:assert/strict";
import test from "node:test";
import type { ChangeNode, ReportedMetricNode, SplitAdjustmentV2 } from "../src/contracts.ts";
import { parseFinancialDecimal } from "../src/exact-decimal.ts";
import { absoluteChange, FinancialIntegrityError, operandFromBoundInput, type OperandOutcome } from "../src/operations.ts";
import { rationalFromDecimal, type ExactRational } from "../src/rational.ts";
import { explainedBySplits, restateToReference, splitHistoryCovers, splitReferenceDate, type RecordedSplit } from "../src/split-adjustment.ts";
import { boundInput, operand, REFERENCE_DATE, SLOTS, type InputSpec } from "./operand-fixtures.ts";

const LISTING = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NEW_YORK = "America/New_York";
// NVDA's splits as Polygon lists them, with an announced one still to come.
const NVDA_SPLITS: RecordedSplit[] = [
  { execution_date: "2021-07-20", split_from: "1", split_to: "4" },
  { execution_date: "2024-06-10", split_from: "1", split_to: "10" },
  { execution_date: "2025-06-02", split_from: "1", split_to: "2" },
];
const FY2024 = { start: "2023-01-30", end: "2024-01-28", fiscal_year: 2024, fiscal_period: "FY" as const };
const FY2025 = { start: "2024-01-29", end: "2025-01-26", fiscal_year: 2025, fiscal_period: "FY" as const };
const EPS: InputSpec = { metric: "eps_diluted", value: "11.93", unit: { kind: "currency_per_share", currency: "USD" }, share_basis: "diluted", ...FY2024 };
const SHARES: InputSpec = { metric: "weighted_average_diluted_shares", value: "2494000000", unit: { kind: "shares" }, share_basis: "diluted", ...FY2024 };

function exact(token: string): ExactRational {
  const parsed = parseFinancialDecimal(token);
  assert.ok(parsed.ok);
  return rationalFromDecimal(parsed.value)!;
}

function restated(spec: { native: string; value_kind: "per_share" | "share_count_average"; as_filed_on: string; reference_date: string; splits?: RecordedSplit[] }): SplitAdjustmentV2 {
  const outcome = restateToReference({ ...spec, native: exact(spec.native), listing_id: LISTING, listing_timezone: NEW_YORK, splits: spec.splits ?? NVDA_SPLITS });
  if (!outcome.ok) return assert.fail(outcome.reason);
  return outcome.adjustment;
}

function reported(spec: InputSpec): ReportedMetricNode {
  return { node_id: "eps", operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "a", metric_key: spec.metric, period: { kind: "fiscal_period", fiscal_year: spec.fiscal_year!, fiscal_period: "FY" } };
}

function payloadValue(outcome: OperandOutcome): string {
  if (!outcome.ok) return assert.fail(outcome.reason_code);
  return outcome.payload.value;
}

test("a split after the filing restates NVDA's FY2024 diluted EPS and shares; one after the reference date does not", () => {
  assert.deepEqual(restated({ native: "11.93", value_kind: "per_share", as_filed_on: "2024-02-21", reference_date: "2025-01-01" }), {
    version: "split_adjustment.v2",
    as_filed_on: "2024-02-21",
    reference_date: "2025-01-01",
    listing_id: LISTING,
    listing_timezone: NEW_YORK,
    splits: [{ execution_date: "2024-06-10", split_from: "1", split_to: "10" }],
    factor: { numerator: "10", denominator: "1" },
    adjusted_native_value: { numerator: "1193", denominator: "1000" },
  });
  const shares = restated({ native: "2494000000", value_kind: "share_count_average", as_filed_on: "2024-02-21", reference_date: "2025-01-01" });
  assert.deepEqual(shares.adjusted_native_value, { numerator: "24940000000", denominator: "1" });
});

test("before the split, the reference basis is the filing's: no split, factor one", () => {
  const before = restated({ native: "11.93", value_kind: "per_share", as_filed_on: "2024-02-21", reference_date: "2024-05-01" });
  assert.deepEqual([before.splits, before.factor, before.adjusted_native_value], [[], { numerator: "1", denominator: "1" }, { numerator: "1193", denominator: "100" }]);
});

test("a 2-for-3 split restates to exact fractions", () => {
  const splits = [{ execution_date: "2024-06-10", split_from: "3", split_to: "2" }];
  const eps = restated({ native: "11.93", value_kind: "per_share", as_filed_on: "2024-02-21", reference_date: "2025-01-01", splits });
  assert.deepEqual([eps.factor, eps.adjusted_native_value], [{ numerator: "2", denominator: "3" }, { numerator: "3579", denominator: "200" }]);
  const shares = restated({ native: "2494000000", value_kind: "share_count_average", as_filed_on: "2024-02-21", reference_date: "2025-01-01", splits });
  assert.deepEqual(shares.adjusted_native_value, { numerator: "4988000000", denominator: "3" });
  const operandOutcome = operandFromBoundInput(boundInput({ ...SHARES, split_adjustment: shares }), reported(SHARES), {
    slot: SLOTS.a, definition_version: "weighted_average_diluted_shares.v1", knowledge_cutoff: "2025-01-01T12:00:00.000Z",
  });
  assert.ok(operandOutcome.ok);
  assert.deepEqual([operandOutcome.payload.value, operandOutcome.payload.exact], ["1662666666.6666666666666666666666666666666666666667", false]);
});

test("splits never restate a value they do not move, and a ratio must be positive", () => {
  const revenue = restateToReference({ native: exact("100"), value_kind: "flow", as_filed_on: "2024-02-21", reference_date: "2025-01-01", listing_id: LISTING, listing_timezone: NEW_YORK, splits: NVDA_SPLITS });
  assert.deepEqual(revenue, { ok: false, reason: "incompatible_basis" });
  const zero = restateToReference({ native: exact("1"), value_kind: "per_share", as_filed_on: "2024-02-21", reference_date: "2025-01-01", listing_id: LISTING, listing_timezone: NEW_YORK, splits: [{ execution_date: "2024-06-10", split_from: "0", split_to: "10" }] });
  assert.deepEqual(zero, { ok: false, reason: "incompatible_basis" });
});

test("a listing's reference date is the cutoff's date in its zone, and coverage counts from that day there", () => {
  // 02:00 UTC on 2024-06-10 is still 2024-06-09 in New York, where NVDA's split executed on 2024-06-10.
  assert.equal(splitReferenceDate("2024-06-10T02:00:00Z", NEW_YORK), "2024-06-09");
  assert.equal(splitReferenceDate("2024-06-10T02:00:00Z", "UTC"), "2024-06-10");
  assert.equal(splitHistoryCovers("2024-06-10T03:59:59Z", "2024-06-10", NEW_YORK), false);
  assert.equal(splitHistoryCovers("2024-06-10T04:00:00Z", "2024-06-10", NEW_YORK), true);
});

test("a restated input binds the as-filed token over the split factor", () => {
  const adjustment = restated({ native: "11.93", value_kind: "per_share", as_filed_on: "2024-02-21", reference_date: "2025-01-01" });
  const input = boundInput({ ...EPS, split_adjustment: adjustment });
  assert.deepEqual([input.numeric.raw_token, input.numeric.native_value, input.basis.adjustment], ["11.93", "11.93", "split_adjusted"]);
  const expected = { slot: SLOTS.a, definition_version: "eps_diluted.v1", knowledge_cutoff: "2025-01-01T12:00:00.000Z" };
  assert.equal(payloadValue(operandFromBoundInput(input, reported(EPS), expected)), "1.193");
});

test("a tampered or misdated restatement fails the input's integrity", () => {
  const adjustment = restated({ native: "11.93", value_kind: "per_share", as_filed_on: "2024-02-21", reference_date: "2025-01-01" });
  const expected = { slot: SLOTS.a, definition_version: "eps_diluted.v1", knowledge_cutoff: "2025-01-01T12:00:00.000Z" };
  const failure = (input: ReturnType<typeof boundInput>, reference = expected) => {
    try {
      operandFromBoundInput(input, reported(EPS), reference);
    } catch (error) {
      assert.ok(error instanceof FinancialIntegrityError);
      return error.code;
    }
    return assert.fail("the input bound");
  };
  const tamperedValue = { ...adjustment, adjusted_native_value: { numerator: "11930", denominator: "1000" } };
  assert.equal(failure(boundInput({ ...EPS, split_adjustment: tamperedValue })), "split_adjustment_mismatch");
  const tamperedFactor = { ...adjustment, factor: { numerator: "1", denominator: "1" }, adjusted_native_value: { numerator: "1193", denominator: "100" } };
  assert.equal(failure(boundInput({ ...EPS, split_adjustment: tamperedFactor })), "split_adjustment_mismatch");
  const futureSplit = { ...adjustment, splits: [...adjustment.splits, { execution_date: "2025-06-02", split_from: "1", split_to: "2" }] };
  assert.equal(failure(boundInput({ ...EPS, split_adjustment: futureSplit })), "split_adjustment_mismatch");
  // 04:00 UTC on 2025-01-01 is still 2024-12-31 in New York.
  assert.equal(failure(boundInput({ ...EPS, split_adjustment: adjustment }), { ...expected, knowledge_cutoff: "2025-01-01T04:00:00.000Z" }), "split_reference_mismatch");
  // The zone the adjustment names dates the cutoff: noon UTC is already 2025-01-02 in Kiritimati.
  assert.equal(failure(boundInput({ ...EPS, split_adjustment: { ...adjustment, listing_timezone: "Pacific/Kiritimati" } })), "split_reference_mismatch");
  assert.equal(failure(boundInput({ ...EPS, split_adjustment: { ...adjustment, listing_timezone: "Mars/Olympus_Mons" } })), "split_reference_mismatch");
  assert.equal(failure(boundInput({ ...EPS, adjustment: "split_adjusted" })), "split_basis_mismatch");
});

test("EPS a year apart, with a split between their filings, changes on one basis", () => {
  const prior = operand("prior", { ...EPS, split_adjustment: restated({ native: "11.93", value_kind: "per_share", as_filed_on: "2024-02-21", reference_date: REFERENCE_DATE }) });
  const current = operand("current", {
    ...EPS,
    value: "2.94",
    ...FY2025,
    split_adjustment: restated({ native: "2.94", value_kind: "per_share", as_filed_on: "2025-02-26", reference_date: REFERENCE_DATE }),
  });
  const change: ChangeNode = { node_id: "chg", operation: "absolute_change", operation_version: "absolute_change.v1", current: "current", prior: "prior" };
  assert.equal(payloadValue(absoluteChange(change, current, prior)), "1.747");
});

test("a later 10-K's figure is the earlier one restated by the splits between their filings, at the finer decimal place", () => {
  const explained = (earlier: string, later: string, valueKind: "per_share" | "share_count_average" | "flow" = "per_share", laterFiled = "2025-02-26") =>
    explainedBySplits({ earlier: { value: earlier, as_filed_on: "2024-02-21" }, later: { value: later, as_filed_on: laterFiled }, value_kind: valueKind, splits: NVDA_SPLITS });
  // 11.93 / 10 is 1.193, presented as 1.19. 12.05 / 10 is 1.205, half way, so 1.20 and 1.21 both state it.
  assert.deepEqual([explained("11.93", "1.19"), explained("12.05", "1.21"), explained("12.05", "1.20")], [true, true, true]);
  // 1.2 is read at the finer place, as 1.20.
  assert.deepEqual([explained("11.93", "1.08"), explained("11.93", "1.20"), explained("11.93", "1.2")], [false, false, false]);
  assert.deepEqual([explained("2494000000", "24940000000", "share_count_average"), explained("2494000000", "24944000000", "share_count_average")], [true, false]);
  // No split falls between the 10-K and a 10-Q filed before 2024-06-10.
  assert.deepEqual([explained("11.93", "11.93", "per_share", "2024-05-29"), explained("11.93", "1.19", "per_share", "2024-05-29")], [true, false]);
  assert.equal(explained("100", "100", "flow"), null);
});
