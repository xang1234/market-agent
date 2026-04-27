// Closed registries for the screener-owned field surface (spec §6.7.1).
//
// The screener contract forbids two things:
//   1. Freeform DSLs ("revenue * 1.5 / market_cap > foo")
//   2. Raw provider payload columns ("polygon.lastTrade.p")
//
// Both rules are enforced by binding every clause to one of the named
// fields below. Adding a new screener-queryable field is a registry edit
// here — it must be backed by a market-data or fundamentals output that
// the service already consumes, never invented client-side.
//
// Field kinds:
//   - "enum"    — categorical, queried with `values: string[]`
//   - "numeric" — quantitative, queried with `{min?, max?}` inclusive bounds
//
// Per-dimension splits follow the spec's required dimensions:
//   - universe      → identity / membership filters (asset_type, mic, …)
//   - market        → quote / bar derived signals (last_price, volume, …)
//   - fundamentals  → statement-derived aggregates and key stats

export type FieldKind = "enum" | "numeric";
export type ScreenerDimension = "universe" | "market" | "fundamentals";

export type FieldDefinition = {
  field: string;
  dimension: ScreenerDimension;
  kind: FieldKind;
  // For enum fields, the closed set of legal values. Numeric fields omit it.
  // The screener rejects clauses whose values fall outside this set.
  enum_values?: ReadonlyArray<string>;
  // Numeric fields are sortable; enum fields are not (alpha sort is not
  // semantically meaningful for things like asset_type).
  sortable: boolean;
};

// Asset types align with stock-agent-v2.md §6.1 Instrument.asset_type.
export type AssetType =
  | "common_stock"
  | "adr"
  | "etf"
  | "index"
  | "crypto"
  | "fx"
  | "bond";

export const ASSET_TYPES: ReadonlyArray<AssetType> = [
  "common_stock",
  "adr",
  "etf",
  "index",
  "crypto",
  "fx",
  "bond",
];

// Delay class mirrors `services/market/src/quote.ts` DELAY_CLASSES. Re-stating
// the values here keeps the screener service free of cross-package imports;
// drift would surface as a screener test failure rather than a silent
// production mismatch.
export const DELAY_CLASSES_FOR_SCREENER: ReadonlyArray<string> = [
  "realtime",
  "delayed_15m",
  "eod",
];

const DEFINITIONS: ReadonlyArray<FieldDefinition> = [
  // Universe — listing/issuer/instrument identity attributes.
  { field: "asset_type", dimension: "universe", kind: "enum", enum_values: ASSET_TYPES, sortable: false },
  { field: "mic", dimension: "universe", kind: "enum", sortable: false },
  { field: "trading_currency", dimension: "universe", kind: "enum", sortable: false },
  { field: "domicile", dimension: "universe", kind: "enum", sortable: false },
  { field: "sector", dimension: "universe", kind: "enum", sortable: false },
  { field: "industry", dimension: "universe", kind: "enum", sortable: false },

  // Market — quote/bar derived signals exposed by the market-data service.
  { field: "last_price", dimension: "market", kind: "numeric", sortable: true },
  { field: "prev_close", dimension: "market", kind: "numeric", sortable: true },
  { field: "change_pct", dimension: "market", kind: "numeric", sortable: true },
  { field: "volume", dimension: "market", kind: "numeric", sortable: true },
  {
    field: "delay_class",
    dimension: "market",
    kind: "enum",
    enum_values: DELAY_CLASSES_FOR_SCREENER,
    sortable: false,
  },

  // Fundamentals — KeyStat outputs (services/fundamentals/src/key-stats.ts)
  // plus a market_cap aggregate. Adding more fields here is a contract
  // change: each must be backed by a fundamentals service output.
  { field: "gross_margin", dimension: "fundamentals", kind: "numeric", sortable: true },
  { field: "operating_margin", dimension: "fundamentals", kind: "numeric", sortable: true },
  { field: "net_margin", dimension: "fundamentals", kind: "numeric", sortable: true },
  { field: "revenue_growth_yoy", dimension: "fundamentals", kind: "numeric", sortable: true },
  { field: "pe_ratio", dimension: "fundamentals", kind: "numeric", sortable: true },
  { field: "market_cap", dimension: "fundamentals", kind: "numeric", sortable: true },
];

const REGISTRY: ReadonlyMap<string, FieldDefinition> = new Map(
  DEFINITIONS.map((def) => [def.field, Object.freeze({ ...def })]),
);

export const FIELD_DEFINITIONS: ReadonlyArray<FieldDefinition> = Object.freeze(
  DEFINITIONS.map((def) => Object.freeze({ ...def })),
);

export function getFieldDefinition(field: string): FieldDefinition | undefined {
  return REGISTRY.get(field);
}

export function fieldsByDimension(
  dimension: ScreenerDimension,
): ReadonlyArray<FieldDefinition> {
  return FIELD_DEFINITIONS.filter((def) => def.dimension === dimension);
}
