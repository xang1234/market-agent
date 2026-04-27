import type { ConsensusRepositoryRecord } from "./consensus-repository.ts";
import { DEV_ISSUER_PROFILES } from "./dev-fixtures.ts";
import { METRIC_ID } from "./dev-stats-fixtures.ts";
import type { UUID } from "./subject-ref.ts";

export const DEV_CONSENSUS_SOURCE_ID: UUID = "00000000-0000-4000-a000-000000000008";

const APPLE_ISSUER = DEV_ISSUER_PROFILES[0].subject;

const APPLE_AS_OF = "2026-04-25T20:00:00.000Z";

export const DEV_CONSENSUS_INPUTS: ReadonlyArray<ConsensusRepositoryRecord> = [
  {
    subject_id: APPLE_ISSUER.id,
    inputs: {
      subject: APPLE_ISSUER,
      analyst_count: 41,
      as_of: APPLE_AS_OF,
      rating_distribution: {
        counts: {
          strong_buy: 14,
          buy: 17,
          hold: 8,
          sell: 1,
          strong_sell: 1,
        },
        contributor_count: 41,
        as_of: APPLE_AS_OF,
        source_id: DEV_CONSENSUS_SOURCE_ID,
      },
      price_target: {
        currency: "USD",
        low: 170,
        mean: 220.5,
        median: 215,
        high: 280,
        contributor_count: 38,
        as_of: APPLE_AS_OF,
        source_id: DEV_CONSENSUS_SOURCE_ID,
      },
      estimates: [
        {
          metric_key: "eps_diluted",
          metric_id: METRIC_ID.eps_diluted,
          period_kind: "fiscal_y",
          period_end: "2026-09-26",
          fiscal_year: 2026,
          fiscal_period: "FY",
          contributor_count: 36,
          mean: 7.22,
          median: 7.2,
          low: 6.85,
          high: 7.65,
          std_dev: 0.18,
          unit: "currency_per_share",
          currency: "USD",
          as_of: APPLE_AS_OF,
          source_id: DEV_CONSENSUS_SOURCE_ID,
        },
        {
          metric_key: "revenue",
          metric_id: METRIC_ID.revenue,
          period_kind: "fiscal_y",
          period_end: "2026-09-26",
          fiscal_year: 2026,
          fiscal_period: "FY",
          contributor_count: 34,
          mean: 421_500_000_000,
          median: 420_000_000_000,
          low: 405_000_000_000,
          high: 442_000_000_000,
          std_dev: 8_400_000_000,
          unit: "currency",
          currency: "USD",
          as_of: APPLE_AS_OF,
          source_id: DEV_CONSENSUS_SOURCE_ID,
        },
      ],
    },
  },
];
