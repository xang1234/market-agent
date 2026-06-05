import test from "node:test";
import assert from "node:assert/strict";

import { buildPriceTargetRangeBlock } from "../src/price-target-range-block-builder.ts";

const SNAP = "11111111-1111-4111-a111-111111111111";
const SRC = "00000000-0000-4000-a000-0000000000aa";
const BASE = { id: "price_targets-1", snapshot_id: SNAP, as_of: "2026-06-04T00:00:00.000Z", source_refs: [SRC] };

test("buildPriceTargetRangeBlock sets refs + range-bar positions + formatted prices", () => {
  const block = buildPriceTargetRangeBlock({
    currentPriceRef: "fac00000-0000-4000-8000-000000000004",
    current: 214.5,
    low: { ref: "fac00000-0000-4000-8000-000000000001", value: 170 },
    mean: { ref: "fac00000-0000-4000-8000-000000000002", value: 220 },
    high: { ref: "fac00000-0000-4000-8000-000000000003", value: 280 },
    currency: "USD",
    base: BASE,
  });
  assert.equal(block.kind, "price_target_range");
  assert.equal(block.data_ref.kind, "price_target_range");
  assert.equal(block.avg_ref, "fac00000-0000-4000-8000-000000000002");
  assert.equal(block.display.low.position, 0);
  assert.equal(block.display.high.position, 1);
  // avg = (220-170)/(280-170) = 0.4545…; current = (214.5-170)/110 = 0.4045…
  assert.ok(Math.abs(block.display.avg.position - 0.4545) < 0.01);
  assert.ok(Math.abs(block.display.current.position - 0.4045) < 0.01);
  assert.equal(block.display.low.format, "$170.00");
  assert.equal(block.display.current.format, "$214.50");
});

test("buildPriceTargetRangeBlock guards a zero span (all positions 0)", () => {
  const block = buildPriceTargetRangeBlock({
    currentPriceRef: "fac00000-0000-4000-8000-000000000004", current: 100,
    low: { ref: "a0000000-0000-4000-8000-000000000001", value: 100 },
    mean: { ref: "a0000000-0000-4000-8000-000000000002", value: 100 },
    high: { ref: "a0000000-0000-4000-8000-000000000003", value: 100 },
    currency: "USD", base: BASE,
  });
  assert.equal(block.display.avg.position, 0);
});
