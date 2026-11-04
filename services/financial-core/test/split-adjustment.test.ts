import assert from "node:assert/strict";
import test from "node:test";
import type { ReportedMetricNode, SplitAdjustmentV2 } from "../src/contracts.ts";
import { parseFinancialDecimal } from "../src/exact-decimal.ts";
import { absoluteChange, FinancialIntegrityError, operandFromBoundInput, type OperandOutcome } from "../src/operations.ts";
import { rationalFromDecimal, type ExactRational } from "../src/rational.ts";
import { explainedBySplits, filingRounding, restateToReference, sameRoundedFigure, splitHistoryCovers, splitReferenceDate, sumWithinRounding, type RecordedSplit } from "../src/split-adjustment.ts";
import { change } from "./fixtures.ts";
import { boundInput, operand, REFERENCE_DATE, SLOTS, type InputSpec } from "./operand-fixtures.ts";
import { validateBoundInput } from "../src/validate.ts";

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
    slot: SLOTS.a, definition_version: "weighted_average_diluted_shares.v1", knowledge_cutoff: "2025-01-01T12:00:00.000Z", reporting_basis: "as_reported",
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

test("a history with more splits than a bound adjustment holds is a numeric limit, not an invalid bound input", () => {
  const daily = (count: number): RecordedSplit[] => Array.from({ length: count }, (_, day) => ({
    execution_date: new Date(Date.UTC(2024, 2, 1 + day)).toISOString().slice(0, 10), split_from: "1", split_to: "2",
  }));
  const most = restated({ native: "11.93", value_kind: "per_share", as_filed_on: "2024-02-21", reference_date: "2025-01-01", splits: daily(64) });
  const validated = validateBoundInput(boundInput({ ...EPS, split_adjustment: most }));
  assert.deepEqual([most.splits.length, validated.ok || validated.issues], [64, true]);
  const tooMany = restateToReference({ native: exact("11.93"), value_kind: "per_share", as_filed_on: "2024-02-21", reference_date: "2025-01-01", listing_id: LISTING, listing_timezone: NEW_YORK, splits: daily(65) });
  assert.deepEqual(tooMany, { ok: false, reason: "numeric_limit_exceeded" });
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
  const expected = { slot: SLOTS.a, definition_version: "eps_diluted.v1", knowledge_cutoff: "2025-01-01T12:00:00.000Z", reporting_basis: "as_reported" as const };
  assert.equal(payloadValue(operandFromBoundInput(input, reported(EPS), expected)), "1.193");
});

test("a tampered or misdated restatement fails the input's integrity", () => {
  const adjustment = restated({ native: "11.93", value_kind: "per_share", as_filed_on: "2024-02-21", reference_date: "2025-01-01" });
  const expected = { slot: SLOTS.a, definition_version: "eps_diluted.v1", knowledge_cutoff: "2025-01-01T12:00:00.000Z", reporting_basis: "as_reported" as const };
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
  assert.equal(payloadValue(absoluteChange(change("chg", "absolute_change", "current", "prior"), current, prior)), "1.747");
});

test("a later 10-K's figure is the earlier one restated by the splits between their filings, at the finer decimal place", () => {
  const explained = (earlier: string, later: string, valueKind: "per_share" | "flow" = "per_share", laterFiled = "2025-02-26") =>
    explainedBySplits({ earlier: { value: earlier, as_filed_on: "2024-02-21", rounding: 0 }, later: { value: later, as_filed_on: laterFiled, rounding: 0 }, value_kind: valueKind, splits: NVDA_SPLITS });
  // 11.93 / 10 is 1.193, presented as 1.19. 12.05 / 10 is 1.205, half way, so 1.20 and 1.21 both state it.
  assert.deepEqual([explained("11.93", "1.19"), explained("12.05", "1.21"), explained("12.05", "1.20")], [true, true, true]);
  // 1.2 is read at the finer place, as 1.20.
  assert.deepEqual([explained("11.93", "1.08"), explained("11.93", "1.20"), explained("11.93", "1.2")], [false, false, false]);
  // No split falls between the 10-K and a 10-Q filed before 2024-06-10.
  assert.deepEqual([explained("11.93", "11.93", "per_share", "2024-05-29"), explained("11.93", "1.19", "per_share", "2024-05-29")], [true, false]);
  assert.equal(explained("100", "100", "flow"), null);
});

