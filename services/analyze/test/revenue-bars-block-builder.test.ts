import test from "node:test";
import assert from "node:assert/strict";

import { buildRevenueBarsBlock, type QuarterlyRevenueFact } from "../src/revenue-bars-block-builder.ts";

const SNAP = "11111111-1111-4111-a111-111111111111";
const SRC = "00000000-0000-4000-a000-0000000000ed";
const BASE = { id: "revenue_trend-1", snapshot_id: SNAP, as_of: "2026-03-31T00:00:00.000Z", source_refs: [SRC] };

function fact(id: string, fy: number, fp: string, value: number, scale = 1): QuarterlyRevenueFact {
  return { fact_id: id, fiscal_year: fy, fiscal_period: fp, value_num: value, scale, currency: "USD" };
}

test("buildRevenueBarsBlock orders oldest->newest, normalizes magnitude to the peak, and formats currency", () => {
  // Supplied newest-first + out of order; the builder sorts ascending.
  const block = buildRevenueBarsBlock({
    base: BASE,
    facts: [
      fact("f0000000-0000-4000-8000-000000000004", 2025, "Q2", 4_000_000_000),
      fact("f0000000-0000-4000-8000-000000000001", 2024, "Q3", 2_000_000_000),
      fact("f0000000-0000-4000-8000-000000000003", 2025, "Q1", 1_000_000_000),
      fact("f0000000-0000-4000-8000-000000000002", 2024, "Q4", 3_000_000_000),
    ],
  });

  assert.equal(block.kind, "revenue_bars");
  assert.equal(block.data_ref.kind, "revenue_bars");
  assert.deepEqual(block.bars.map((bar) => bar.label), ["Q3 2024", "Q4 2024", "Q1 2025", "Q2 2025"]);
  // Peak (4B) -> magnitude 1; others are ratios of the peak.
  assert.deepEqual(block.bars.map((bar) => bar.magnitude), [0.5, 0.75, 0.25, 1]);
  assert.equal(block.bars[0].value_ref, "f0000000-0000-4000-8000-000000000001");
  assert.equal(block.bars[3].format, "$4.0B");
});

test("buildRevenueBarsBlock applies scale to value_num for magnitude and format", () => {
  const block = buildRevenueBarsBlock({
    base: BASE,
    facts: [
      fact("f0000000-0000-4000-8000-000000000001", 2025, "Q1", 1000, 1_000_000), // 1.0B native
      fact("f0000000-0000-4000-8000-000000000002", 2025, "Q2", 2000, 1_000_000), // 2.0B native
    ],
  });
  assert.deepEqual(block.bars.map((bar) => bar.magnitude), [0.5, 1]);
  assert.equal(block.bars[1].format, "$2.0B");
});

test("buildRevenueBarsBlock guards a zero peak (no NaN magnitudes)", () => {
  const block = buildRevenueBarsBlock({
    base: BASE,
    facts: [fact("f0000000-0000-4000-8000-000000000001", 2025, "Q1", 0)],
  });
  assert.equal(block.bars[0].magnitude, 0);
});
