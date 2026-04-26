import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAnalystConsensus,
  type AnalystConsensusEnvelope,
  type ConsensusEstimate,
  type PriceTarget,
  type RatingDistribution,
} from "../src/analyst-consensus.ts";
import { aaplIssuer } from "./fixtures.ts";

const RATING_SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const PRICE_TARGET_SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const ESTIMATE_SOURCE_ID = "33333333-3333-4333-8333-333333333333";
const EPS_DILUTED_METRIC_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0011";
const REVENUE_METRIC_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0003";

function ratingDistribution(
  overrides: Partial<RatingDistribution> = {},
): RatingDistribution {
  return {
    counts: { strong_buy: 14, buy: 18, hold: 10, sell: 2, strong_sell: 1 },
    contributor_count: 45,
    as_of: "2026-04-20T13:00:00.000Z",
    source_id: RATING_SOURCE_ID,
    ...overrides,
  };
}

function priceTarget(overrides: Partial<PriceTarget> = {}): PriceTarget {
  return {
    currency: "USD",
    low: 175,
    mean: 235,
    median: 240,
    high: 300,
    contributor_count: 42,
    as_of: "2026-04-20T13:00:00.000Z",
    source_id: PRICE_TARGET_SOURCE_ID,
    ...overrides,
  };
}

function epsEstimateFy2025(overrides: Partial<ConsensusEstimate> = {}): ConsensusEstimate {
  return {
    metric_key: "eps.diluted",
    metric_id: EPS_DILUTED_METRIC_ID,
    period_kind: "fiscal_y",
    period_end: "2025-09-27",
    fiscal_year: 2025,
    fiscal_period: "FY",
    contributor_count: 38,
    mean: 7.45,
    median: 7.42,
    low: 7.10,
    high: 7.92,
    std_dev: 0.18,
    unit: "currency_per_share",
    currency: "USD",
    as_of: "2026-04-20T13:00:00.000Z",
    source_id: ESTIMATE_SOURCE_ID,
    ...overrides,
  };
}

function revenueEstimateFy2025(
  overrides: Partial<ConsensusEstimate> = {},
): ConsensusEstimate {
  return {
    metric_key: "revenue",
    metric_id: REVENUE_METRIC_ID,
    period_kind: "fiscal_y",
    period_end: "2025-09-27",
    fiscal_year: 2025,
    fiscal_period: "FY",
    contributor_count: 36,
    mean: 425_000_000_000,
    median: 423_000_000_000,
    low: 410_000_000_000,
    high: 445_000_000_000,
    unit: "currency",
    currency: "USD",
    as_of: "2026-04-20T13:00:00.000Z",
    source_id: ESTIMATE_SOURCE_ID,
    ...overrides,
  };
}

test("buildAnalystConsensus tags the envelope as analyst_consensus so consumers cannot mistake it for a Fact", () => {
  const envelope = buildAnalystConsensus({
    subject: aaplIssuer,
    analyst_count: 45,
    as_of: "2026-04-20T13:00:00.000Z",
    rating_distribution: ratingDistribution(),
    price_target: priceTarget(),
    estimates: [epsEstimateFy2025()],
  });
  assert.equal(envelope.family, "analyst_consensus");
  assert.deepEqual(envelope.subject, aaplIssuer);
  assert.equal(envelope.analyst_count, 45);
  assert.equal(envelope.as_of, "2026-04-20T13:00:00.000Z");
});

test("buildAnalystConsensus preserves rating distribution, price target, and per-period estimates with their own source_ids", () => {
  const envelope = buildAnalystConsensus({
    subject: aaplIssuer,
    analyst_count: 45,
    as_of: "2026-04-20T13:00:00.000Z",
    rating_distribution: ratingDistribution(),
    price_target: priceTarget(),
    estimates: [epsEstimateFy2025(), revenueEstimateFy2025()],
  });

  assert.deepEqual(envelope.rating_distribution?.counts, {
    strong_buy: 14,
    buy: 18,
    hold: 10,
    sell: 2,
    strong_sell: 1,
  });
  assert.equal(envelope.rating_distribution?.contributor_count, 45);
  assert.equal(envelope.rating_distribution?.source_id, RATING_SOURCE_ID);

  assert.equal(envelope.price_target?.low, 175);
  assert.equal(envelope.price_target?.mean, 235);
  assert.equal(envelope.price_target?.median, 240);
  assert.equal(envelope.price_target?.high, 300);
  assert.equal(envelope.price_target?.source_id, PRICE_TARGET_SOURCE_ID);

  assert.deepEqual(
    envelope.estimates.map((e) => [e.metric_key, e.fiscal_year, e.contributor_count, e.mean, e.source_id]),
    [
      ["eps.diluted", 2025, 38, 7.45, ESTIMATE_SOURCE_ID],
      ["revenue", 2025, 36, 425_000_000_000, ESTIMATE_SOURCE_ID],
    ],
  );
  assert.deepEqual(envelope.coverage_warnings, []);
});

