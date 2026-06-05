import test from "node:test";
import assert from "node:assert/strict";

import { buildFactBackedSealInput, withRequiredDisclosures, type FactRow } from "../src/block-seal-input.ts";

const SNAP = "11111111-1111-4111-a111-111111111111";
const SRC = "00000000-0000-4000-a000-0000000000aa";
const ISSUER = { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" };
const FACT = "fac00000-0000-4000-8000-000000000001";

function baseSeal(freshness?: string) {
  const row: FactRow & { freshness_class?: string } = {
    fact_id: FACT, source_id: SRC, unit: "currency", period_kind: "point",
    period_start: null, period_end: "2026-06-04", fiscal_year: null, fiscal_period: null,
    ...(freshness === undefined ? {} : { freshness_class: freshness }),
  };
  const block = {
    id: "b-1", kind: "price_target_range", snapshot_id: SNAP,
    data_ref: { kind: "price_target_range", id: "b-1" }, source_refs: [SRC], as_of: "2026-06-04T00:00:00.000Z",
    current_price_ref: FACT,
  };
  return buildFactBackedSealInput({ block, factRefs: [FACT], subjectRefs: [ISSUER], facts: [row] });
}

test("withRequiredDisclosures appends a pricing disclosure for an eod fact", () => {
  const sealed = withRequiredDisclosures(baseSeal("eod"));
  assert.equal(sealed.blocks.length, 2);
  const disclosure = sealed.blocks[1] as { kind: string; disclosure_tier: string; items: string[]; source_refs: string[] };
  assert.equal(disclosure.kind, "disclosure");
  assert.equal(disclosure.disclosure_tier, "eod");
  assert.ok(disclosure.items.some((i) => /end-of-day/i.test(i)));
  assert.ok(disclosure.source_refs.includes(SRC));
});

test("withRequiredDisclosures is a no-op when no fact surfaces freshness", () => {
  const seal = baseSeal();
  const sealed = withRequiredDisclosures(seal);
  assert.equal(sealed.blocks.length, 1);
  assert.equal(sealed, seal); // unchanged reference
});
