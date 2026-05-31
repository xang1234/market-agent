import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const openApi = readFileSync(join(import.meta.dirname, "../../../spec/finance_research_openapi.yaml"), "utf-8");

test("OpenAPI exposes the commodities public API surface instead of the legacy quote-only market path", () => {
  for (const path of [
    "/v1/markets/latest",
    "/v1/markets/series",
    "/v1/markets/curve",
    "/v1/markets/spreads",
    "/v1/markets/inventory",
    "/v1/balances/snapshot",
    "/v1/balances/changes",
    "/v1/impact/events",
    "/v1/impact/drivers",
    "/v1/impact/graph",
    "/v1/briefs/daily",
    "/v1/briefs/{briefId}",
    "/v1/briefs/{briefId}/publish",
    "/v1/briefs/{briefId}/outcomes",
  ]) {
    assert.match(openApi, new RegExp(`^  ${escapeRegExp(path)}:`, "m"), `${path} missing`);
  }

  assert.doesNotMatch(openApi, /^  \/v1\/market\/quote:/m);
  assert.match(openApi, /enum: \[commodity, benchmark, contract, curve, region, delivery_point, asset, producer, route, market_theme, portfolio, screen, issuer, instrument, listing, theme, macro_topic\]/);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
