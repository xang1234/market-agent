import test from "node:test";
import assert from "node:assert/strict";

import { buildAnalystConsensusBlock } from "../src/analyst-consensus-block-builder.ts";
import type { MaterializedConsensus } from "../src/analyst-consensus-materializer.ts";

const SNAP = "11111111-1111-4111-a111-111111111111";
const SRC = "00000000-0000-4000-a000-00000000000d";

const materialized: MaterializedConsensus = {
  analyst_count_ref: "fac00000-0000-4000-8000-000000000001",
  analyst_count: 41,
  buckets: [
    { rating: "strong_buy", bucket: "Strong Buy", count: 14, count_ref: "fac00000-0000-4000-8000-000000000002" },
    { rating: "buy", bucket: "Buy", count: 17, count_ref: "fac00000-0000-4000-8000-000000000003" },
    { rating: "hold", bucket: "Hold", count: 8, count_ref: "fac00000-0000-4000-8000-000000000004" },
    { rating: "sell", bucket: "Sell", count: 1, count_ref: "fac00000-0000-4000-8000-000000000005" },
    { rating: "strong_sell", bucket: "Strong Sell", count: 1, count_ref: "fac00000-0000-4000-8000-000000000006" },
  ],
  factRows: [],
};

test("buildAnalystConsensusBlock carries refs + count per bucket", () => {
  const block = buildAnalystConsensusBlock({
    materialized,
    base: { id: "analyst_overview-1", snapshot_id: SNAP, as_of: "2026-06-04T00:00:00.000Z", source_refs: [SRC] },
    coverage_warning: "Limited coverage.",
  });
  assert.equal(block.kind, "analyst_consensus");
  assert.equal(block.data_ref.kind, "analyst_consensus");
  assert.equal(block.analyst_count_ref, materialized.analyst_count_ref);
  assert.deepEqual(block.distribution.map((b) => b.bucket), ["Strong Buy", "Buy", "Hold", "Sell", "Strong Sell"]);
  assert.deepEqual(block.distribution.map((b) => b.count), [14, 17, 8, 1, 1]);
  assert.equal(block.distribution[0].count_ref, materialized.buckets[0].count_ref);
  assert.equal(block.coverage_warning, "Limited coverage.");
});

test("buildAnalystConsensusBlock omits coverage_warning when absent", () => {
  const block = buildAnalystConsensusBlock({
    materialized,
    base: { id: "analyst_overview-1", snapshot_id: SNAP, as_of: "2026-06-04T00:00:00.000Z", source_refs: [SRC] },
  });
  assert.equal("coverage_warning" in block, false);
});
