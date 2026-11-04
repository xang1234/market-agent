// Restating an as-filed per-share value or share count to the split basis as
// of a reference date (#387). A filing states its own period on the basis of
// every split executed on or before its filing date, so the value as of R is
// the stored one times F for a share count, or divided by F per share, F being
// the product of split_to / split_from over the splits after the filing date
// and on or before R. A split executes on a calendar day of its listing's
// market, so R is the plan's knowledge cutoff dated in the listing's time
// zone. A plan has one cutoff instant and each listing one R, so a company's
// restated inputs are always comparable. Exact.

import { canonicalJson } from "./canonical.ts";
import {
  SPLIT_ADJUSTMENT_VERSION,
  type DecimalString,
  type ExactFraction,
  type IsoDate,
  type IsoDateTime,
  type SplitAdjustmentV2,
  type UUID,
} from "./contracts.ts";
import type { MetricValueKind } from "./definitions.ts";
import { canonicalDecimalString, compareExactDecimals, parseDerivedDecimalText, parseFinancialDecimal, type ExactDecimal } from "./exact-decimal.ts";
import { isKnownTimeZone, localDateOf } from "./public-time.ts";
import {
  addRationals,
  divideRationals,
  multiplyRationals,
  rationalFromDecimal,
  rationalSign,
  subtractRationals,
  type ExactRational,
} from "./rational.ts";

/** SplitAdjustmentV2.splits maxItems in financial_result_schema.json. */
const MAX_ADJUSTMENT_SPLITS = 64;

export type RecordedSplit = Readonly<{ execution_date: IsoDate; split_from: DecimalString; split_to: DecimalString }>;

export type SplitRestatement =
  | Readonly<{ ok: true; adjustment: SplitAdjustmentV2; value: ExactRational }>
  | Readonly<{ ok: false; reason: "incompatible_basis" | "numeric_limit_exceeded" }>;

/** A listing's reference date: the calendar date of the plan's knowledge cutoff in the listing's time zone. */
export function splitReferenceDate(knowledgeCutoff: IsoDateTime, listingTimeZone: string): IsoDate {
  return localDateOf(Date.parse(knowledgeCutoff), listingTimeZone);
}

/**
 * Whether a split history fetched at `checkedAt` was fetched on or after
 * `referenceDate`, both dated in the listing's time zone. The check proves no
 * more than that. The history lists every split executed by the reference
 * date only if the provider lists each split before or on its execution date.
 */
export function splitHistoryCovers(checkedAt: IsoDateTime, referenceDate: IsoDate, listingTimeZone: string): boolean {
  return localDateOf(Date.parse(checkedAt), listingTimeZone) >= referenceDate;
}

/**
 * Restates `native`, filed on `as_filed_on`, to the basis as of
 * `reference_date`, from the listing's split history: only the splits after
 * the filing date and on or before the reference date apply. The basis is
 * incompatible when splits do not move this kind of value, a ratio is not
 * positive, or two splits share a date. More splits than a bound adjustment
 * may list exceed the numeric limits.
 */
export function restateToReference(input: {
  native: ExactRational;
  value_kind: MetricValueKind;
  as_filed_on: IsoDate;
  reference_date: IsoDate;
  listing_id: UUID;
  listing_timezone: string;
  splits: ReadonlyArray<RecordedSplit>;
}): SplitRestatement {
  const split = splitFactor(input.value_kind, input.as_filed_on, input.reference_date, input.splits);
  if (!split.ok) return split;
  if (split.splits.length > MAX_ADJUSTMENT_SPLITS) return { ok: false, reason: "numeric_limit_exceeded" };
  const value = split.restate(input.native);
  if (value === null) return { ok: false, reason: "numeric_limit_exceeded" };
  return {
    ok: true,
    adjustment: {
      version: SPLIT_ADJUSTMENT_VERSION,
      as_filed_on: input.as_filed_on,
      reference_date: input.reference_date,
      listing_id: input.listing_id,
      listing_timezone: input.listing_timezone,
      splits: split.splits,
      factor: fraction(split.factor),
      adjusted_native_value: fraction(value),
    },
    value,
  };
}

