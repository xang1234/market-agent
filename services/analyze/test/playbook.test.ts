import assert from "node:assert/strict";
import test from "node:test";

import {
  ANALYZE_PLAYBOOKS,
  AnalyzePlaybookCatalogError,
  parseAnalyzePlaybookCatalog,
  resolveAnalyzePlaybookRequest,
} from "../src/playbook.ts";

test("built-in playbooks expose metals-and-bulks market call policies and sections", () => {
  assert.deepEqual(
    ANALYZE_PLAYBOOKS.map((playbook) => playbook.playbook_id),
    [
      "daily_copper_call",
      "daily_iron_ore_call",
      "report_change_digest",
      "supply_shock_readout",
      "china_demand_watch",
      "curve_spread_explanation",
      "forecast_vs_market_review",
    ],
  );

  const dailyCopper = ANALYZE_PLAYBOOKS.find((playbook) => playbook.playbook_id === "daily_copper_call");
  assert.ok(dailyCopper);
  assert.equal(dailyCopper.version, 1);
  assert.deepEqual(dailyCopper.default_source_categories, [
    "prices",
    "curves",
    "inventories",
    "licensed_reports",
    "news",
    "internal_forecasts",
  ]);
  assert.deepEqual(dailyCopper.sections.map((section) => section.section_id), [
    "narrative_summary",
    "driver_board",
    "price_curve_moves",
    "inventory_balance",
    "event_impact_matrix",
    "watch_items",
  ]);
});

test("resolveAnalyzePlaybookRequest overlays user instructions without dropping defaults", () => {
  const request = resolveAnalyzePlaybookRequest({
    playbook_id: "curve_spread_explanation",
    instructions: "Focus on LME cash-3m tightness and SHFE arbitrage.",
    source_categories: ["prices", "curves"],
  });
  assert.equal(request.playbook.playbook_id, "curve_spread_explanation");
  assert.equal(request.playbook.version, 1);
  assert.equal(request.instructions, "Focus on LME cash-3m tightness and SHFE arbitrage.");
  assert.deepEqual(request.source_categories, ["prices", "curves"]);
  assert.ok(request.prompt.includes("Curve/spread move explanation"));
  assert.ok(request.prompt.includes("LME cash-3m tightness"));
});

test("parseAnalyzePlaybookCatalog rejects unknown source categories and block hints", () => {
  const valid = ANALYZE_PLAYBOOKS[0];
  assert.ok(valid);

  assert.throws(
    () => parseAnalyzePlaybookCatalog([{ ...valid, default_source_categories: ["prices", "filings"] }]),
    AnalyzePlaybookCatalogError,
  );

  assert.throws(
    () =>
      parseAnalyzePlaybookCatalog([
        {
          ...valid,
          sections: [{ ...valid.sections[0], block_hint: "balance_sheet" }],
        },
      ]),
    AnalyzePlaybookCatalogError,
  );
});
