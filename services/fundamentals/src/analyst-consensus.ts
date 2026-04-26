// Analyst-consensus aggregation (spec §6.3.3).
//
// Consensus is an aggregate of analyst opinion, NOT an observed fact
// about the issuer. The `family: "analyst_consensus"` envelope tag is
// load-bearing: it tells downstream consumers that a "consensus EPS"
// value has nothing to do with reported EPS in a Fact row, and the two
// must never be merged into the same series.
//
// This module composes three independent inputs into one envelope:
// (1) rating distribution counts (strong_buy ... strong_sell), (2) a
// price-target summary (low/mean/median/high), and (3) per-period
// metric estimates (typically eps_diluted and revenue for forward
// fiscal years). Each input retains its own source_id and as_of so
// freshness and provider can be inspected at the leaf.

import { FISCAL_PERIODS, type FiscalPeriod, type PeriodKind } from "./statement.ts";
import { freezeIssuerRef, type IssuerSubjectRef, type UUID } from "./subject-ref.ts";
import {
  assertCurrency,
  assertFiniteNumber,
  assertIso8601Utc,
  assertIsoDate,
  assertMetricKey,
  assertNonNegativeInteger,
  assertOneOf,
  assertUuid,
} from "./validators.ts";

export type AnalystRating = "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";

export const ANALYST_RATINGS: ReadonlyArray<AnalystRating> = [
  "strong_buy",
  "buy",
  "hold",
  "sell",
  "strong_sell",
];

// Forward-looking period kinds — analysts publish quarter and full-year
// estimates; "point" (balance-sheet stocks) and "ttm" don't apply.
const CONSENSUS_PERIOD_KINDS: ReadonlyArray<PeriodKind> = ["fiscal_q", "fiscal_y"];

export type AnalystRatingCounts = Readonly<Record<AnalystRating, number>>;

export type RatingDistribution = {
  counts: AnalystRatingCounts;
  contributor_count: number;
  as_of: string;
  source_id: UUID;
};

export type PriceTarget = {
  currency: string;
  low: number;
  mean: number;
  median: number;
  high: number;
  contributor_count: number;
  as_of: string;
  source_id: UUID;
};

export type ConsensusEstimate = {
  metric_key: string;
  metric_id: UUID;
  period_kind: PeriodKind;
  period_end: string;
  fiscal_year: number;
  fiscal_period: FiscalPeriod;
  contributor_count: number;
  mean: number;
  median: number;
  low: number;
  high: number;
  std_dev?: number;
  unit: string;
  currency?: string;
  as_of: string;
  source_id: UUID;
};

export type ConsensusCoverageWarningCode =
  | "low_coverage"
  | "stale_input"
  | "missing_rating_distribution"
  | "missing_price_target"
  | "missing_estimates"
  | "rating_distribution_inconsistent"
  | "price_target_inconsistent"
  | "estimate_inconsistent"
  | "estimate_currency_mismatch"
  | "duplicate_estimate";

export type ConsensusCoverageWarning = {
  code: ConsensusCoverageWarningCode;
  message: string;
  metric_key?: string;
  period_end?: string;
};

export type ConsensusFreshnessPolicy = {
  as_of: string;
  max_input_age_ms?: number;
};

export type ConsensusCoverageThresholds = {
  // analyst counts at or below this floor produce a low_coverage warning
  // (per-input, evaluated against contributor_count).
  min_contributor_count?: number;
};

export type BuildAnalystConsensusInput = {
  subject: IssuerSubjectRef;
  analyst_count: number;
  as_of: string;
  rating_distribution?: RatingDistribution;
  price_target?: PriceTarget;
  estimates?: ReadonlyArray<ConsensusEstimate>;
  freshness_policy?: ConsensusFreshnessPolicy;
  coverage_thresholds?: ConsensusCoverageThresholds;
};

export type AnalystConsensusEnvelope = {
  subject: IssuerSubjectRef;
  family: "analyst_consensus";
  analyst_count: number;
  as_of: string;
  rating_distribution: RatingDistribution | null;
  price_target: PriceTarget | null;
  estimates: ReadonlyArray<ConsensusEstimate>;
  coverage_warnings: ReadonlyArray<ConsensusCoverageWarning>;
};

