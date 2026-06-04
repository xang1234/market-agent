import test from "node:test";
import assert from "node:assert/strict";

import { lookupSectionProducer, sectionBlockId } from "../src/section-producers.ts";

test("lookupSectionProducer resolves the peer_table producer for peer_comparison", () => {
  assert.equal(typeof lookupSectionProducer("peer_comparison", "peer_table"), "function");
});

test("lookupSectionProducer returns undefined for narrative sections and unknown playbooks", () => {
  assert.equal(lookupSectionProducer("peer_comparison", "summary"), undefined);
  assert.equal(lookupSectionProducer("earnings_quality", "margin_bridge"), undefined);
  assert.equal(lookupSectionProducer("nope", "peer_table"), undefined);
});

test("the earnings_quality revenue_trend section resolves to a producer", () => {
  assert.notEqual(lookupSectionProducer("earnings_quality", "revenue_trend"), undefined);
});

test("the earnings_quality analyst_overview section resolves to a producer", () => {
  assert.notEqual(lookupSectionProducer("earnings_quality", "analyst_overview"), undefined);
});

test("sectionBlockId is stable and section-scoped", () => {
  assert.equal(sectionBlockId("peer_table"), "peer_table-1");
});
