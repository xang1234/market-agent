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
import { canonicalDecimalString, parseDerivedDecimalText, parseFinancialDecimal, type ExactDecimal } from "./exact-decimal.ts";
import { isKnownTimeZone, localDateOf } from "./public-time.ts";
import {
  addRationals,
  compareRationals,
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
 * A figure as a filing states it, with that filing's rounding of the concept
 * (filingRounding).
 */
export type RoundedFigure = Readonly<{ value: string; rounding: number | null }>;

/**
 * The power of ten a filing rounds a concept to: that of the finest figure it
 * states for the concept and unit, as companyfacts drops a filing's stated
 * rounding and one figure's zeros may be chance. Null when the filing states
 * too few figures to tell. Filers round whole numbers from thousands to
 * millions, so anything finer, a decimal among them, is read exactly.
 */
export function filingRounding(tokens: Iterable<string>): number | null {
  const figures = [...new Set(tokens)].flatMap((token) => {
    const parsed = parseFinancialDecimal(token);
    return parsed.ok && parsed.value.coefficient !== 0n ? [parsed.value] : [];
  });
  return figures.length < 2 ? null : Math.min(...figures.map(figureRounding));
}

function figureRounding({ scale }: ExactDecimal): number {
  return -scale < 3 ? 0 : Math.min(-scale, 6);
}

/**
 * Whether a later filing's figure is an earlier filing's, restated by the
 * listing's splits between their filing dates. A filing presents a figure
 * rounded, as NVDA's FY2025 10-K presents FY2024 diluted EPS of 11.93 as 1.19
 * after the 10-for-1 split, so the restated earlier figure must round to the
 * later one at the finer of their decimal places, or at the coarser of their
 * filings' roundings, the splits scaling the earlier filing's. A value half way
 * between rounds either way. The earlier figure may be a stored value's text,
 * which can run longer than a source token may. Null when either figure is not
 * a decimal, splits cannot restate this kind of value, or only a filing too
 * short to show its rounding could explain the difference.
 */
export function explainedBySplits(input: {
  earlier: RoundedFigure & Readonly<{ as_filed_on: IsoDate }>;
  later: RoundedFigure & Readonly<{ as_filed_on: IsoDate }>;
  value_kind: MetricValueKind;
  splits: ReadonlyArray<RecordedSplit>;
}): boolean | null {
  const split = splitFactor(input.value_kind, input.earlier.as_filed_on, input.later.as_filed_on, input.splits);
  return split.ok ? statesAgain(input.earlier, input.later, split.restate) : null;
}

/**
 * Whether a later token states a stored figure again, within half the coarser of
 * the two filings' roundings: 16053123000 from a filing in thousands, then
 * 16053000000 from one in millions, is one figure. Null when either is not a
 * decimal, or only a filing too short to show its rounding could hide the
 * difference.
 */
export function sameRoundedFigure(earlier: RoundedFigure, later: RoundedFigure): boolean | null {
  return statesAgain(earlier, later, (value) => value);
}

function statesAgain(earlier: RoundedFigure, later: RoundedFigure, restate: (value: ExactRational) => ExactRational | null): boolean | null {
  const from = parseDerivedDecimalText(earlier.value);
  const to = parseFinancialDecimal(later.value);
  if (!from.ok || !to.ok) return null;
  const decimalHalf = rationalFromDecimal({ coefficient: 5n, scale: Math.max(0, from.value.scale, to.value.scale) + 1 });
  const half = (earlierExponent: number, laterExponent: number) =>
    earlierExponent + laterExponent > 0 ? halfOfCoarser(restate, earlierExponent, laterExponent) : decimalHalf;
  const start = rationalFromDecimal(from.value);
  const end = rationalFromDecimal(to.value);
  const restated = start === null ? null : restate(start);
  const difference = restated === null || end === null ? null : subtractRationals(restated, end);
  if (difference === null) return null;
  const known = half(earlier.rounding ?? 0, later.rounding ?? 0);
  const within = known === null ? null : withinEitherWay(difference, known);
  if (within !== false) return within;
  const possible = half(earlier.rounding ?? figureRounding(from.value), later.rounding ?? figureRounding(to.value));
  const hidden = possible === null ? null : withinEitherWay(difference, possible);
  return hidden === false ? false : null;
}

function halfOfCoarser(restate: (value: ExactRational) => ExactRational | null, earlierExponent: number, laterExponent: number): ExactRational | null {
  const unit = (exponent: number) => rationalFromDecimal({ coefficient: 1n, scale: -exponent });
  const earlierUnit = unit(earlierExponent);
  const restatedUnit = earlierUnit === null ? null : restate(earlierUnit);
  const laterUnit = unit(laterExponent);
  const half = rationalFromDecimal({ coefficient: 5n, scale: 1 });
  if (restatedUnit === null || laterUnit === null || half === null) return null;
  return multiplyRationals(compareRationals(restatedUnit, laterUnit) > 0 ? restatedUnit : laterUnit, half);
}

/** Half - difference and half + difference are both nonnegative; null past the numeric limits. */
function withinEitherWay(difference: ExactRational, half: ExactRational): boolean | null {
  const under = subtractRationals(half, difference);
  const over = addRationals(half, difference);
  return under === null || over === null ? null : rationalSign(under) >= 0 && rationalSign(over) >= 0;
}

/**
 * Whether a stated token is what rounded terms sum to, it and each of them off
 * by half its own filing's rounding, and by nothing where that filing's rounding
 * cannot be told.
 */
export function sumWithinRounding(stated: RoundedFigure, sum: ExactDecimal, termRoundings: ReadonlyArray<number | null>): boolean {
  const parsed = parseFinancialDecimal(stated.value);
  const halves = [stated.rounding, ...termRoundings].reduce<bigint>((total, rounding) => total + (rounding ? 5n * 10n ** BigInt(rounding) : 0n), 0n);
  const tolerance = rationalFromDecimal({ coefficient: halves, scale: 1 });
  const value = parsed.ok ? rationalFromDecimal(parsed.value) : null;
  const total = rationalFromDecimal(sum);
  const difference = value === null || total === null ? null : subtractRationals(value, total);
  return difference !== null && tolerance !== null && withinEitherWay(difference, tolerance) === true;
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