export function buildAnalystConsensus(
  input: BuildAnalystConsensusInput,
): AnalystConsensusEnvelope {
  assertEnvelope(input);
  if (input.freshness_policy) {
    assertFreshnessPolicy(input.freshness_policy, "analystConsensus.freshness_policy");
  }
  if (input.coverage_thresholds) {
    assertCoverageThresholds(input.coverage_thresholds, "analystConsensus.coverage_thresholds");
  }

  const warnings: ConsensusCoverageWarning[] = [];

  const ratingDistribution = input.rating_distribution
    ? freezeRatingDistribution(
        assertRatingDistribution(input.rating_distribution, "analystConsensus.rating_distribution"),
      )
    : null;
  if (!ratingDistribution) {
    warnings.push({
      code: "missing_rating_distribution",
      message: "analyst_consensus envelope has no rating_distribution input.",
    });
  } else {
    const sum =
      ratingDistribution.counts.strong_buy +
      ratingDistribution.counts.buy +
      ratingDistribution.counts.hold +
      ratingDistribution.counts.sell +
      ratingDistribution.counts.strong_sell;
    if (sum > ratingDistribution.contributor_count) {
      warnings.push({
        code: "rating_distribution_inconsistent",
        message: `rating_distribution counts sum to ${sum} but contributor_count is ${ratingDistribution.contributor_count}.`,
      });
    }
    if (ratingDistribution.contributor_count > input.analyst_count) {
      warnings.push({
        code: "rating_distribution_inconsistent",
        message: `rating_distribution contributor_count ${ratingDistribution.contributor_count} exceeds envelope analyst_count ${input.analyst_count}.`,
      });
    }
  }

  const priceTarget = input.price_target
    ? freezePriceTarget(assertPriceTarget(input.price_target, "analystConsensus.price_target"))
    : null;
  if (!priceTarget) {
    warnings.push({
      code: "missing_price_target",
      message: "analyst_consensus envelope has no price_target input.",
    });
  } else {
    if (priceTarget.contributor_count > input.analyst_count) {
      warnings.push({
        code: "price_target_inconsistent",
        message: `price_target contributor_count ${priceTarget.contributor_count} exceeds envelope analyst_count ${input.analyst_count}.`,
      });
    }
    if (
      !(priceTarget.low <= priceTarget.mean &&
        priceTarget.mean <= priceTarget.high &&
        priceTarget.low <= priceTarget.median &&
        priceTarget.median <= priceTarget.high)
    ) {
      warnings.push({
        code: "price_target_inconsistent",
        message: `price_target ordering invalid: expected low(${priceTarget.low}) <= mean/median(${priceTarget.mean}/${priceTarget.median}) <= high(${priceTarget.high}).`,
      });
    }
  }

  const floor = input.coverage_thresholds?.min_contributor_count;
  const stalePolicy = input.freshness_policy?.max_input_age_ms !== undefined
    ? { policyMs: Date.parse(input.freshness_policy.as_of), max: input.freshness_policy.max_input_age_ms }
    : undefined;

  if (floor !== undefined && ratingDistribution && ratingDistribution.contributor_count <= floor) {
    warnings.push({
      code: "low_coverage",
      message: `rating_distribution contributor_count ${ratingDistribution.contributor_count} is at or below low_coverage floor ${floor}.`,
    });
  }
  if (floor !== undefined && priceTarget && priceTarget.contributor_count <= floor) {
    warnings.push({
      code: "low_coverage",
      message: `price_target contributor_count ${priceTarget.contributor_count} is at or below low_coverage floor ${floor}.`,
    });
  }
  if (stalePolicy && ratingDistribution) {
    pushIfStale(warnings, "rating_distribution", ratingDistribution.as_of, stalePolicy.policyMs, stalePolicy.max);
  }
  if (stalePolicy && priceTarget) {
    pushIfStale(warnings, "price_target", priceTarget.as_of, stalePolicy.policyMs, stalePolicy.max);
  }

  const estimates: ConsensusEstimate[] = [];
  const seenEstimateKeys = new Set<string>();
  if (!input.estimates || input.estimates.length === 0) {
    warnings.push({
      code: "missing_estimates",
      message: "analyst_consensus envelope has no per-period estimates.",
    });
  } else {
    for (let i = 0; i < input.estimates.length; i++) {
      const label = `analystConsensus.estimates[${i}]`;
      const e = assertEstimate(input.estimates[i], label);
      // source_id is part of the key — multi-provider coverage of the same
      // (metric, period) is the normal case, not a duplicate. Only the
      // same provider repeating the same row is a real duplicate.
      const dedupKey = `${e.metric_key}::${e.fiscal_year}::${e.fiscal_period}::${e.source_id}`;
      if (seenEstimateKeys.has(dedupKey)) {
        warnings.push({
          code: "duplicate_estimate",
          metric_key: e.metric_key,
          period_end: e.period_end,
          message: `duplicate estimate for metric_key "${e.metric_key}" period ${e.fiscal_year} ${e.fiscal_period} from source ${e.source_id}; all copies retained.`,
        });
      } else {
        seenEstimateKeys.add(dedupKey);
      }
      if (e.contributor_count > input.analyst_count) {
        warnings.push({
          code: "estimate_inconsistent",
          metric_key: e.metric_key,
          period_end: e.period_end,
          message: `estimate "${e.metric_key}" ${e.fiscal_year} ${e.fiscal_period} contributor_count ${e.contributor_count} exceeds envelope analyst_count ${input.analyst_count}.`,
        });
      }
      if (
        !(e.low <= e.mean &&
          e.mean <= e.high &&
          e.low <= e.median &&
          e.median <= e.high)
      ) {
        warnings.push({
          code: "estimate_inconsistent",
          metric_key: e.metric_key,
          period_end: e.period_end,
          message: `estimate "${e.metric_key}" ${e.fiscal_year} ${e.fiscal_period} ordering invalid: expected low(${e.low}) <= mean/median(${e.mean}/${e.median}) <= high(${e.high}).`,
        });
      }
      if (
        priceTarget &&
        e.currency !== undefined &&
        e.currency !== priceTarget.currency
      ) {
        warnings.push({
          code: "estimate_currency_mismatch",
          metric_key: e.metric_key,
          period_end: e.period_end,
          message: `estimate "${e.metric_key}" currency ${e.currency} does not match price_target currency ${priceTarget.currency}.`,
        });
      }
      if (floor !== undefined && e.contributor_count <= floor) {
        warnings.push({
          code: "low_coverage",
          metric_key: e.metric_key,
          period_end: e.period_end,
          message: `estimate "${e.metric_key}" ${e.fiscal_year} ${e.fiscal_period} contributor_count ${e.contributor_count} is at or below low_coverage floor ${floor}.`,
        });
      }
      if (stalePolicy) {
        pushIfStale(
          warnings,
          `estimate "${e.metric_key}" ${e.fiscal_year} ${e.fiscal_period}`,
          e.as_of,
          stalePolicy.policyMs,
          stalePolicy.max,
          e.metric_key,
          e.period_end,
        );
      }
      estimates.push(freezeEstimate(e));
    }
  }

  return Object.freeze({
    subject: freezeIssuerRef(input.subject, "analystConsensus.subject"),
    family: "analyst_consensus",
    analyst_count: input.analyst_count,
    as_of: input.as_of,
    rating_distribution: ratingDistribution,
    price_target: priceTarget,
    estimates: Object.freeze(estimates),
    coverage_warnings: Object.freeze(warnings.map((w) => Object.freeze({ ...w }))),
  });
}

