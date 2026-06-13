import assert from "node:assert/strict";
import test from "node:test";

import {
  ANALYZE_PLAYBOOKS,
  resolveAnalyzePlaybookRequest,
} from "../src/playbook.ts";

test("built-in playbooks expose analyst-facing source policies and sections", () => {
  const earningsQuality = ANALYZE_PLAYBOOKS.find((playbook) => playbook.playbook_id === "earnings_quality");
  assert.ok(earningsQuality);
  assert.equal(earningsQuality.version, 1);
  assert.deepEqual(earningsQuality.default_source_categories, ["filings", "transcripts", "news"]);
  assert.deepEqual(earningsQuality.sections.map((section) => section.section_id), [
    "summary",
    "quality_of_revenue",
    "revenue_trend",
    "analyst_overview",
    "price_targets",
    "margin_bridge",
    "cash_conversion",
    "management_tone",
    "watch_items",
  ]);
});

test("resolveAnalyzePlaybookRequest overlays user instructions without dropping defaults", () => {
  const request = resolveAnalyzePlaybookRequest({
    playbook_id: "variant_view",
    instructions: "Focus on hyperscaler capex risk.",
    source_categories: ["filings"],
  });
  assert.equal(request.playbook.playbook_id, "variant_view");
  assert.equal(request.playbook.version, 1);
  assert.equal(request.instructions, "Focus on hyperscaler capex risk.");
  assert.deepEqual(request.source_categories, ["filings"]);
  assert.ok(request.prompt.includes("Variant view"));
  assert.ok(request.prompt.includes("Focus on hyperscaler capex risk."));
});

test("investment_memo playbook resolves with the verdict section last", () => {
  const resolved = resolveAnalyzePlaybookRequest({ playbook_id: "investment_memo" });
  assert.equal(resolved.playbook.name, "Investment memo");
  assert.deepEqual(resolved.playbook.default_source_categories, ["filings", "transcripts", "news"]);
  const sectionIds = resolved.playbook.sections.map((section) => section.section_id);
  assert.equal(sectionIds[0], "investment_thesis");
  assert.deepEqual(sectionIds.slice(-1), ["final_verdict"]);
  assert.ok(resolved.prompt.includes("Final verdict"));
});