/**
 * Whether a later filing's figure is an earlier filing's, restated by the
 * listing's splits between their filing dates. A filing presents a figure
 * rounded, as NVDA's FY2025 10-K presents FY2024 diluted EPS of 11.93 as 1.19
 * after the 10-for-1 split, so the restated earlier figure must round to the
 * later one at the finer of their decimal places, a whole number to the unit
 * or to the coarser rounding its zeros show. A value half way between rounds
 * either way. The earlier figure may be a stored value's text, which can run
 * longer than a source token may. Null when either figure is not a decimal or
 * splits cannot restate this kind of value.
 */
export function explainedBySplits(input: {
  earlier: Readonly<{ value: string; as_filed_on: IsoDate }>;
  later: Readonly<{ value: string; as_filed_on: IsoDate }>;
  value_kind: MetricValueKind;
  splits: ReadonlyArray<RecordedSplit>;
}): boolean | null {
  const earlier = parseDerivedDecimalText(input.earlier.value);
  const later = parseFinancialDecimal(input.later.value);
  const split = splitFactor(input.value_kind, input.earlier.as_filed_on, input.later.as_filed_on, input.splits);
  if (!earlier.ok || !later.ok || !split.ok) return null;
  const from = rationalFromDecimal(earlier.value);
  const to = rationalFromDecimal(later.value);
  const rounding = Math.max(roundingExponent(earlier.value), roundingExponent(later.value));
  const half = rationalFromDecimal({ coefficient: 5n, scale: rounding > 0 ? 1 - rounding : Math.max(0, earlier.value.scale, later.value.scale) + 1 });
  const restated = from === null ? null : split.restate(from);
  const difference = restated === null || to === null ? null : subtractRationals(restated, to);
  return difference === null || half === null ? null : withinEitherWay(difference, half);
}

// Companyfacts drops a filing's stated rounding, so a whole figure's trailing
// zeros are the only sign of it. They count from thousands to millions, and only
// while three digits stay above them: 100 then 95, or 1,000,000 then 800,000, is
// a change. A decimal is read at its own places, as SEC drops its zeros too.
function roundingExponent({ coefficient, scale }: ExactDecimal): number {
  const digits = coefficient < 0n ? -coefficient : coefficient;
  for (let exponent = Math.min(-scale, 6); exponent >= 3; exponent -= 1) {
    if (digits * 10n ** BigInt(-scale - exponent) >= 100n) return exponent;
  }
  return 0;
}

/** Half - difference and half + difference are both nonnegative; null past the numeric limits. */
function withinEitherWay(difference: ExactRational, half: ExactRational): boolean | null {
  const under = subtractRationals(half, difference);
  const over = addRationals(half, difference);
  return under === null || over === null ? null : rationalSign(under) >= 0 && rationalSign(over) >= 0;
}

// Each rounded figure may be off by half the coarsest rounding among them, and
// exact figures by nothing.
function withinRounding(left: ExactDecimal, right: ExactDecimal, figures: ReadonlyArray<ExactDecimal>, halves: number): boolean | null {
  const rounding = Math.max(...figures.map(roundingExponent));
  if (rounding === 0) return compareExactDecimals(left, right) === 0;
  const from = rationalFromDecimal(left);
  const to = rationalFromDecimal(right);
  const tolerance = rationalFromDecimal({ coefficient: 5n * BigInt(halves), scale: 1 - rounding });
  const difference = from === null || to === null ? null : subtractRationals(from, to);
  return difference === null || tolerance === null ? null : withinEitherWay(difference, tolerance);
}

/**
 * Whether a later token states a stored figure again, at the coarser of their
 * roundings: 16053123000 then 16053000000 is one figure. Null when either is
 * not a decimal.
 */
export function sameRoundedFigure(earlier: string, later: string): boolean | null {
  const from = parseDerivedDecimalText(earlier);
  const to = parseFinancialDecimal(later);
  return !from.ok || !to.ok ? null : withinRounding(from.value, to.value, [from.value, to.value], 1);
}

/** Whether a stated token is what its rounded terms sum to, each of them and it off by half the coarsest rounding. */
export function sumWithinRounding(stated: string, sum: ExactDecimal, terms: ReadonlyArray<string>): boolean {
  const figures = [stated, ...terms].map(parseFinancialDecimal);
  const parsed = figures.flatMap((figure) => (figure.ok ? [figure.value] : []));
  return parsed.length === figures.length && withinRounding(parsed[0]!, sum, parsed, parsed.length) === true;
}