function pushIfStale(
  warnings: ConsensusCoverageWarning[],
  label: string,
  inputAsOf: string,
  policyMs: number,
  maxAgeMs: number,
  metric_key?: string,
  period_end?: string,
): void {
  // Clamp to >= 0 so a future-dated input (clock skew on the provider
  // side) is treated as fresh rather than as a large negative age that
  // silently bypasses the threshold.
  const ageMs = Math.max(0, policyMs - Date.parse(inputAsOf));
  if (ageMs <= maxAgeMs) return;
  const warning: ConsensusCoverageWarning = {
    code: "stale_input",
    message: `${label} as_of ${inputAsOf} is older than freshness policy by ${ageMs}ms.`,
  };
  if (metric_key !== undefined) warning.metric_key = metric_key;
  if (period_end !== undefined) warning.period_end = period_end;
  warnings.push(warning);
}

function assertEnvelope(input: BuildAnalystConsensusInput): void {
  freezeIssuerRef(input.subject, "analystConsensus.subject");
  assertNonNegativeInteger(input.analyst_count, "analystConsensus.analyst_count");
  assertIso8601Utc(input.as_of, "analystConsensus.as_of");
  if (input.estimates !== undefined && !Array.isArray(input.estimates)) {
    throw new Error("analystConsensus.estimates: must be an array when present");
  }
}

