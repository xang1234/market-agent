import test from "node:test";
import assert from "node:assert/strict";
import { mapPayloadToVendorStats, MAPPED_METRIC_KEYS } from "../src/fact-mapper.ts";
import type { NormalizedPayload } from "../src/types.ts";

function statByKey(stats: ReturnType<typeof mapPayloadToVendorStats>, key: string) {
  return stats.find((s) => s.metricKey === key);
}

test("mapPayloadToVendorStats emits only the populated fields, skipping nulls", () => {
  // Mirrors the real Agilent row: market_cap + technicals present, margins/PE null.
  const payload: NormalizedPayload = {
    market_cap_usd: 32335355904,
    forward_pe: 20.48,
    roic: 13.9,
    sales_growth_yy: 6.96,
    rsi_14: 74.63,
    perf_year: 20.67,
    short_float: 1.95,
    pe_ratio: null,
    gross_margin: null,
    operating_margin: null,
    roe: null,
  };
  const stats = mapPayloadToVendorStats(payload);
  const keys = stats.map((s) => s.metricKey).sort();
  assert.deepEqual(keys, [
    "forward_pe_ratio",
    "market_cap",
    "perf_year",
    "revenue_growth_yoy",
    "roic",
    "rsi_14",
    "short_float",
  ]);
});

test("mapPayloadToVendorStats remaps sales/eps growth and market_cap_usd", () => {
  const stats = mapPayloadToVendorStats({
    market_cap_usd: 1000,
    sales_growth_yy: 6.96,
    eps_growth_yy: -3.6,
  });
  assert.equal(statByKey(stats, "market_cap")?.value, 1000);
  assert.equal(statByKey(stats, "revenue_growth_yoy")?.value, 6.96);
  assert.equal(statByKey(stats, "eps_growth_yoy")?.value, -3.6);
});

test("mapPayloadToVendorStats tags currency-denominated stats with the currency", () => {
  const stats = mapPayloadToVendorStats(
    { market_cap_usd: 1000, atr_14: 5.41, rsi_14: 70 },
    { currency: "USD" },
  );
  assert.equal(statByKey(stats, "market_cap")?.currency, "USD");
  assert.equal(statByKey(stats, "atr_14")?.currency, "USD");
  // Non-currency stats carry no currency field.
  assert.equal(statByKey(stats, "rsi_14")?.currency, undefined);
});

test("mapPayloadToVendorStats skips non-finite and non-numeric drift", () => {
  const stats = mapPayloadToVendorStats({
    market_cap_usd: Number.NaN,
    perf_year: Number.POSITIVE_INFINITY,
    rsi_14: "74.63" as unknown as number,
    short_float: 1.95,
  });
  assert.deepEqual(stats.map((s) => s.metricKey), ["short_float"]);
});

test("MAPPED_METRIC_KEYS has no duplicates and covers every emitted key", () => {
  assert.equal(new Set(MAPPED_METRIC_KEYS).size, MAPPED_METRIC_KEYS.length);
  const emitted = mapPayloadToVendorStats({
    market_cap_usd: 1,
    forward_pe: 1,
    roic: 1,
    sales_growth_yy: 1,
    eps_growth_yy: 1,
    rsi_14: 1,
    perf_week: 1,
    perf_month: 1,
    perf_quarter: 1,
    perf_half_year: 1,
    perf_year: 1,
    perf_ytd: 1,
    sma_20: 1,
    sma_50: 1,
    sma_200: 1,
    week_52_high: 1,
    week_52_low: 1,
    week_52_high_distance: 1,
    week_52_low_distance: 1,
    short_float: 1,
    relative_volume: 1,
    avg_volume: 1,
    atr_14: 1,
    volatility_week: 1,
    volatility_month: 1,
  });
  assert.deepEqual(emitted.map((s) => s.metricKey).sort(), [...MAPPED_METRIC_KEYS].sort());
});