test("buildAnalystConsensus emits missing_* warnings instead of fabricating empty distributions", () => {
  const envelope = buildAnalystConsensus({
    subject: aaplIssuer,
    analyst_count: 0,
    as_of: "2026-04-20T13:00:00.000Z",
  });
  assert.equal(envelope.rating_distribution, null);
  assert.equal(envelope.price_target, null);
  assert.deepEqual(envelope.estimates, []);
  const codes = envelope.coverage_warnings.map((w) => w.code).sort();
  assert.deepEqual(codes, ["missing_estimates", "missing_price_target", "missing_rating_distribution"]);
});

test("buildAnalystConsensus flags rating buckets that sum past contributor_count", () => {
  const envelope = buildAnalystConsensus({
    subject: aaplIssuer,
    analyst_count: 45,
    as_of: "2026-04-20T13:00:00.000Z",
    rating_distribution: ratingDistribution({
      counts: { strong_buy: 50, buy: 0, hold: 0, sell: 0, strong_sell: 0 },
      contributor_count: 45,
    }),
    price_target: priceTarget(),
    estimates: [epsEstimateFy2025()],
  });
  assert.deepEqual(
    envelope.coverage_warnings.filter((w) => w.code === "rating_distribution_inconsistent"),
    [
      {
        code: "rating_distribution_inconsistent",
        message: "rating_distribution counts sum to 50 but contributor_count is 45.",
      },
    ],
  );
});

test("buildAnalystConsensus flags a sub-aggregate contributor_count that exceeds the envelope analyst_count", () => {
  const envelope = buildAnalystConsensus({
    subject: aaplIssuer,
    analyst_count: 30,
    as_of: "2026-04-20T13:00:00.000Z",
    rating_distribution: ratingDistribution({ contributor_count: 45 }),
    price_target: priceTarget({ contributor_count: 40 }),
    estimates: [epsEstimateFy2025({ contributor_count: 38 })],
  });
  const codes = envelope.coverage_warnings.map((w) => w.code).sort();
  assert.deepEqual(codes, [
    "estimate_inconsistent",
    "price_target_inconsistent",
    "rating_distribution_inconsistent",
  ]);
});

test("buildAnalystConsensus flags a price_target whose low/mean/high ordering is broken", () => {
  const envelope = buildAnalystConsensus({
    subject: aaplIssuer,
    analyst_count: 45,
    as_of: "2026-04-20T13:00:00.000Z",
    rating_distribution: ratingDistribution(),
    price_target: priceTarget({ low: 250, mean: 200, median: 220, high: 300 }),
    estimates: [epsEstimateFy2025()],
  });
  const inconsistency = envelope.coverage_warnings.find(
    (w) => w.code === "price_target_inconsistent",
  );
  assert.ok(inconsistency);
  assert.match(inconsistency.message, /price_target ordering invalid/);
});

test("buildAnalystConsensus flags an estimate whose mean falls outside [low, high]", () => {
  const envelope = buildAnalystConsensus({
    subject: aaplIssuer,
    analyst_count: 45,
    as_of: "2026-04-20T13:00:00.000Z",
    rating_distribution: ratingDistribution(),
    price_target: priceTarget(),
    estimates: [epsEstimateFy2025({ low: 7.5, mean: 7.0, high: 8.0 })],
  });
  assert.deepEqual(
    envelope.coverage_warnings.filter((w) => w.code === "estimate_inconsistent"),
    [
      {
        code: "estimate_inconsistent",
        metric_key: "eps.diluted",
        period_end: "2025-09-27",
        message:
          'estimate "eps.diluted" 2025 FY ordering invalid: expected low(7.5) <= mean/median(7/7.42) <= high(8).',
      },
    ],
  );
});