function assertRatingDistribution(
  d: RatingDistribution,
  label: string,
): RatingDistribution {
  if (d === null || typeof d !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  if (d.counts === null || typeof d.counts !== "object") {
    throw new Error(`${label}.counts: must be an object`);
  }
  for (const rating of ANALYST_RATINGS) {
    assertNonNegativeInteger(d.counts[rating], `${label}.counts.${rating}`);
  }
  assertNonNegativeInteger(d.contributor_count, `${label}.contributor_count`);
  assertIso8601Utc(d.as_of, `${label}.as_of`);
  assertUuid(d.source_id, `${label}.source_id`);
  return d;
}

function assertPriceTarget(p: PriceTarget, label: string): PriceTarget {
  if (p === null || typeof p !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  assertCurrency(p.currency, `${label}.currency`);
  assertFiniteNumber(p.low, `${label}.low`);
  assertFiniteNumber(p.mean, `${label}.mean`);
  assertFiniteNumber(p.median, `${label}.median`);
  assertFiniteNumber(p.high, `${label}.high`);
  assertNonNegativeInteger(p.contributor_count, `${label}.contributor_count`);
  assertIso8601Utc(p.as_of, `${label}.as_of`);
  assertUuid(p.source_id, `${label}.source_id`);
  return p;
}

function assertEstimate(e: ConsensusEstimate, label: string): ConsensusEstimate {
  if (e === null || typeof e !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  assertMetricKey(e.metric_key, `${label}.metric_key`);
  assertUuid(e.metric_id, `${label}.metric_id`);
  assertOneOf(e.period_kind, CONSENSUS_PERIOD_KINDS, `${label}.period_kind`);
  assertIsoDate(e.period_end, `${label}.period_end`);
  assertNonNegativeInteger(e.fiscal_year, `${label}.fiscal_year`);
  assertOneOf(e.fiscal_period, FISCAL_PERIODS, `${label}.fiscal_period`);
  if (e.period_kind === "fiscal_q" && e.fiscal_period === "FY") {
    throw new Error(
      `${label}.fiscal_period: period_kind="fiscal_q" requires Q1..Q4; received "FY"`,
    );
  }
  if (e.period_kind === "fiscal_y" && e.fiscal_period !== "FY") {
    throw new Error(
      `${label}.fiscal_period: period_kind="fiscal_y" requires "FY"; received "${e.fiscal_period}"`,
    );
  }
  assertNonNegativeInteger(e.contributor_count, `${label}.contributor_count`);
  assertFiniteNumber(e.mean, `${label}.mean`);
  assertFiniteNumber(e.median, `${label}.median`);
  assertFiniteNumber(e.low, `${label}.low`);
  assertFiniteNumber(e.high, `${label}.high`);
  if (e.std_dev !== undefined) {
    assertFiniteNumber(e.std_dev, `${label}.std_dev`);
    if (e.std_dev < 0) {
      throw new Error(`${label}.std_dev: must be >= 0; received ${e.std_dev}`);
    }
  }
  if (typeof e.unit !== "string" || e.unit.length === 0) {
    throw new Error(`${label}.unit: must be a non-empty string`);
  }
  if (e.currency !== undefined) {
    assertCurrency(e.currency, `${label}.currency`);
  }
  assertIso8601Utc(e.as_of, `${label}.as_of`);
  assertUuid(e.source_id, `${label}.source_id`);
  return e;
}

function assertFreshnessPolicy(p: ConsensusFreshnessPolicy, label: string): void {
  assertIso8601Utc(p.as_of, `${label}.as_of`);
  if (p.max_input_age_ms !== undefined) {
    assertFiniteNumber(p.max_input_age_ms, `${label}.max_input_age_ms`);
    if (p.max_input_age_ms <= 0) {
      throw new Error(
        `${label}.max_input_age_ms: must be positive; received ${p.max_input_age_ms}`,
      );
    }
  }
}

function assertCoverageThresholds(
  t: ConsensusCoverageThresholds,
  label: string,
): void {
  if (t.min_contributor_count !== undefined) {
    assertNonNegativeInteger(t.min_contributor_count, `${label}.min_contributor_count`);
  }
}

function freezeRatingDistribution(d: RatingDistribution): RatingDistribution {
  return Object.freeze({
    counts: Object.freeze({
      strong_buy: d.counts.strong_buy,
      buy: d.counts.buy,
      hold: d.counts.hold,
      sell: d.counts.sell,
      strong_sell: d.counts.strong_sell,
    }),
    contributor_count: d.contributor_count,
    as_of: d.as_of,
    source_id: d.source_id,
  });
}

function freezePriceTarget(p: PriceTarget): PriceTarget {
  return Object.freeze({
    currency: p.currency,
    low: p.low,
    mean: p.mean,
    median: p.median,
    high: p.high,
    contributor_count: p.contributor_count,
    as_of: p.as_of,
    source_id: p.source_id,
  });
}

function freezeEstimate(e: ConsensusEstimate): ConsensusEstimate {
  const out: ConsensusEstimate = {
    metric_key: e.metric_key,
    metric_id: e.metric_id,
    period_kind: e.period_kind,
    period_end: e.period_end,
    fiscal_year: e.fiscal_year,
    fiscal_period: e.fiscal_period,
    contributor_count: e.contributor_count,
    mean: e.mean,
    median: e.median,
    low: e.low,
    high: e.high,
    unit: e.unit,
    as_of: e.as_of,
    source_id: e.source_id,
  };
  if (e.std_dev !== undefined) out.std_dev = e.std_dev;
  if (e.currency !== undefined) out.currency = e.currency;
  return Object.freeze(out);
}
