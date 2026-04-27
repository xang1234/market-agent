import { DEV_ISSUER_PROFILES } from "./dev-fixtures.ts";
import type { EarningsEventsEnvelopeInput } from "./earnings.ts";
import type { UUID } from "./subject-ref.ts";

export const DEV_EARNINGS_SOURCE_ID: UUID = "00000000-0000-4000-a000-000000000007";

const APPLE_ISSUER = DEV_ISSUER_PROFILES[0].subject;
const APPLE_AS_OF = "2024-11-01T20:30:00.000Z";

// Apple's last 8 reported quarters (FY2023 Q1 through FY2024 Q4). Numbers
// approximate the reported diluted EPS and the at-release consensus estimate.
export const DEV_EARNINGS_INPUTS: ReadonlyArray<EarningsEventsEnvelopeInput> = [
  {
    subject: APPLE_ISSUER,
    currency: "USD",
    as_of: APPLE_AS_OF,
    events: [
      {
        release_date: "2024-10-31",
        period_end: "2024-09-28",
        fiscal_year: 2024,
        fiscal_period: "Q4",
        eps_actual: 1.64,
        eps_estimate_at_release: 1.6,
        source_id: DEV_EARNINGS_SOURCE_ID,
        as_of: "2024-10-31T20:30:00.000Z",
      },
      {
        release_date: "2024-08-01",
        period_end: "2024-06-29",
        fiscal_year: 2024,
        fiscal_period: "Q3",
        eps_actual: 1.4,
        eps_estimate_at_release: 1.35,
        source_id: DEV_EARNINGS_SOURCE_ID,
        as_of: "2024-08-01T20:30:00.000Z",
      },
      {
        release_date: "2024-05-02",
        period_end: "2024-03-30",
        fiscal_year: 2024,
        fiscal_period: "Q2",
        eps_actual: 1.53,
        eps_estimate_at_release: 1.5,
        source_id: DEV_EARNINGS_SOURCE_ID,
        as_of: "2024-05-02T20:30:00.000Z",
      },
      {
        release_date: "2024-02-01",
        period_end: "2023-12-30",
        fiscal_year: 2024,
        fiscal_period: "Q1",
        eps_actual: 2.18,
        eps_estimate_at_release: 2.1,
        source_id: DEV_EARNINGS_SOURCE_ID,
        as_of: "2024-02-01T21:30:00.000Z",
      },
      {
        release_date: "2023-11-02",
        period_end: "2023-09-30",
        fiscal_year: 2023,
        fiscal_period: "Q4",
        eps_actual: 1.46,
        eps_estimate_at_release: 1.39,
        source_id: DEV_EARNINGS_SOURCE_ID,
        as_of: "2023-11-02T20:30:00.000Z",
      },
      {
        release_date: "2023-08-03",
        period_end: "2023-07-01",
        fiscal_year: 2023,
        fiscal_period: "Q3",
        eps_actual: 1.26,
        eps_estimate_at_release: 1.19,
        source_id: DEV_EARNINGS_SOURCE_ID,
        as_of: "2023-08-03T20:30:00.000Z",
      },
      {
        release_date: "2023-05-04",
        period_end: "2023-04-01",
        fiscal_year: 2023,
        fiscal_period: "Q2",
        eps_actual: 1.52,
        eps_estimate_at_release: 1.43,
        source_id: DEV_EARNINGS_SOURCE_ID,
        as_of: "2023-05-04T20:30:00.000Z",
      },
      {
        release_date: "2023-02-02",
        period_end: "2022-12-31",
        fiscal_year: 2023,
        fiscal_period: "Q1",
        eps_actual: 1.88,
        eps_estimate_at_release: 1.94,
        source_id: DEV_EARNINGS_SOURCE_ID,
        as_of: "2023-02-02T21:30:00.000Z",
      },
    ],
  },
];
