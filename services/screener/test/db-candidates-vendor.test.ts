import test from "node:test";
import assert from "node:assert/strict";
import {
  loadVendorScreenerCandidates,
  type VendorCandidateQueryExecutor,
} from "../src/db-candidates-vendor.ts";

// A vendor candidate row (identity + quote + the vendor metric columns). The
// metric columns are null here — the point is the SEC-sourced insider field.
const ROW = {
  listing_id: "22222222-2222-4222-8222-222222222222",
  legal_name: "Vendor Co",
  share_class: null,
  asset_type: "common_stock",
  mic: "XNAS",
  ticker: "VEND",
  trading_currency: "USD",
  domicile: "US",
  sector: "Technology",
  industry: "Software",
  price: 10,
  prev_close: 9,
  delay_class: "delayed",
  currency: "USD",
  as_of: "2026-05-08T00:00:00.000Z",
  market_cap: null,
  pe_ratio: null,
  gross_margin: null,
  operating_margin: null,
  net_margin: null,
  revenue_growth_yoy: null,
  forward_pe: null,
  roic: null,
  perf_quarter: null,
  perf_year: null,
  rsi_14: null,
  week_52_high_distance: null,
};

function fakeDb(row: Record<string, unknown>): VendorCandidateQueryExecutor {
  return { query: async () => ({ rows: [row] }) } as unknown as VendorCandidateQueryExecutor;
}

test("vendor screener candidates carry insider_net_shares_90d as null, not undefined", async () => {
  const candidates = await loadVendorScreenerCandidates(fakeDb(ROW), new Date("2026-05-08T00:00:00.000Z"));
  const f = candidates[0]?.fundamentals;
  assert.ok(f, "a vendor candidate is produced");
  // The vendor feed has no insider data (it's SEC-sourced via the Postgres
  // path), but the field must still be PRESENT as null. A missing key reads as
  // `undefined`, which slips past numericClauseMatches' `=== null` guard, so a
  // clause like `insider_net_shares_90d >= 1` would match every vendor candidate.
  assert.ok("insider_net_shares_90d" in f, "field is present on vendor candidates");
  assert.equal(f.insider_net_shares_90d, null);
});
