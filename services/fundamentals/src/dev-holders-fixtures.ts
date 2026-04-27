import { DEV_ISSUER_PROFILES } from "./dev-fixtures.ts";
import type {
  InsiderHoldersEnvelopeInput,
  InstitutionalHoldersEnvelopeInput,
} from "./holders.ts";
import type { UUID } from "./subject-ref.ts";

export const DEV_HOLDERS_SOURCE_ID: UUID = "00000000-0000-4000-a000-000000000008";

const APPLE_ISSUER = DEV_ISSUER_PROFILES[0].subject;
const APPLE_AS_OF = "2024-11-01T20:30:00.000Z";

// Top institutional holders of AAPL based on the most recent 13F filing
// cycle ending 2024-09-30. Numbers approximate publicly disclosed positions
// and are calibrated against AAPL's ~15.1B shares outstanding and ~$226
// share price at filing date.
export const DEV_INSTITUTIONAL_HOLDERS_INPUTS: ReadonlyArray<InstitutionalHoldersEnvelopeInput> = [
  {
    subject: APPLE_ISSUER,
    currency: "USD",
    as_of: APPLE_AS_OF,
    source_id: DEV_HOLDERS_SOURCE_ID,
    holders: [
      {
        holder_name: "Vanguard Group Inc",
        shares_held: 1_350_000_000,
        market_value: 305_100_000_000,
        percent_of_shares_outstanding: 8.94,
        shares_change: 12_000_000,
        filing_date: "2024-09-30",
      },
      {
        holder_name: "BlackRock Inc",
        shares_held: 1_055_000_000,
        market_value: 238_430_000_000,
        percent_of_shares_outstanding: 6.99,
        shares_change: 8_500_000,
        filing_date: "2024-09-30",
      },
      {
        holder_name: "Berkshire Hathaway Inc",
        shares_held: 300_000_000,
        market_value: 67_800_000_000,
        percent_of_shares_outstanding: 1.99,
        shares_change: -100_000_000,
        filing_date: "2024-09-30",
      },
      {
        holder_name: "State Street Corp",
        shares_held: 580_000_000,
        market_value: 131_080_000_000,
        percent_of_shares_outstanding: 3.84,
        shares_change: 3_200_000,
        filing_date: "2024-09-30",
      },
      {
        holder_name: "FMR LLC (Fidelity)",
        shares_held: 365_000_000,
        market_value: 82_490_000_000,
        percent_of_shares_outstanding: 2.42,
        shares_change: -2_800_000,
        filing_date: "2024-09-30",
      },
      {
        holder_name: "Geode Capital Management LLC",
        shares_held: 305_000_000,
        market_value: 68_930_000_000,
        percent_of_shares_outstanding: 2.02,
        shares_change: 1_900_000,
        filing_date: "2024-09-30",
      },
      {
        holder_name: "T. Rowe Price Associates Inc",
        shares_held: 198_000_000,
        market_value: 44_748_000_000,
        percent_of_shares_outstanding: 1.31,
        shares_change: 750_000,
        filing_date: "2024-09-30",
      },
      {
        holder_name: "Northern Trust Corp",
        shares_held: 175_000_000,
        market_value: 39_550_000_000,
        percent_of_shares_outstanding: 1.16,
        shares_change: 420_000,
        filing_date: "2024-09-30",
      },
    ],
  },
];

// Recent insider transactions for AAPL — Form 4 filings on Section 16
// officers and directors.
export const DEV_INSIDER_HOLDERS_INPUTS: ReadonlyArray<InsiderHoldersEnvelopeInput> = [
  {
    subject: APPLE_ISSUER,
    currency: "USD",
    as_of: APPLE_AS_OF,
    source_id: DEV_HOLDERS_SOURCE_ID,
    holders: [
      {
        insider_name: "COOK TIMOTHY D",
        insider_role: "Chief Executive Officer",
        transaction_date: "2024-10-04",
        transaction_type: "sell",
        shares: 223_986,
        price: 226.04,
        value: 50_628_113,
      },
      {
        insider_name: "MAESTRI LUCA",
        insider_role: "Chief Financial Officer",
        transaction_date: "2024-09-12",
        transaction_type: "sell",
        shares: 90_355,
        price: 220.18,
        value: 19_896_363,
      },
      {
        insider_name: "ADAMS KATHERINE L",
        insider_role: "General Counsel",
        transaction_date: "2024-08-21",
        transaction_type: "sell",
        shares: 35_000,
        price: 226.05,
        value: 7_911_750,
      },
      {
        insider_name: "O'BRIEN DEIRDRE",
        insider_role: "SVP Retail",
        transaction_date: "2024-08-15",
        transaction_type: "sell",
        shares: 19_700,
        price: 226.12,
        value: 4_454_564,
      },
      {
        insider_name: "JUNG ANDREA",
        insider_role: "Director",
        transaction_date: "2024-07-22",
        transaction_type: "option_exercise",
        shares: 1_500,
        price: 0,
        value: 0,
      },
      {
        insider_name: "KONDO CHRISTOPHER",
        insider_role: "Principal Accounting Officer",
        transaction_date: "2024-05-17",
        transaction_type: "sell",
        shares: 6_212,
        price: 189.84,
        value: 1_179_087,
      },
    ],
  },
];