test("buildAnalystConsensus flags estimate currencies that disagree with price_target currency", () => {
  const envelope = buildAnalystConsensus({
    subject: aaplIssuer,
    analyst_count: 45,
    as_of: "2026-04-20T13:00:00.000Z",
    rating_distribution: ratingDistribution(),
    price_target: priceTarget({ currency: "USD" }),
    estimates: [epsEstimateFy2025({ currency: "EUR" })],
  });
  assert.deepEqual(
    envelope.coverage_warnings.filter((w) => w.code === "estimate_currency_mismatch"),
    [
      {
        code: "estimate_currency_mismatch",
        metric_key: "eps.diluted",
        period_end: "2025-09-27",
        message: 'estimate "eps.diluted" currency EUR does not match price_target currency USD.',
      },
    ],
  );
});

test("buildAnalystConsensus flags duplicate same-source estimates but accepts the same period from a different provider", () => {
  const SECOND_SOURCE_ID = "44444444-4444-4444-8444-444444444444";
  const envelope = buildAnalystConsensus({
    subject: aaplIssuer,
    analyst_count: 45,
    as_of: "2026-04-20T13:00:00.000Z",
    rating_distribution: ratingDistribution(),
    price_target: priceTarget(),
    estimates: [
      epsEstimateFy2025(),
      epsEstimateFy2025({ mean: 7.50 }), // same source — duplicate
      epsEstimateFy2025({ source_id: SECOND_SOURCE_ID, mean: 7.40 }), // different provider — kept
    ],
  });
  assert.deepEqual(
    envelope.coverage_warnings.filter((w) => w.code === "duplicate_estimate"),
    [
      {
        code: "duplicate_estimate",
        metric_key: "eps.diluted",
        period_end: "2025-09-27",
        message: `duplicate estimate for metric_key "eps.diluted" period 2025 FY from source ${ESTIMATE_SOURCE_ID}; all copies retained.`,
      },
    ],
  );
  assert.equal(envelope.estimates.length, 3);
});

test("buildAnalystConsensus flags low_coverage per-input when contributor_count falls at or below the floor", () => {
  const envelope = buildAnalystConsensus({
    subject: aaplIssuer,
    analyst_count: 45,
    as_of: "2026-04-20T13:00:00.000Z",
    rating_distribution: ratingDistribution({
      counts: { strong_buy: 1, buy: 1, hold: 0, sell: 0, strong_sell: 0 },
      contributor_count: 2,
    }),
    price_target: priceTarget({ contributor_count: 40 }),
    estimates: [epsEstimateFy2025({ contributor_count: 1 })],
    coverage_thresholds: { min_contributor_count: 3 },
  });
  assert.deepEqual(
    envelope.coverage_warnings.filter((w) => w.code === "low_coverage"),
    [
      {
        code: "low_coverage",
        message: "rating_distribution contributor_count 2 is at or below low_coverage floor 3.",
      },
      {
        code: "low_coverage",
        metric_key: "eps.diluted",
        period_end: "2025-09-27",
        message: 'estimate "eps.diluted" 2025 FY contributor_count 1 is at or below low_coverage floor 3.',
      },
    ],
  );
});

test("buildAnalystConsensus accepts contributor_count=0 on price_target/estimate so providers can return empty rows; emits low_coverage", () => {
  const envelope = buildAnalystConsensus({
    subject: aaplIssuer,
    analyst_count: 0,
    as_of: "2026-04-20T13:00:00.000Z",
    price_target: priceTarget({ contributor_count: 0 }),
    estimates: [epsEstimateFy2025({ contributor_count: 0 })],
    coverage_thresholds: { min_contributor_count: 1 },
  });
  assert.equal(envelope.price_target?.contributor_count, 0);
  assert.equal(envelope.estimates[0].contributor_count, 0);
  assert.deepEqual(
    envelope.coverage_warnings.filter((w) => w.code === "low_coverage").map((w) => w.message),
    [
      "price_target contributor_count 0 is at or below low_coverage floor 1.",
      'estimate "eps.diluted" 2025 FY contributor_count 0 is at or below low_coverage floor 1.',
    ],
  );
});

test("buildAnalystConsensus does not emit stale_input for a future-dated provider as_of (clock skew is not staleness)", () => {
  const envelope = buildAnalystConsensus({
    subject: aaplIssuer,
    analyst_count: 45,
    as_of: "2026-04-20T13:00:00.000Z",
    rating_distribution: ratingDistribution({ as_of: "2026-04-25T13:00:00.000Z" }),
    price_target: priceTarget(),
    estimates: [epsEstimateFy2025()],
    freshness_policy: {
      as_of: "2026-04-20T13:00:00.000Z",
      max_input_age_ms: 24 * 60 * 60 * 1000,
    },
  });
  assert.equal(
    envelope.coverage_warnings.find((w) => w.code === "stale_input"),
    undefined,
  );
});

