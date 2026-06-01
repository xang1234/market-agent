import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { normalizeBalanceSnapshot } from "../../balances/src/balance-snapshot.ts";
import { buildDailyCallDraft, publishDailyCall } from "../../briefs/src/daily-call.ts";
import { normalizeImpactDriver } from "../../impact/src/event-impact.ts";
import {
  COPPER_COMMODITY_ID,
  COPPER_CONTRACT_ID,
  COPPER_CURVE_ID,
  createDevCommodityMarketDataAdapter,
} from "../../market/src/dev-commodity-market-adapter.ts";

const openApi = readFileSync(join(import.meta.dirname, "../../../spec/finance_research_openapi.yaml"), "utf-8");
const AS_OF = "2026-05-31T00:00:00.000Z";
const SOURCE_ID = "66666666-6666-4666-9666-666666666666";
const SNAPSHOT_ID = "77777777-7777-4777-9777-777777777777";
const EVENT_ID = "88888888-8888-4888-9888-888888888888";
const CLAIM_ID = "99999999-9999-4999-9999-999999999999";
const BRIEF_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const REVIEWER_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

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

test("OpenAPI commodity schemas cover representative domain response shapes", async () => {
  const adapter = createDevCommodityMarketDataAdapter({ clock: () => new Date(AS_OF) });
  const latest = await adapter.latest({ kind: "contract", id: COPPER_CONTRACT_ID });
  const series = await adapter.series({ kind: "contract", id: COPPER_CONTRACT_ID });
  const curve = await adapter.curve(COPPER_CURVE_ID);
  const spreads = await adapter.spreads(COPPER_CURVE_ID);
  const inventory = await adapter.inventory(COPPER_COMMODITY_ID);
  assert.ok(latest);
  assert.ok(series);
  assert.ok(curve);
  assert.ok(spreads);
  assert.ok(inventory);

  const balance = normalizeBalanceSnapshot({
    commodity_ref: { kind: "commodity", id: COPPER_COMMODITY_ID },
    as_of: AS_OF,
    unit: "t",
    source_refs: [SOURCE_ID],
    components: [{
      channel: "mine_supply",
      label: "Mine disruption",
      value: 120_000,
      delta: -15_000,
      horizon: "1w",
      confidence: 0.8,
    }],
  });
  const driver = normalizeImpactDriver({
    driver_id: "supply-tightness",
    subject_refs: [{ kind: "commodity", id: COPPER_COMMODITY_ID }],
    event_refs: [EVENT_ID],
    claim_refs: [CLAIM_ID],
    channel: "supply",
    direction: "positive",
    horizon: "1w",
    driver_type: "news_event",
    confidence: 0.8,
    magnitude: 0.7,
    summary: "Smelter disruption tightens near-term availability.",
  });
  const publishedBrief = publishDailyCall(
    buildDailyCallDraft({
      brief_id: BRIEF_ID,
      snapshot_id: SNAPSHOT_ID,
      as_of: AS_OF,
      commodity_refs: [{ kind: "commodity", id: COPPER_COMMODITY_ID }],
      narrative: "Copper call is constructive over 1d-1w.",
      driver_ids: [driver.driver_id],
      watch_items: ["LME cash-3m spread"],
    }),
    {
      reviewer_user_id: REVIEWER_ID,
      published_at: AS_OF,
    },
  );

  for (const [schemaName, sample] of [
    ["CommodityLatestResponse", latest],
    ["CommodityMarketQuote", latest.quote],
    ["CommoditySeriesResponse", series],
    ["CommodityCurveResponse", curve],
    ["CommoditySpreadsResponse", spreads],
    ["CommodityInventoryResponse", inventory],
    ["BalanceSnapshot", balance],
    ["ImpactDriver", driver],
    ["DailyCallBrief", publishedBrief],
  ] as const) {
    assertSchemaCoversObject(schemaName, sample);
  }

  assertSchemaPropertyFormat("DailyCallBrief", "brief_id", "uuid");
});

function routeBlock(path: string): string {
  const pathPattern = escapeRegExp(path);
  const match = openApi.match(new RegExp(`^  ${pathPattern}:\\n([\\s\\S]*?)(?=^  /v1/|^components:)`, "m"));
  assert.ok(match, `${path} block missing`);
  return match[0];
}

function assertSchemaCoversObject(schemaName: string, sample: Record<string, unknown>): void {
  const declaredProperties = schemaProperties(schemaName);
  const requiredProperties = schemaRequiredProperties(schemaName);

  for (const key of Object.keys(sample)) {
    assert.ok(declaredProperties.has(key), `${schemaName} must declare sample property ${key}`);
  }
  for (const key of requiredProperties) {
    assert.ok(Object.hasOwn(sample, key), `${schemaName} sample must include required property ${key}`);
  }
}

function schemaBlock(schemaName: string): string {
  const lines = openApi.split("\n");
  const start = lines.findIndex((line) => line === `    ${schemaName}:`);
  assert.notEqual(start, -1, `${schemaName} schema missing`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^    [A-Za-z0-9_]+:$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return `${lines.slice(start, end).join("\n")}\n`;
}

function schemaProperties(schemaName: string): Set<string> {
  const schema = schemaBlock(schemaName);
  const properties = new Set<string>();
  const propertiesBlock = schema.match(/^      properties:\n([\s\S]*)$/m)?.[1] ?? "";
  for (const match of propertiesBlock.matchAll(/^        ([A-Za-z_][A-Za-z0-9_]*):/gm)) {
    properties.add(match[1]);
  }
  return properties;
}

function schemaRequiredProperties(schemaName: string): Set<string> {
  const schema = schemaBlock(schemaName);
  const inline = schema.match(/^      required: \[([^\]]*)\]/m);
  if (inline) {
    return new Set(inline[1].split(",").map((part) => part.trim()).filter(Boolean));
  }

  const block = schema.match(/^      required:\n((?:        - .+\n)+)/m);
  if (!block) return new Set();
  return new Set([...block[1].matchAll(/^        - (.+)$/gm)].map((match) => match[1].trim()));
}

function assertSchemaPropertyFormat(schemaName: string, propertyName: string, format: string): void {
  const lines = schemaBlock(schemaName).split("\n");
  const start = lines.findIndex((line) => line === `        ${propertyName}:`);
  assert.notEqual(start, -1, `${schemaName}.${propertyName} property missing`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^        [A-Za-z_][A-Za-z0-9_]*:$/.test(lines[index]) || /^    [A-Za-z0-9_]+:$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  assert.match(lines.slice(start, end).join("\n"), new RegExp(`^          format: ${escapeRegExp(format)}$`, "m"));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
