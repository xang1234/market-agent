// Restating an as-filed per-share value or share count to the split basis as
// of a plan's reference date (#387). A filing states its own period on the
// basis of every split executed on or before its filing date, so the value as
// of R is the stored one times F for a share count, or divided by F per share,
// F being the product of split_to / split_from over the splits after the
// filing date and on or before R. A plan has one reference date, derived from
// its time context, so its restated inputs are always comparable. Exact.

import { canonicalJson } from "./canonical.ts";
import {
  SPLIT_ADJUSTMENT_VERSION,
  type DecimalString,
  type ExactFraction,
  type IsoDate,
  type IsoDateTime,
  type SplitAdjustmentV1,
  type TimeContext,
  type UUID,
} from "./contracts.ts";
import type { MetricValueKind } from "./definitions.ts";
import { canonicalDecimalString, parseDerivedDecimalText } from "./exact-decimal.ts";
import { localDateOf } from "./public-time.ts";
import { divideRationals, multiplyRationals, rationalFromDecimal, rationalSign, type ExactRational } from "./rational.ts";

export type RecordedSplit = Readonly<{ execution_date: IsoDate; split_from: DecimalString; split_to: DecimalString }>;

export type SplitRestatement =
  | Readonly<{ ok: true; adjustment: SplitAdjustmentV1; value: ExactRational }>
  | Readonly<{ ok: false; reason: "incompatible_basis" | "numeric_limit_exceeded" }>;

type PlanTime = Pick<TimeContext, "knowledge_cutoff" | "cutoff_timezone">;

/** The plan's reference date: its knowledge cutoff's calendar date in its cutoff time zone. */
export function splitReferenceDate(time: PlanTime): IsoDate {
  return localDateOf(Date.parse(time.knowledge_cutoff), time.cutoff_timezone);
}

/**
 * Whether a split history fetched at `checkedAt` was fetched on or after the
 * plan's reference date. The check proves no more than that. The history
 * lists every split executed by the reference date only if the provider lists
 * each split before or on its execution date.
 */
export function splitHistoryCovers(checkedAt: IsoDateTime, time: PlanTime): boolean {
  return localDateOf(Date.parse(checkedAt), time.cutoff_timezone) >= splitReferenceDate(time);
}

/**
 * Restates `native`, filed on `as_filed_on`, to the basis as of
 * `reference_date`, from the listing's split history: only the splits after
 * the filing date and on or before the reference date apply. The basis is
 * incompatible when splits do not move this kind of value, a ratio is not
 * positive, or two splits share a date.
 */
export function restateToReference(input: {
  native: ExactRational;
  value_kind: MetricValueKind;
  as_filed_on: IsoDate;
  reference_date: IsoDate;
  listing_id: UUID;
  splits: ReadonlyArray<RecordedSplit>;
}): SplitRestatement {
  const direction = DIRECTIONS[input.value_kind];
  const applied = input.splits
    .filter((split) => split.execution_date > input.as_filed_on && split.execution_date <= input.reference_date)
    .sort((left, right) => left.execution_date.localeCompare(right.execution_date));
  if (direction === null || applied.some((split, index) => index > 0 && split.execution_date === applied[index - 1]!.execution_date)) {
    return { ok: false, reason: "incompatible_basis" };
  }
  let factor = rationalFromDecimal({ coefficient: 1n, scale: 0 });
  const splits: SplitAdjustmentV1["splits"] = [];
  for (const split of applied) {
    const from = positiveDecimal(split.split_from);
    const to = positiveDecimal(split.split_to);
    if (from === null || to === null) return { ok: false, reason: "incompatible_basis" };
    const ratio = divideRationals(to.value, from.value);
    factor = factor === null || ratio === null ? null : multiplyRationals(factor, ratio);
    splits.push({ execution_date: split.execution_date, split_from: from.text, split_to: to.text });
  }
  const value = factor === null ? null : direction === "multiply" ? multiplyRationals(input.native, factor) : divideRationals(input.native, factor);
  if (factor === null || value === null) return { ok: false, reason: "numeric_limit_exceeded" };
  return {
    ok: true,
    adjustment: {
      version: SPLIT_ADJUSTMENT_VERSION,
      as_filed_on: input.as_filed_on,
      reference_date: input.reference_date,
      listing_id: input.listing_id,
      splits,
      factor: fraction(factor),
      adjusted_native_value: fraction(value),
    },
    value,
  };
}

/**
 * The value a bound adjustment proves for `native`: it must be the restatement
 * of exactly its own splits to the plan's reference date.
 */
export function checkSplitAdjustment(
  adjustment: SplitAdjustmentV1,
  native: ExactRational,
  valueKind: MetricValueKind,
  referenceDate: IsoDate,
): { ok: true; value: ExactRational } | { ok: false; code: "split_reference_mismatch" | "split_adjustment_mismatch" } {
  if (adjustment.reference_date !== referenceDate) return { ok: false, code: "split_reference_mismatch" };
  const recomputed = restateToReference({
    native,
    value_kind: valueKind,
    as_filed_on: adjustment.as_filed_on,
    reference_date: referenceDate,
    listing_id: adjustment.listing_id,
    splits: adjustment.splits,
  });
  if (!recomputed.ok || canonicalJson(recomputed.adjustment) !== canonicalJson(adjustment)) return { ok: false, code: "split_adjustment_mismatch" };
  return { ok: true, value: recomputed.value };
}

const DIRECTIONS: Readonly<Record<MetricValueKind, "multiply" | "divide" | null>> = {
  per_share: "divide",
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
