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

test("investment_memo asks for a competitive position and no stance", () => {
  const resolved = resolveAnalyzePlaybookRequest({ playbook_id: "investment_memo" });
  assert.equal(resolved.playbook.name, "Investment memo");
  assert.equal(resolved.playbook.version, 1, "a stored memo's optional sections are looked up by its version");
  assert.deepEqual(resolved.playbook.default_source_categories, ["filings", "transcripts", "news"]);
  assert.deepEqual(resolved.playbook.sections.map((section) => section.section_id), [
    "investment_thesis",
    "financial_health",
    "cash_resilience",
    "revenue_trend",
    "growth_drivers",
    "competitive_position",
    "downside_risks",
    "ownership_signals",
    "analyst_overview",
    "price_targets",
  ]);
  for (const text of [resolved.prompt, resolved.instructions, resolved.playbook.description]) {
    assert.doesNotMatch(text, /\b(buy|hold|sell|rating|conviction|verdict)\b/iu);
  }
});

test("the prompt lists required and optional sections apart", () => {
  const memo = resolveAnalyzePlaybookRequest({ playbook_id: "investment_memo" }).prompt.split("\n");
  assert.deepEqual(memo.filter((line) => /^(Required|Optional) sections:/u.test(line)), [
    "Required sections: Investment thesis; Financial health & profitability; Growth drivers; Competitive position; Downside risks; Ownership & insider signals",
    "Optional sections: Cash resilience; Revenue trend; Analyst overview; Price targets",
  ]);
  const variant = resolveAnalyzePlaybookRequest({ playbook_id: "variant_view" }).prompt.split("\n");
  assert.deepEqual(variant.filter((line) => /^(Required|Optional) sections:/u.test(line)), [
    "Required sections: Variant summary; Consensus view; Counter-evidence; Disconfirming signals; Decision points",
  ], "a playbook with no optional sections has no optional line");
});
