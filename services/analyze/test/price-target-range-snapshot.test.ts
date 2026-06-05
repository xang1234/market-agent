import test from "node:test";
import assert from "node:assert/strict";

import { buildPriceTargetRangeBlock } from "../src/price-target-range-block-builder.ts";
import { buildPriceTargetRangeSealInput } from "../src/price-target-range-snapshot.ts";
import type { FactRow } from "../src/block-seal-input.ts";

const SNAP = "11111111-1111-4111-a111-111111111111";
const SRC = "00000000-0000-4000-a000-0000000000aa";
const PRIMARY = { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" } as const;
const LISTING = { kind: "listing", id: "55555555-5555-4555-a555-555555555555" } as const;
const REFS = { low: "fac00000-0000-4000-8000-000000000001", mean: "fac00000-0000-4000-8000-000000000002", high: "fac00000-0000-4000-8000-000000000003", price: "fac00000-0000-4000-8000-000000000004" };

function block() {
  return buildPriceTargetRangeBlock({
    currentPriceRef: REFS.price, current: 214.5,
    low: { ref: REFS.low, value: 170 }, mean: { ref: REFS.mean, value: 220 }, high: { ref: REFS.high, value: 280 },
    currency: "USD", base: { id: "price_targets-1", snapshot_id: SNAP, as_of: "2026-06-04T00:00:00.000Z", source_refs: [SRC] },
  });
}
function lean(id: string): FactRow {
  return { fact_id: id, source_id: SRC, unit: "currency", period_kind: "point", period_start: null, period_end: "2026-06-04", fiscal_year: null, fiscal_period: null };
}
function priceRow(): FactRow & { freshness_class: string } {
  return { ...lean(REFS.price), freshness_class: "eod" };
}

test("buildPriceTargetRangeSealInput binds 4 facts + both subjects + appends the eod disclosure", () => {
  const seal = buildPriceTargetRangeSealInput({
    block: block(),
    facts: [lean(REFS.low), lean(REFS.mean), lean(REFS.high), priceRow()],
    primary: PRIMARY, listing: LISTING,
  });
  assert.deepEqual(new Set(seal.manifest.fact_refs), new Set([REFS.price, REFS.low, REFS.mean, REFS.high]));
  assert.deepEqual(new Set(seal.manifest.subject_refs.map((s) => s.id)), new Set([PRIMARY.id, LISTING.id]));
  assert.equal(seal.blocks.length, 2);
  assert.equal((seal.blocks[1] as { kind: string }).kind, "disclosure");
});
