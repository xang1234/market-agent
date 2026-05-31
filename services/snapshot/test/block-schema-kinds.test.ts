import assert from "node:assert/strict";
import test from "node:test";

import blockSchema from "../../../spec/finance_research_block_schema.json" with { type: "json" };
import { blockKindsFromSchema } from "../src/block-schema-kinds.ts";

test("snapshot verifier derives registered block kinds from the canonical block schema", () => {
  assert.deepEqual(blockKindsFromSchema(blockSchema), [
    "rich_text",
    "section",
    "metric_row",
    "table",
    "line_chart",
    "revenue_bars",
    "perf_comparison",
    "segment_donut",
    "segment_trajectory",
    "metrics_comparison",
    "analyst_consensus",
    "price_target_range",
    "eps_surprise",
    "filings_list",
    "news_cluster",
    "finding_card",
    "sentiment_trend",
    "mention_volume",
    "daily_call_summary",
    "driver_board",
    "curve_chart",
    "spread_table",
    "inventory_bridge",
    "impact_matrix",
    "report_delta",
    "watch_item_table",
    "forecast_vs_market",
    "source_pack",
    "sources",
    "disclosure",
  ]);
});