test("a share count rounded differently is the same count, at the coarser of the two filings' roundings", () => {
  const explained = (earlier: string, earlierRounding: number | null, later: string, laterRounding: number | null, laterFiled = "2025-02-26") =>
    explainedBySplits({
      earlier: { value: earlier, as_filed_on: "2024-02-21", rounding: earlierRounding },
      later: { value: later, as_filed_on: laterFiled, rounding: laterRounding },
      value_kind: "share_count_average",
      splits: NVDA_SPLITS,
    });
  // Thousands, then millions: 249,412,000 x 10 is 2,494,120,000, and 2,494M is that to the million.
  assert.equal(explained("249412000", 3, "2494000000", 6), true);
  // NVDA's FY2024 Q2 diluted count: 2,499M to the million is within 5M once it is multiplied by 10, and the 10-K's 24,994M is.
  assert.deepEqual([explained("2499000000", 6, "24994000000", 6), explained("2499000000", 6, "24985000000", 6), explained("2499000000", 6, "24984000000", 6)], [true, true, false]);
  assert.equal(explained("1234567000", 3, "1235000000", 6, "2024-05-29"), true, "no split between the filings");
  assert.equal(explained("1234567000", 3, "1236000000", 6, "2024-05-29"), false);
  // Exact counts have no rounding to hide a change in, nor has a thousands filer's count round by chance.
  assert.equal(explained("1234567", 0, "1234568", 0, "2024-05-29"), false);
  assert.equal(explained("2000000000", 3, "20000400000", 3), false, "2,000,000K x 10 is known to the 10K, and 400K is past that");
  // A filing too short to show its rounding: the later filing's millions decide what is the same, and its own zeros what could be hidden.
  assert.equal(explained("2494000000", null, "24940000000", 6), true);
  assert.equal(explained("2494000000", null, "24944000000", 6), null);
  assert.equal(explained("2494000000", null, "24950000000", 6), false);
});

test("a reverse split scales a decimal's rounding up, as a split scales a count's", () => {
  const explained = (earlier: string, later: string) =>
    explainedBySplits({
      earlier: { value: earlier, as_filed_on: "2021-04-27", rounding: 0 },
      later: { value: later, as_filed_on: "2022-04-26", rounding: 0 },
      value_kind: "per_share",
      splits: [{ execution_date: "2021-08-02", split_from: "8", split_to: "1" }],
    });
  // GE's Q1 2021 basic EPS: -0.33 before its 1-for-8, known to half a cent, is -2.64 known to 4 cents, and its next 10-Q states -2.62.
  assert.deepEqual([explained("-0.33", "-2.62"), explained("-0.33", "-2.68"), explained("-0.33", "-2.69")], [true, true, false]);
});

test("a filing's rounding is its finest figure for the concept, from thousands to millions, when it states enough to tell", () => {
  assert.equal(filingRounding(["16000000000", "12345000000"]), 6);
  assert.equal(filingRounding(["16000000000", "12345678000"]), 3);
  assert.equal(filingRounding(["16053100000", "16000000000"]), 5);
  assert.equal(filingRounding(["16000000000", "12345678"]), 0);
  assert.equal(filingRounding(["1000", "100"]), 0, "a hundred is no rounding");
  assert.equal(filingRounding(["1.23", "1.5"]), 0, "a decimal is read at its own places");
  assert.equal(filingRounding(["700000000000", "800000000000"]), 6, "never coarser than millions");
  assert.equal(filingRounding(["16000000000"]), null);
  assert.equal(filingRounding(["16000000000", "16000000000", "0"]), null, "a repeat or a zero shows nothing");
  assert.equal(filingRounding([]), null);
});

test("a per-share figure's rounding is its filing's finest stated places, never its own zeros", () => {
  assert.equal(filingRounding(["1.37", "0.91", "12.50"], "per_share"), -2);
  assert.equal(filingRounding(["1.375", "0.91"], "per_share"), -3);
  assert.equal(filingRounding(["1000", "2000"], "per_share"), null, "whole figures show no places, so nothing tells");
  assert.equal(filingRounding(["12.50", "7.50"], "per_share"), null, "dropped zeros could hide the cents");
  assert.equal(filingRounding(["8.36"], "per_share"), null);
  assert.equal(filingRounding(["1000000", "2000000"], "share_count"), 6, "a share count is still in millions");
  assert.equal(filingRounding(["1000.5", "2000"], "flow"), -1, "a decimal among whole figures is read at its places");

  const same = (earlier: string, later: string, laterOther: string) =>
    sameRoundedFigure(
      { value: earlier, rounding: filingRounding([earlier, "2000"], "per_share") },
      { value: later, rounding: filingRounding([later, laterOther], "per_share") },
    );
  assert.equal(same("1000", "1001.25", "1.37"), false, "1,000 then 1,001.25 is a change");
  assert.equal(same("1000", "1000", "1.37"), true);
});

