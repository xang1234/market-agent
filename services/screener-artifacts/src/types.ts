import type { QueryResult } from "pg";

// Minimal pg-compatible executor. A pg.Pool/Client satisfies this, and so does an
// in-memory fake in tests. Mirrors services/evidence/src/types.ts so loaders can be
// unit-tested without a live database.
export type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

// ---------------------------------------------------------------------------
// Wire shapes for the xang1234/stock-screener weekly-reference GitHub Release.
// Field names and the heavy per-field sparsity were verified against a real
// bundle (weekly-reference-us-20260603, ~9.8k US rows): identity fields are 100%
// covered, technicals ~97-99%, market_cap ~62%, trailing margins/PE/ROE 0%.
// ---------------------------------------------------------------------------

export const WEEKLY_MANIFEST_SCHEMA = "weekly-reference-manifest-v1";
export const WEEKLY_BUNDLE_SCHEMA = "weekly-reference-bundle-v1";

// The tiny `weekly-reference-latest-{market}.json` pointer asset.
export type WeeklyReferenceManifest = {
  schema_version: typeof WEEKLY_MANIFEST_SCHEMA;
  market: string;
  as_of_date: string; // YYYY-MM-DD
  bundle_asset_name: string;
  sha256: string;
  generated_at: string;
  coverage?: {
    active_symbols?: number;
    covered_active_symbols?: number;
    missing_active_symbols?: number;
  };
};

// One `universe[]` entry — the authoritative identity record (carries the MIC in
// `exchange`, unlike a row's label-form `exchange`). 100% covered in practice.
export type UniverseEntry = {
  symbol: string;
  name: string | null;
  exchange: string | null; // MIC, e.g. "XNYS" / "XNAS" / "XASE"
  currency: string | null;
  timezone: string | null;
  sector: string | null;
  industry: string | null;
  market: string | null;
  is_active: boolean;
};

// One `snapshot.rows[]` entry. `normalized_payload` carries the stats; its
// `exchange` is the label form (e.g. "NYSE") — prefer the universe MIC.
export type BundleRow = {
  symbol: string;
  exchange: string | null;
  row_hash?: string;
  normalized_payload: NormalizedPayload;
};

// The stat payload. Only the fields the ETL maps are typed; the bundle carries
// ~80 fields total, so an index signature keeps the rest accessible without
// pretending we model them. All mapped stats are nullable — sparsity is the norm.
export type NormalizedPayload = {
  symbol?: string;
  company_name?: string | null;
  country?: string | null;
  sector?: string | null;
  industry?: string | null;
  market_cap?: number | null;
  market_cap_usd?: number | null;
  forward_pe?: number | null;
  roic?: number | null;
  sales_growth_yy?: number | null;
  eps_growth_yy?: number | null;
  rsi_14?: number | null;
  perf_week?: number | null;
  perf_month?: number | null;
  perf_quarter?: number | null;
  perf_half_year?: number | null;
  perf_year?: number | null;
  perf_ytd?: number | null;
  sma_20?: number | null;
  sma_50?: number | null;
  sma_200?: number | null;
  week_52_high?: number | null;
  week_52_low?: number | null;
  week_52_high_distance?: number | null;
  week_52_low_distance?: number | null;
  short_float?: number | null;
  relative_volume?: number | null;
  avg_volume?: number | null;
  atr_14?: number | null;
  volatility_week?: number | null;
  volatility_month?: number | null;
  [field: string]: unknown;
};

export type WeeklyReferenceBundle = {
  schema_version: typeof WEEKLY_BUNDLE_SCHEMA;
  market: string;
  as_of_date: string;
  snapshot: {
    rows: BundleRow[];
  };
  universe: UniverseEntry[];
};

// The neutral, DB-free output of the fact-mapper: one stat the ETL will mint as a
// method='vendor' point fact. `unit` mirrors the metric's unit_class; `currency`
// is set only for currency-denominated stats (market_cap, atr_14, 52w levels).
export type VendorStat = {
  metricKey: string;
  value: number;
  unit: string;
  currency?: string;
};