test("buildAnalystConsensus flags individual stale_input warnings against an explicit freshness policy", () => {
  const envelope = buildAnalystConsensus({
    subject: aaplIssuer,
    analyst_count: 45,
    as_of: "2026-04-20T13:00:00.000Z",
    rating_distribution: ratingDistribution({ as_of: "2026-04-01T13:00:00.000Z" }),
    price_target: priceTarget({ as_of: "2026-04-19T13:00:00.000Z" }),
    estimates: [epsEstimateFy2025({ as_of: "2026-03-15T13:00:00.000Z" })],
    freshness_policy: {
      as_of: "2026-04-20T13:00:00.000Z",
      max_input_age_ms: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  });
  const stale = envelope.coverage_warnings.filter((w) => w.code === "stale_input");
  assert.equal(stale.length, 2);
  assert.match(stale[0].message, /rating_distribution as_of 2026-04-01T13:00:00\.000Z is older/);
  assert.match(stale[1].message, /estimate "eps\.diluted" 2025 FY as_of 2026-03-15T13:00:00\.000Z is older/);
  assert.equal(stale[1].metric_key, "eps.diluted");
  assert.equal(stale[1].period_end, "2025-09-27");
});

test("buildAnalystConsensus rejects a non-issuer subject", () => {
  assert.throws(
    () =>
      buildAnalystConsensus({
        subject: { kind: "instrument", id: aaplIssuer.id } as never,
        analyst_count: 45,
        as_of: "2026-04-20T13:00:00.000Z",
        rating_distribution: ratingDistribution(),
        price_target: priceTarget(),
        estimates: [epsEstimateFy2025()],
      }),
    /analystConsensus.subject: must be an issuer SubjectRef/,
  );
});

test("buildAnalystConsensus rejects a negative analyst_count", () => {
  assert.throws(
    () =>
      buildAnalystConsensus({
        subject: aaplIssuer,
        analyst_count: -1,
        as_of: "2026-04-20T13:00:00.000Z",
      }),
    /analystConsensus.analyst_count: must be a non-negative integer/,
  );
});

test("buildAnalystConsensus rejects an estimate whose period_kind is incompatible with fiscal_period", () => {
  assert.throws(
    () =>
      buildAnalystConsensus({
        subject: aaplIssuer,
        analyst_count: 45,
        as_of: "2026-04-20T13:00:00.000Z",
        estimates: [epsEstimateFy2025({ period_kind: "fiscal_q", fiscal_period: "FY" })],
      }),
    /period_kind="fiscal_q" requires Q1\.\.Q4/,
  );
});

test("buildAnalystConsensus rejects ttm and point period kinds — analysts publish quarterly and annual estimates only", () => {
  assert.throws(
    () =>
      buildAnalystConsensus({
        subject: aaplIssuer,
        analyst_count: 45,
        as_of: "2026-04-20T13:00:00.000Z",
        estimates: [epsEstimateFy2025({ period_kind: "ttm" as never })],
      }),
    /must be one of fiscal_q, fiscal_y/,
  );
});

test("buildAnalystConsensus rejects negative rating bucket counts", () => {
  assert.throws(
    () =>
      buildAnalystConsensus({
        subject: aaplIssuer,
        analyst_count: 45,
        as_of: "2026-04-20T13:00:00.000Z",
        rating_distribution: ratingDistribution({
          counts: { strong_buy: -1, buy: 0, hold: 0, sell: 0, strong_sell: 0 },
        }),
      }),
    /counts\.strong_buy: must be a non-negative integer/,
  );
});

test("buildAnalystConsensus returns a deeply-frozen envelope so callers cannot mutate consensus state", () => {
  const envelope: AnalystConsensusEnvelope = buildAnalystConsensus({
    subject: aaplIssuer,
    analyst_count: 45,
    as_of: "2026-04-20T13:00:00.000Z",
    rating_distribution: ratingDistribution(),
    price_target: priceTarget(),
    estimates: [epsEstimateFy2025()],
  });
  assert.ok(Object.isFrozen(envelope));
  assert.ok(Object.isFrozen(envelope.rating_distribution));
  assert.ok(Object.isFrozen(envelope.rating_distribution?.counts));
  assert.ok(Object.isFrozen(envelope.price_target));
  assert.ok(Object.isFrozen(envelope.estimates));
  assert.ok(Object.isFrozen(envelope.estimates[0]));
  assert.ok(Object.isFrozen(envelope.coverage_warnings));
});
