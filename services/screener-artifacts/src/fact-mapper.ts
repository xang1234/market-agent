import type { NormalizedPayload, VendorStat } from "./types.ts";

// The field → metric mapping contract. Restricted to the fields the weekly bundle
// actually populates (verified: identity 100%, technicals ~97-99%, market_cap ~62%,
// forward_pe/roic/growth 30-55%) — the trailing margins/PE/ROE columns are 0%
// covered upstream, so they are intentionally absent here and keep coming from the
// SEC/dev fundamentals path. Notable remaps: market_cap_usd→market_cap,
// sales_growth_yy→revenue_growth_yoy, eps_growth_yy→eps_growth_yoy. `sma_20/50/200`
// are finviz-style %-distance-from-MA momentum indicators, not price levels.
type StatMapping = {
  field: keyof NormalizedPayload;
  metricKey: string;
  unit: "currency" | "percent" | "ratio" | "count";
};

const CURRENCY_UNIT = "currency";

const MAPPINGS: ReadonlyArray<StatMapping> = [
  { field: "market_cap_usd", metricKey: "market_cap", unit: CURRENCY_UNIT },
  { field: "forward_pe", metricKey: "forward_pe_ratio", unit: "ratio" },
  { field: "roic", metricKey: "roic", unit: "percent" },
  { field: "sales_growth_yy", metricKey: "revenue_growth_yoy", unit: "percent" },
  { field: "eps_growth_yy", metricKey: "eps_growth_yoy", unit: "percent" },
  { field: "rsi_14", metricKey: "rsi_14", unit: "ratio" },
  { field: "perf_week", metricKey: "perf_week", unit: "percent" },
  { field: "perf_month", metricKey: "perf_month", unit: "percent" },
  { field: "perf_quarter", metricKey: "perf_quarter", unit: "percent" },
  { field: "perf_half_year", metricKey: "perf_half_year", unit: "percent" },
  { field: "perf_year", metricKey: "perf_year", unit: "percent" },
  { field: "perf_ytd", metricKey: "perf_ytd", unit: "percent" },
  { field: "sma_20", metricKey: "sma_20", unit: "percent" },
  { field: "sma_50", metricKey: "sma_50", unit: "percent" },
  { field: "sma_200", metricKey: "sma_200", unit: "percent" },
  { field: "week_52_high", metricKey: "week_52_high", unit: CURRENCY_UNIT },
  { field: "week_52_low", metricKey: "week_52_low", unit: CURRENCY_UNIT },
  { field: "week_52_high_distance", metricKey: "week_52_high_distance", unit: "percent" },
  { field: "week_52_low_distance", metricKey: "week_52_low_distance", unit: "percent" },
  { field: "short_float", metricKey: "short_float", unit: "percent" },
  { field: "relative_volume", metricKey: "relative_volume", unit: "ratio" },
  { field: "avg_volume", metricKey: "avg_volume", unit: "count" },
  { field: "atr_14", metricKey: "atr_14", unit: CURRENCY_UNIT },
  { field: "volatility_week", metricKey: "volatility_week", unit: "percent" },
  { field: "volatility_month", metricKey: "volatility_month", unit: "percent" },
];

// The metric_keys this mapper can emit — used by the ETL to load metric_id lookups
// and to fail fast if the registry seed is missing one.
export const MAPPED_METRIC_KEYS: ReadonlyArray<string> = MAPPINGS.map((m) => m.metricKey);

// Maps a single symbol's payload to the vendor stats worth minting. Only finite
// numbers survive — nulls (the common case) and any non-numeric drift are skipped,
// so a symbol contributes only the stats it actually carries.
export function mapPayloadToVendorStats(
  payload: NormalizedPayload,
  opts: { currency?: string } = {},
): VendorStat[] {
  const currency = opts.currency ?? "USD";
  const stats: VendorStat[] = [];
  for (const mapping of MAPPINGS) {
    const value = payload[mapping.field];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    stats.push({
      metricKey: mapping.metricKey,
      value,
      unit: mapping.unit,
      ...(mapping.unit === CURRENCY_UNIT ? { currency } : {}),
    });
  }
  return stats;
}
