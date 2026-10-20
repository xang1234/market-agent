import test from "node:test";
import assert from "node:assert/strict";

import { financialSectionIds } from "../src/financial-section.ts";
import { ANALYZE_PLAYBOOKS } from "../src/playbook.ts";
import { lookupSectionProducer, sectionBlockId } from "../src/section-producers.ts";

test("no numerical section has a legacy producer: the engine is its only source", () => {
  const numerical = ANALYZE_PLAYBOOKS.flatMap((playbook) => financialSectionIds(playbook).map((id) => `${playbook.playbook_id}:${id}`));
  assert.ok(numerical.length > 0);
  for (const key of numerical) {
    const [playbookId, sectionId] = key.split(":") as [string, string];
    assert.equal(lookupSectionProducer(playbookId, sectionId), undefined, key);
  }
});

test("lookupSectionProducer returns undefined for narrative and unknown sections", () => {
  assert.equal(lookupSectionProducer("peer_comparison", "summary"), undefined);
  assert.equal(lookupSectionProducer("earnings_quality", "margin_bridge"), undefined);
  assert.equal(lookupSectionProducer("nope", "peer_table"), undefined);
});

test("the earnings_quality analyst_overview section resolves to a producer", () => {
  assert.notEqual(lookupSectionProducer("earnings_quality", "analyst_overview"), undefined);
});

test("the earnings_quality price_targets section resolves to a producer", () => {
  assert.notEqual(lookupSectionProducer("earnings_quality", "price_targets"), undefined);
});

test("sectionBlockId is stable and section-scoped", () => {
  assert.equal(sectionBlockId("peer_table"), "peer_table-1");
});
