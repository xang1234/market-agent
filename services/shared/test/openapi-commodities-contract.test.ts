import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const openApi = readFileSync(join(import.meta.dirname, "../../../spec/finance_research_openapi.yaml"), "utf-8");

test("OpenAPI exposes commodities APIs with concrete response schemas", () => {
  for (const [path, schemaName] of [
    ["/v1/markets/latest", "CommodityLatestResponse"],
    ["/v1/markets/series", "CommoditySeriesResponse"],
    ["/v1/markets/curve", "CommodityCurveResponse"],
    ["/v1/markets/spreads", "CommoditySpreadsResponse"],
    ["/v1/markets/inventory", "CommodityInventoryResponse"],
    ["/v1/balances/snapshot", "BalanceSnapshotResponse"],
    ["/v1/balances/changes", "BalanceChangesResponse"],
    ["/v1/impact/events", "ImpactEventsResponse"],
    ["/v1/impact/drivers", "ImpactDriversResponse"],
    ["/v1/impact/graph", "ImpactGraphResponse"],
    ["/v1/briefs/daily", "DailyBriefResponse"],
    ["/v1/briefs/{briefId}", "DailyBriefResponse"],
    ["/v1/briefs/{briefId}/publish", "DailyBriefResponse"],
    ["/v1/briefs/{briefId}/outcomes", "BriefOutcomesResponse"],
  ] as const) {
    assert.match(openApi, new RegExp(`^  ${escapeRegExp(path)}:`, "m"), `${path} missing`);
    assert.match(
      routeBlock(path),
      new RegExp(`\\$ref: '#/components/schemas/${schemaName}'`),
      `${path} must use ${schemaName}`,
    );
  }

  assert.match(openApi, /^  \/v1\/market\/quote:/m);
  assert.match(routeBlock("/v1/market/quote"), /deprecated: true/);
  assert.match(routeBlock("/v1/market/quote"), /\$ref: '#\/components\/schemas\/LegacyQuoteResponse'/);
  assert.match(openApi, /enum: \[commodity, benchmark, contract, curve, region, delivery_point, asset, producer, route, market_theme, portfolio, screen, issuer, instrument, listing, theme, macro_topic\]/);
});

function routeBlock(path: string): string {
  const pathPattern = escapeRegExp(path);
  const match = openApi.match(new RegExp(`^  ${pathPattern}:\\n([\\s\\S]*?)(?=^  /v1/|^components:)`, "m"));
  assert.ok(match, `${path} block missing`);
  return match[0];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
