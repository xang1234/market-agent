import {
  assertListingRef,
  freezeListingRef,
  type ListingSubjectRef,
  type UUID,
} from "./subject-ref.ts";
import { DELAY_CLASSES, type DelayClass } from "./quote.ts";
import {
  assertCurrency,
  assertFiniteNonNegative,
  assertFinitePositive,
  assertIso8601Utc,
  assertOneOf,
  assertUuid,
} from "./validators.ts";

export type BarInterval =
  | "1m"
  | "5m"
  | "15m"
  | "1h"
  | "1d";

export const BAR_INTERVALS: ReadonlyArray<BarInterval> = [
  "1m",
  "5m",
  "15m",
  "1h",
  "1d",
];

export type AdjustmentBasis =
  | "unadjusted"
  | "split_adjusted"
  | "split_and_div_adjusted";

export const ADJUSTMENT_BASES: ReadonlyArray<AdjustmentBasis> = [
  "unadjusted",
  "split_adjusted",
  "split_and_div_adjusted",
];

export type NormalizedBar = {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type BarRange = {
  // Half-open [start, end). `end` is exclusive so callers can request the
  // current session without ambiguity about whether the latest forming bar
  // is included.
  start: string;
  end: string;
};

export type NormalizedBars = {
  listing: ListingSubjectRef;
  interval: BarInterval;
  range: BarRange;
  bars: NormalizedBar[];
  as_of: string;
  delay_class: DelayClass;
  currency: string;
  source_id: UUID;
  adjustment_basis: AdjustmentBasis;
};

export function normalizedBars(input: NormalizedBars): NormalizedBars {
  const listing = freezeListingRef(input.listing, "normalizedBars");
  assertOneOf(input.interval, BAR_INTERVALS, "normalizedBars.interval");
  assertBarRange(input.range, "normalizedBars.range");
  assertIso8601Utc(input.as_of, "normalizedBars.as_of");
  assertOneOf(input.delay_class, DELAY_CLASSES, "normalizedBars.delay_class");
  assertCurrency(input.currency, "normalizedBars.currency");
  assertUuid(input.source_id, "normalizedBars.source_id");
  assertOneOf(input.adjustment_basis, ADJUSTMENT_BASES, "normalizedBars.adjustment_basis");

  if (!Array.isArray(input.bars)) {
    throw new Error("normalizedBars.bars: must be an array");
  }
  const startMs = Date.parse(input.range.start);
  const endMs = Date.parse(input.range.end);
  let prevMs = -Infinity;
  for (let i = 0; i < input.bars.length; i++) {
    const bar = input.bars[i];
    assertNormalizedBar(bar, i);
    const barMs = Date.parse(bar.ts);
    if (barMs < startMs || barMs >= endMs) {
      throw new Error(
        `normalizedBars.bars[${i}].ts: ${bar.ts} falls outside requested range [${input.range.start}, ${input.range.end})`,
      );
    }
    if (barMs <= prevMs) {
      throw new Error(
        `normalizedBars.bars[${i}].ts: ${bar.ts} is not strictly after the previous bar's timestamp`,
      );
    }
    prevMs = barMs;
  }

  const range = Object.freeze({ start: input.range.start, end: input.range.end });
  const bars = input.bars.map((b) => Object.freeze({ ...b }));
  Object.freeze(bars);

  return Object.freeze({
    listing,
    interval: input.interval,
    range,
    bars,
    as_of: input.as_of,
    delay_class: input.delay_class,
    currency: input.currency,
    source_id: input.source_id,
    adjustment_basis: input.adjustment_basis,
  });
}

export function assertBarsContract(value: unknown): asserts value is NormalizedBars {
  if (value === null || typeof value !== "object") {
    throw new Error("bars: must be an object");
  }
  const r = value as Record<string, unknown>;

  assertListingRef(r.listing, "bars.listing");

  assertOneOf(r.interval, BAR_INTERVALS, "bars.interval");
  assertBarRange(r.range, "bars.range");
  assertIso8601Utc(r.as_of, "bars.as_of");
  assertOneOf(r.delay_class, DELAY_CLASSES, "bars.delay_class");
  assertCurrency(r.currency, "bars.currency");
  assertUuid(r.source_id, "bars.source_id");
  assertOneOf(r.adjustment_basis, ADJUSTMENT_BASES, "bars.adjustment_basis");

  if (!Array.isArray(r.bars)) {
    throw new Error("bars.bars: must be an array");
  }
  const range = r.range as BarRange;
  const startMs = Date.parse(range.start);
  const endMs = Date.parse(range.end);
  let prevMs = -Infinity;
  for (let i = 0; i < r.bars.length; i++) {
    assertNormalizedBar(r.bars[i], i);
    const bar = r.bars[i] as NormalizedBar;
    const barMs = Date.parse(bar.ts);
    if (barMs < startMs || barMs >= endMs) {
      throw new Error(
        `bars.bars[${i}].ts: ${bar.ts} falls outside requested range [${range.start}, ${range.end})`,
      );
    }
    if (barMs <= prevMs) {
      throw new Error(
        `bars.bars[${i}].ts: ${bar.ts} is not strictly after the previous bar's timestamp`,
      );
    }
    prevMs = barMs;
  }
}

export function assertBarRange(value: unknown, label: string): asserts value is BarRange {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label}: must be an object with start and end`);
  }
  const r = value as { start?: unknown; end?: unknown };
  assertIso8601Utc(r.start, `${label}.start`);
  assertIso8601Utc(r.end, `${label}.end`);
  if (Date.parse(r.start) >= Date.parse(r.end)) {
    throw new Error(`${label}: start must be strictly before end`);
  }
}

function assertNormalizedBar(value: unknown, index: number): asserts value is NormalizedBar {
  if (value === null || typeof value !== "object") {
    throw new Error(`bars[${index}]: must be an object`);
  }
  const b = value as Record<string, unknown>;
  assertIso8601Utc(b.ts, `bars[${index}].ts`);
  assertFinitePositive(b.open, `bars[${index}].open`);
  assertFinitePositive(b.high, `bars[${index}].high`);
  assertFinitePositive(b.low, `bars[${index}].low`);
  assertFinitePositive(b.close, `bars[${index}].close`);
  assertFiniteNonNegative(b.volume, `bars[${index}].volume`);

  const high = b.high as number;
  const low = b.low as number;
  const open = b.open as number;
  const close = b.close as number;
  if (high < low) {
    throw new Error(`bars[${index}]: high (${high}) must be >= low (${low})`);
  }
  if (high < open || high < close) {
    throw new Error(`bars[${index}]: high (${high}) must be >= max(open, close)`);
  }
  if (low > open || low > close) {
    throw new Error(`bars[${index}]: low (${low}) must be <= min(open, close)`);
  }
}
