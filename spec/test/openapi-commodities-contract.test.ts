import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { normalizeBalanceSnapshot } from "../../services/balances/src/balance-snapshot.ts";
import { buildDailyCallDraft, publishDailyCall } from "../../services/briefs/src/daily-call.ts";
import { normalizeImpactDriver } from "../../services/impact/src/event-impact.ts";
import {
  COPPER_COMMODITY_ID,
  COPPER_CONTRACT_ID,
  COPPER_CURVE_ID,
  createDevCommodityMarketDataAdapter,
} from "../../services/market/src/dev-commodity-market-adapter.ts";

const require = createRequire(import.meta.url);
const { load: loadYaml } = require("js-yaml") as { load(text: string): unknown };

const openApi = loadOpenApi();
const schemas = objectRecord(objectRecord(openApi.components, "components").schemas, "components.schemas");
const paths = objectRecord(openApi.paths, "paths");

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
    assertRouteResponseSchema(path, schemaName);
  }

  assertRouteResponseSchema("/v1/market/quote", "LegacyQuoteResponse");
  assert.equal(objectRecord(objectRecord(paths["/v1/market/quote"], "/v1/market/quote").get, "get").deprecated, true);
  assert.deepEqual(
    objectRecord(schemas.SubjectKind, "SubjectKind").enum,
    ["commodity", "benchmark", "contract", "curve", "region", "delivery_point", "asset", "producer", "route", "market_theme", "portfolio", "screen", "issuer", "instrument", "listing", "theme", "macro_topic"],
  );
});

test("OpenAPI commodity schemas validate representative domain response shapes", async () => {
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
    assertValidAgainstSchema(schemaName, sample);
  }
});

function loadOpenApi(): Record<string, unknown> {
  const text = readFileSync(join(import.meta.dirname, "../finance_research_openapi.yaml"), "utf-8");
  return objectRecord(loadYaml(text), "OpenAPI document");
}

function assertRouteResponseSchema(path: string, schemaName: string): void {
  const route = objectRecord(paths[path], path);
  const method = objectRecord(route.get ?? route.post, `${path} operation`);
  const response = objectRecord(objectRecord(method.responses, `${path}.responses`)["200"], `${path}.responses.200`);
  const content = objectRecord(response.content, `${path}.responses.200.content`);
  const json = objectRecord(content["application/json"], `${path}.responses.200.content.application/json`);
  assert.deepEqual(json.schema, { "$ref": `#/components/schemas/${schemaName}` });
}

function assertValidAgainstSchema(schemaName: string, value: unknown): void {
  validate(schemaName, schema(schemaName), value, schemaName);
}

function validate(schemaName: string, schemaValue: unknown, value: unknown, path: string): void {
  const resolved = resolveSchema(schemaValue);
  const type = resolved.type;
  if (type === "object") {
    const object = objectRecord(value, path);
    const required = arrayOfStrings(resolved.required ?? [], `${schemaName}.required`);
    const properties = objectRecord(resolved.properties ?? {}, `${schemaName}.properties`);
    for (const key of required) {
      assert.ok(Object.hasOwn(object, key), `${path}.${key} is required by ${schemaName}`);
    }
    if (resolved.additionalProperties === false) {
      for (const key of Object.keys(object)) {
        assert.ok(Object.hasOwn(properties, key), `${path}.${key} is not declared by ${schemaName}`);
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (Object.hasOwn(object, key)) validate(schemaName, propertySchema, object[key], `${path}.${key}`);
    }
    return;
  }
  if (type === "array") {
    assert.ok(Array.isArray(value), `${path} must be an array`);
    for (const [index, item] of value.entries()) validate(schemaName, resolved.items, item, `${path}[${index}]`);
    return;
  }
  if (type === "string") {
    assert.equal(typeof value, "string", `${path} must be a string`);
    if (resolved.format === "uuid") assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    if (Array.isArray(resolved.enum)) assert.ok(resolved.enum.includes(value), `${path} must be in enum`);
    return;
  }
  if (type === "number") {
    assert.equal(typeof value, "number", `${path} must be a number`);
    return;
  }
  if (type === "boolean") {
    assert.equal(typeof value, "boolean", `${path} must be a boolean`);
  }
}

function resolveSchema(value: unknown): Record<string, unknown> {
  const record = objectRecord(value, "schema");
  const ref = record["$ref"];
  if (typeof ref !== "string") return record;
  const name = ref.match(/^#\/components\/schemas\/(.+)$/)?.[1];
  assert.ok(name, `unsupported schema ref ${ref}`);
  return schema(name);
}

function schema(name: string): Record<string, unknown> {
  return objectRecord(schemas[name], `components.schemas.${name}`);
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function arrayOfStrings(value: unknown, label: string): ReadonlyArray<string> {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  for (const item of value) assert.equal(typeof item, "string", `${label} must contain strings`);
  return value;
}
