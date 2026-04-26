// Dev-only issuer profile records. Stable issuer UUIDs let the web frontend
// hard-link to a known issuer without seeding the DB. Production wiring
// replaces this in-memory map with a DB-backed IssuerProfileRepository
// reading the issuers/instruments/listings tables.
//
// Listing UUIDs here align with services/market/src/dev-fixtures.ts so the
// overview tab can chain a profile lookup → quote lookup with consistent
// listing identity in dev mode.

import type { IssuerProfileRecord } from "./issuer-repository.ts";
import type { UUID } from "./subject-ref.ts";

export const DEV_FUNDAMENTALS_SOURCE_ID: UUID = "00000000-0000-4000-a000-000000000002";

const issuerRef = (id: UUID) => ({ kind: "issuer" as const, id });
const listingRef = (id: UUID) => ({ kind: "listing" as const, id });

export const DEV_ISSUER_PROFILES: ReadonlyArray<IssuerProfileRecord> = [
  {
    subject: issuerRef("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1"),
    legal_name: "Apple Inc.",
    former_names: [],
    cik: "0000320193",
    lei: "HWUPKR0MPOU8FGXBT394",
    domicile: "US",
    sector: "Technology",
    industry: "Consumer Electronics",
    exchanges: [
      {
        listing: listingRef("11111111-1111-4111-a111-111111111111"),
        mic: "XNAS",
        ticker: "AAPL",
        trading_currency: "USD",
        timezone: "America/New_York",
      },
    ],
  },
  {
    subject: issuerRef("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa2"),
    legal_name: "Microsoft Corporation",
    former_names: [],
    cik: "0000789019",
    lei: "INR2EJN1ERAN0W5ZP974",
    domicile: "US",
    sector: "Technology",
    industry: "Software—Infrastructure",
    exchanges: [
      {
        listing: listingRef("22222222-2222-4222-a222-222222222222"),
        mic: "XNAS",
        ticker: "MSFT",
        trading_currency: "USD",
        timezone: "America/New_York",
      },
    ],
  },
  {
    subject: issuerRef("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa3"),
    legal_name: "Alphabet Inc.",
    former_names: ["Google Inc."],
    cik: "0001652044",
    lei: "5493006MHB84DD0ZWV18",
    domicile: "US",
    sector: "Communication Services",
    industry: "Internet Content & Information",
    exchanges: [
      {
        listing: listingRef("33333333-3333-4333-a333-333333333333"),
        mic: "XNAS",
        ticker: "GOOGL",
        trading_currency: "USD",
        timezone: "America/New_York",
      },
    ],
  },
  {
    subject: issuerRef("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa4"),
    legal_name: "Tesla, Inc.",
    former_names: ["Tesla Motors, Inc."],
    cik: "0001318605",
    lei: "54930043XZGB27CTOV49",
    domicile: "US",
    sector: "Consumer Cyclical",
    industry: "Auto Manufacturers",
    exchanges: [
      {
        listing: listingRef("44444444-4444-4444-a444-444444444444"),
        mic: "XNAS",
        ticker: "TSLA",
        trading_currency: "USD",
        timezone: "America/New_York",
      },
    ],
  },
  {
    subject: issuerRef("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa5"),
    legal_name: "NVIDIA Corporation",
    former_names: [],
    cik: "0001045810",
    lei: "549300VBPFXIK14ZNZ34",
    domicile: "US",
    sector: "Technology",
    industry: "Semiconductors",
    exchanges: [
      {
        listing: listingRef("55555555-5555-4555-a555-555555555555"),
        mic: "XNAS",
        ticker: "NVDA",
        trading_currency: "USD",
        timezone: "America/New_York",
      },
    ],
  },
];