/**
 * The value a bound adjustment proves for `native`: its reference date must be
 * the plan's knowledge cutoff dated in the listing's time zone, and its value
 * the restatement of exactly its own splits to that date.
 */
export function checkSplitAdjustment(
  adjustment: SplitAdjustmentV2,
  native: ExactRational,
  valueKind: MetricValueKind,
  knowledgeCutoff: IsoDateTime,
): { ok: true; value: ExactRational } | { ok: false; code: "split_reference_mismatch" | "split_adjustment_mismatch" } {
  if (!isKnownTimeZone(adjustment.listing_timezone) || adjustment.reference_date !== splitReferenceDate(knowledgeCutoff, adjustment.listing_timezone)) {
    return { ok: false, code: "split_reference_mismatch" };
  }
  const recomputed = restateToReference({
    native,
    value_kind: valueKind,
    as_filed_on: adjustment.as_filed_on,
    reference_date: adjustment.reference_date,
    listing_id: adjustment.listing_id,
    listing_timezone: adjustment.listing_timezone,
    splits: adjustment.splits,
  });
  if (!recomputed.ok || canonicalJson(recomputed.adjustment) !== canonicalJson(adjustment)) return { ok: false, code: "split_adjustment_mismatch" };
  return { ok: true, value: recomputed.value };
}

/** Whether a stock split restates this kind of value: per-share values, prices, and share counts. */
export function splitsRestate(valueKind: MetricValueKind): boolean {
  return DIRECTIONS[valueKind] !== null;
}

type SplitFactor =
  | Readonly<{ ok: true; splits: SplitAdjustmentV2["splits"]; factor: ExactRational; restate: (value: ExactRational) => ExactRational | null }>
  | Readonly<{ ok: false; reason: "incompatible_basis" | "numeric_limit_exceeded" }>;

/**
 * The splits after `after` and on or before `onOrBefore`, in date order, and
 * the product of their split_to / split_from. The basis is incompatible when
 * splits do not move this kind of value, a ratio is not positive, or two
 * splits share a date.
 */
function splitFactor(valueKind: MetricValueKind, after: IsoDate, onOrBefore: IsoDate, recorded: ReadonlyArray<RecordedSplit>): SplitFactor {
  const direction = DIRECTIONS[valueKind];
  const applied = recorded
    .filter((split) => split.execution_date > after && split.execution_date <= onOrBefore)
    .sort((left, right) => left.execution_date.localeCompare(right.execution_date));
  if (direction === null || applied.some((split, index) => index > 0 && split.execution_date === applied[index - 1]!.execution_date)) {
    return { ok: false, reason: "incompatible_basis" };
  }
  let factor = rationalFromDecimal({ coefficient: 1n, scale: 0 });
  const splits: SplitAdjustmentV2["splits"] = [];
  for (const split of applied) {
    const from = positiveDecimal(split.split_from);
    const to = positiveDecimal(split.split_to);
    if (from === null || to === null) return { ok: false, reason: "incompatible_basis" };
    const ratio = divideRationals(to.value, from.value);
    factor = factor === null || ratio === null ? null : multiplyRationals(factor, ratio);
    splits.push({ execution_date: split.execution_date, split_from: from.text, split_to: to.text });
  }
  if (factor === null) return { ok: false, reason: "numeric_limit_exceeded" };
  const by = factor;
  return { ok: true, splits, factor: by, restate: (value) => (direction === "multiply" ? multiplyRationals(value, by) : divideRationals(value, by)) };
}

const DIRECTIONS: Readonly<Record<MetricValueKind, "multiply" | "divide" | null>> = {
  per_share: "divide",
  price: "divide",
  share_count: "multiply",
  share_count_average: "multiply",
  flow: null,
  balance: null,
};

function positiveDecimal(text: string): { text: DecimalString; value: ExactRational } | null {
  const parsed = parseDerivedDecimalText(text);
  const value = parsed.ok ? rationalFromDecimal(parsed.value) : null;
  return parsed.ok && value !== null && rationalSign(value) > 0 ? { text: canonicalDecimalString(parsed.value), value } : null;
}

function fraction(value: ExactRational): ExactFraction {
  return { numerator: canonicalDecimalString(value.numerator), denominator: canonicalDecimalString(value.denominator) };
}
