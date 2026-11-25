// The base rate a Call sets its required growth against: of the five-year
// windows that began at a similar size (by starting revenue), how many
// delivered a growth, and the 25th and 50th percentiles of what they
// delivered (the bear and base cases' growth). The
// table is data/growth-base-rates.json, built offline from SEC's bulk
// companyfacts archive (services/fundamentals/src/growth-base-rates.ts). It is
// a frequency of reported history, not a probability, and never certified.

import { parseFinancialDecimal } from "./exact-decimal.ts";
import { compareRationals, rationalFromDecimal, rationalSign, type ExactRational } from "./rational.ts";

export const BASE_RATE_METRICS = ["fcf_per_share", "fcf", "revenue"] as const;
export type BaseRateMetric = (typeof BASE_RATE_METRICS)[number];
export const BASE_RATE_OUTCOMES = ["non_positive_base", "ended_early", "missing_end", "incompatible_definition", "missing_shares"] as const;
export type BaseRateOutcome = (typeof BASE_RATE_OUTCOMES)[number];

/** A bucket needs at least this many windows with a growth before it gives a base rate. */
export const MIN_BASE_RATE_WINDOWS = 100;

export type BaseRateMetricTable = Readonly<{
  /** Each window's five-year annual growth, ascending; -1 is the floor for an end at or below zero. */
  points: ReadonlyArray<ExactRational>;
  non_positive_end: number;
  outcomes: Readonly<Record<BaseRateOutcome, number>>;
}>;

export type BaseRateBucket = Readonly<{
  id: string;
  revenue_min: ExactRational;
  revenue_max: ExactRational | null;
  filers: number;
  metrics: Readonly<Record<BaseRateMetric, BaseRateMetricTable>>;
}>;

export type GrowthBaseRates = Readonly<{
  archive: Readonly<{ file: string; date: string; sha256: string }>;
  horizon_years: number;
  start_years: Readonly<{ first: number; last: number }>;
  buckets: ReadonlyArray<BaseRateBucket>;
}>;

export type BaseRate =
  | Readonly<{
    kind: "value";
    bucket: BaseRateBucket;
    /** Windows with a growth. */
    n: number;
    /** Of those, the ones whose growth was at or above the one asked about. */
    at_or_above: number;
    /** The nearest-rank 25th percentile: the point at rank ceil(n / 4). */
    p25: ExactRational;
    /** The nearest-rank median: the point at rank ceil(n / 2). */
    p50: ExactRational;
    non_positive_end: number;
    outcomes: Readonly<Record<BaseRateOutcome, number>>;
  }>
  | Readonly<{ kind: "outcome"; outcome: "no_bucket" | "thin_bucket"; bucket: BaseRateBucket | null; n: number }>;

/** The growth a bucket's windows delivered, set against `growth`: declined when no bucket holds the revenue, or it holds too few windows. */
export function growthBaseRate(table: GrowthBaseRates, metric: BaseRateMetric, startingRevenue: ExactRational, growth: ExactRational): BaseRate {
  const bucket = rationalSign(startingRevenue) <= 0 ? undefined : table.buckets.find((entry) =>
    compareRationals(startingRevenue, entry.revenue_min) >= 0 && (entry.revenue_max === null || compareRationals(startingRevenue, entry.revenue_max) < 0));
  if (bucket === undefined) return { kind: "outcome", outcome: "no_bucket", bucket: null, n: 0 };
  const { points, non_positive_end, outcomes } = bucket.metrics[metric];
  if (points.length < MIN_BASE_RATE_WINDOWS) return { kind: "outcome", outcome: "thin_bucket", bucket, n: points.length };
  // The first point at or above `growth`: every point from there on is.
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (compareRationals(points[middle]!, growth) < 0) low = middle + 1;
    else high = middle;
  }
  return { kind: "value", bucket, n: points.length, at_or_above: points.length - low, p25: points[Math.ceil(points.length / 4) - 1]!,
    p50: points[Math.ceil(points.length / 2) - 1]!, non_positive_end, outcomes };
}

/** The table data/growth-base-rates.json holds, or null when any part of it is not what the builder writes. */
export function parseGrowthBaseRates(json: unknown): GrowthBaseRates | null {
  if (!isRecord(json) || json.version !== "growth_base_rates.v1" || !isRecord(json.archive) || !isRecord(json.start_years) || !Array.isArray(json.buckets)) return null;
  const { file, date, sha256 } = json.archive;
  if (typeof file !== "string" || typeof date !== "string" || typeof sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(sha256)) return null;
  const { first, last } = json.start_years;
  if (!Number.isInteger(json.horizon_years) || !Number.isInteger(first) || !Number.isInteger(last)) return null;
  const buckets: BaseRateBucket[] = [];
  for (const entry of json.buckets as unknown[]) {
    const bucket = parseBucket(entry);
    if (bucket === null) return null;
    buckets.push(bucket);
  }
  return { archive: { file, date, sha256 }, horizon_years: json.horizon_years as number, start_years: { first: first as number, last: last as number }, buckets };
}

function parseBucket(entry: unknown): BaseRateBucket | null {
  if (!isRecord(entry) || typeof entry.id !== "string" || !Number.isInteger(entry.filers) || !isRecord(entry.metrics)) return null;
  const min = typeof entry.revenue_min === "string" ? exact(entry.revenue_min) : null;
  const max = entry.revenue_max === null ? null : typeof entry.revenue_max === "string" ? exact(entry.revenue_max) : undefined;
  if (min === null || max === undefined || (max !== null && compareRationals(min, max) >= 0)) return null;
  const metrics: Partial<Record<BaseRateMetric, BaseRateMetricTable>> = {};
  for (const metric of BASE_RATE_METRICS) {
    const rates = entry.metrics[metric];
    if (!isRecord(rates) || !Array.isArray(rates.points) || rates.n !== rates.points.length || !Number.isInteger(rates.non_positive_end) || !isRecord(rates.outcomes)) return null;
    const points = (rates.points as unknown[]).map((point) => typeof point === "string" ? exact(point) : null);
    if (points.some((point, index) => point === null || (index > 0 && compareRationals(points[index - 1]!, point) > 0))) return null;
    const outcomes = Object.fromEntries(BASE_RATE_OUTCOMES.map((name) => [name, (rates.outcomes as Record<string, unknown>)[name]]));
    if (Object.values(outcomes).some((count) => !Number.isInteger(count))) return null;
    metrics[metric] = { points: points as ExactRational[], non_positive_end: rates.non_positive_end as number, outcomes: outcomes as Record<BaseRateOutcome, number> };
  }
  return { id: entry.id, revenue_min: min, revenue_max: max, filers: entry.filers as number, metrics: metrics as Record<BaseRateMetric, BaseRateMetricTable> };
}

function exact(text: string): ExactRational | null {
  const parsed = parseFinancialDecimal(text);
  return parsed.ok ? rationalFromDecimal(parsed.value) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
