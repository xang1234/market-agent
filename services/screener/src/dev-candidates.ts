// Dev-only screener candidates. Listing UUIDs are reused from
// `services/market/src/dev-fixtures.ts` so the screener returns
// row.subject_refs that the existing market service knows about — a
// click-through from screener to symbol-detail lands on the same
// canonical identity. Numbers are calibrated to recent (~2026-Q1)
// real-world values for plausibility, not precision: tests pin a
// fixed clock so timestamps and sort orderings stay deterministic.
//
// Production wiring would replace this with a poller that joins
// listings + market quote + fundamentals key-stats into per-listing
// candidate rows on a refresh cadence.

import type { ScreenerCandidate } from "./candidate.ts";

const AS_OF = "2026-04-22T15:30:00.000Z";

export const DEV_SCREENER_CANDIDATES: ReadonlyArray<ScreenerCandidate> = [
  {
    subject_ref: { kind: "listing", id: "11111111-1111-4111-a111-111111111111" },
    display: { primary: "Apple Inc.", ticker: "AAPL", mic: "XNAS", legal_name: "Apple Inc." },
    universe: {
      asset_type: "common_stock",
      mic: "XNAS",
      trading_currency: "USD",
      domicile: "US",
      sector: "Technology",
      industry: "Consumer Electronics",
    },
    quote: {
      last_price: 196.58,
      prev_close: 195.34,
      change_pct: 0.00635,
      volume: 52_400_000,
      delay_class: "real_time",
      currency: "USD",
      as_of: AS_OF,
    },
    fundamentals: {
      market_cap: 2_980_000_000_000,
      pe_ratio: 30.2,
      gross_margin: 0.456,
      operating_margin: 0.305,
      net_margin: 0.255,
      revenue_growth_yoy: 0.045,
    },
  },
  {
    subject_ref: { kind: "listing", id: "22222222-2222-4222-a222-222222222222" },
    display: { primary: "Microsoft Corporation", ticker: "MSFT", mic: "XNAS", legal_name: "Microsoft Corporation" },
    universe: {
      asset_type: "common_stock",
      mic: "XNAS",
      trading_currency: "USD",
      domicile: "US",
      sector: "Technology",
      industry: "Software—Infrastructure",
    },
    quote: {
      last_price: 415.92,
      prev_close: 412.50,
      change_pct: 0.00829,
      volume: 21_300_000,
      delay_class: "real_time",
      currency: "USD",
      as_of: AS_OF,
    },
    fundamentals: {
      market_cap: 3_080_000_000_000,
      pe_ratio: 35.8,
      gross_margin: 0.694,
      operating_margin: 0.444,
      net_margin: 0.366,
      revenue_growth_yoy: 0.118,
    },
  },
  {
    subject_ref: { kind: "listing", id: "33333333-3333-4333-a333-333333333333" },
    display: { primary: "Alphabet Inc. Class A", ticker: "GOOGL", mic: "XNAS", legal_name: "Alphabet Inc.", share_class: "A" },
    universe: {
      asset_type: "common_stock",
      mic: "XNAS",
      trading_currency: "USD",
      domicile: "US",
      sector: "Communication Services",
      industry: "Internet Content & Information",
    },
    quote: {
      last_price: 178.21,
      prev_close: 179.05,
      change_pct: -0.00469,
      volume: 28_900_000,
      delay_class: "real_time",
      currency: "USD",
      as_of: AS_OF,
    },
    fundamentals: {
      market_cap: 2_210_000_000_000,
      pe_ratio: 26.4,
      gross_margin: 0.582,
      operating_margin: 0.318,
      net_margin: 0.273,
      revenue_growth_yoy: 0.151,
    },
  },
  {
    subject_ref: { kind: "listing", id: "44444444-4444-4444-a444-444444444444" },
    display: { primary: "Tesla, Inc.", ticker: "TSLA", mic: "XNAS", legal_name: "Tesla, Inc." },
    universe: {
      asset_type: "common_stock",
      mic: "XNAS",
      trading_currency: "USD",
      domicile: "US",
      sector: "Consumer Cyclical",
      industry: "Auto Manufacturers",
    },
    quote: {
      last_price: 248.40,
      prev_close: 252.10,
      change_pct: -0.01468,
      volume: 71_200_000,
      delay_class: "real_time",
      currency: "USD",
      as_of: AS_OF,
    },
    fundamentals: {
      market_cap: 791_000_000_000,
      pe_ratio: 71.2,
      gross_margin: 0.181,
      operating_margin: 0.082,
      net_margin: 0.073,
      revenue_growth_yoy: 0.019,
    },
  },
  {
    subject_ref: { kind: "listing", id: "55555555-5555-4555-a555-555555555555" },
    display: { primary: "NVIDIA Corporation", ticker: "NVDA", mic: "XNAS", legal_name: "NVIDIA Corporation" },
    universe: {
      asset_type: "common_stock",
      mic: "XNAS",
      trading_currency: "USD",
      domicile: "US",
      sector: "Technology",
      industry: "Semiconductors",
    },
    quote: {
      last_price: 924.50,
      prev_close: 902.75,
      change_pct: 0.02410,
      volume: 38_500_000,
      delay_class: "real_time",
      currency: "USD",
      as_of: AS_OF,
    },
    fundamentals: {
      market_cap: 2_280_000_000_000,
      pe_ratio: 64.8,
      gross_margin: 0.745,
      operating_margin: 0.611,
      net_margin: 0.530,
      revenue_growth_yoy: 1.262,
    },
  },
];