test("across a split, a per-share figure is held to its filing's cents, and a figure too short to show them is a gap", () => {
  const SPLIT = [{ execution_date: "2024-06-01", split_from: "1", split_to: "2" }];
  const explained = (earlier: string, earlierOthers: string[], later: string, laterOthers: string[]) =>
    explainedBySplits({
      earlier: { value: earlier, rounding: filingRounding([earlier, ...earlierOthers], "per_share"), as_filed_on: "2024-02-01" },
      later: { value: later, rounding: filingRounding([later, ...laterOthers], "per_share"), as_filed_on: "2025-02-01" },
      value_kind: "per_share",
      splits: SPLIT,
    });
  const others = ["1.37", "0.91"];
  assert.equal(explained("25.00", others, "12.00", others), false, "true value 12.50");
  assert.equal(explained("12.50", others, "6.30", others), false, "true value 6.25");
  assert.equal(explained("12.50", others, "6.25", others), true);
  assert.equal(explained("11.93", others, "5.97", others), true, "5.965 is half way");
  assert.equal(explained("11.93", others, "5.96", others), true);
  assert.equal(explained("11.93", others, "5.98", others), false);
  // Nothing shows the cents of either filing: 25 could be 25.00 and 12 could be 12.00.
  assert.equal(explained("25", [], "12", []), null);
  assert.equal(explained("12.5", [], "6.3", []), null);
  assert.equal(explained("12.50", others, "6.3", []), null);
  assert.equal(explained("12.5", [], "6.25", []), true);
  assert.equal(explained("11.93", [], "5.97", []), true, "both show cents");
  assert.equal(explained("11.93", [], "5.98", []), false);
});

test("two figures are one within half the coarser of their filings' roundings", () => {
  const same = (earlier: string, earlierRounding: number | null, later: string, laterRounding: number | null) =>
    sameRoundedFigure({ value: earlier, rounding: earlierRounding }, { value: later, rounding: laterRounding });
  assert.equal(same("16053123000", 3, "16053000000", 6), true);
  assert.equal(same("16000000000", 3, "15999800000", 3), false, "a thousands filer's round figure is in thousands");
  assert.equal(same("100", 0, "100", 0), true);
  assert.equal(same("100", 0, "95", 0), false);
  assert.equal(same("1.23", 0, "1.2", 0), false);
  // A filing too short to tell is exact, unless its own zeros could hide the difference: then nobody can tell.
  assert.equal(same("16053000000", null, "16053000000", null), true);
  assert.equal(same("16053123000", 3, "16053000000", null), null);
  assert.equal(same("16053123000", 3, "16054000000", null), false);
  assert.equal(same("16053000000", null, "16053123000", 3), null);
  assert.equal(same("100", null, "90", null), false);
  assert.equal(same("1000", null, "990", 0), false, "three digits stay above a rounding, and 1,000 has one above the thousands");
  assert.equal(same("1000000", null, "999000", 0), null, "1,000,000 could be to the ten thousand");
  assert.equal(same("1000000", null, "980000", 0), false);
});

test("a sum tolerates no whole-number rounding from a filing that states decimals", () => {
  const within = (stated: string, sum: bigint, scale: number) => sumWithinRounding({ value: stated, rounding: -2 }, { coefficient: sum, scale }, [-2, -2]);
  assert.equal(within("1.5", 150n, 2), true);
  assert.equal(within("1.51", 150n, 2), false);
});

test("a sum is off by each figure's own half unit, and a filing too short to tell adds nothing", () => {
  const within = (stated: string, statedRounding: number | null, sum: string, termRoundings: ReadonlyArray<number | null>) =>
    sumWithinRounding({ value: stated, rounding: statedRounding }, { coefficient: BigInt(sum), scale: 0 }, termRoundings);
  // 100M in millions and three quarters in thousands: half a million twice and half a thousand three times.
  assert.equal(within("26189000", 6, "25188000", [6, 3, 3, 3]), true);
  assert.equal(within("26190000", 6, "25188000", [6, 3, 3, 3]), false);
  assert.equal(within("27600000", 3, "25188000", [3, 3, 3, 3]), false);
  assert.equal(within("100", null, "100", [null, null]), true);
  assert.equal(within("101", null, "100", [null, null]), false);
  assert.equal(within("101", 0, "100", [0, 0]), false);
});

test("an earlier figure as stored is read whole, though its text is longer than a source token may be (#401)", () => {
  const explained = (earlier: string, later: string) =>
    explainedBySplits({ earlier: { value: earlier, as_filed_on: "2024-02-21", rounding: 0 }, later: { value: later, as_filed_on: "2025-02-26", rounding: 0 }, value_kind: "per_share", splits: NVDA_SPLITS });
  // How Postgres prints a numeric stored from the token 1.234567890123456789e-250: 270 characters.
  const stored = `0.${"0".repeat(249)}1234567890123456789`;
  assert.deepEqual([explained(stored, "1.08"), explained(stored, "1.234567890123456789e-251")], [false, true]);
});
