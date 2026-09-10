import assert from "node:assert/strict";
import test from "node:test";

import { createFinancialProvider } from "../src/providers/financials.ts";
import { fakeOperations } from "./fake-operations.ts";

const HASH = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const identity = {
  issuer_id: "11111111-1111-4111-a111-111111111111", listing_id: "22222222-2222-4222-a222-222222222222",
  legal_name: "Example Corp", ticker: "EXMP", mic: "XNYS", currency: "USD", asset_type: "common_stock" as const, identity_source_ids: [],
};

test("financial provider returns eligible sourced facts and explicit missing metrics without a quote", async () => {
  const provider = createFinancialProvider({
    reader: {
      readCached: async () => ({
        facts: [{
          fact_id: "33333333-3333-4333-a333-333333333333", metric_key: "revenue", value_num: 240,
          scale: 1_000_000, unit: "currency", currency: "USD", period_kind: "fiscal_y", period_end: "2025-12-31",
          as_of: "2026-02-15T00:00:00.000Z", source_id: "44444444-4444-4444-a444-444444444444",
          fiscal_year: 2025, fiscal_period: "FY", period_start: "2025-01-01",
        }],
        missing_fields: ["eps_diluted"], coverage_gaps: ["financial_hydration_cache_only"],
      }),
    },
  });
  const fake = fakeOperations();

  const result = await provider.read({
    identity, as_of: "2026-09-10T00:00:00.000Z", candidate_id: "55555555-5555-4555-a555-555555555555",
    operation_key: "run-1/research/candidate-1/financials", request_hash: HASH, phase: "research",
  }, fake.operations);

  assert.deepEqual(result.missing_fields, ["eps_diluted"]);
  assert.equal(result.facts[0]?.scale, 1_000_000);
  assert.equal(result.facts[0]?.currency, "USD");
  assert.equal(fake.ledger.size, 0, "cache reads do not reserve a financial provider attempt");
});
