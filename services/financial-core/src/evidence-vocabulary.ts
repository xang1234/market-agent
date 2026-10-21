// The evidence vocabulary shared by the Evidence writers, the engine's
// candidate port, and the bound-input contract. Dependency-free, so Evidence
// imports it directly. The database check constraints enumerate the same
// values.

export const PRECISION_CLASSES = ["source_token_preserved", "revalidated_against_source", "legacy_unverified"] as const;
export type PrecisionClass = (typeof PRECISION_CLASSES)[number];
/** Precision classes whose raw token is proven equal to the stored value. */
export type ProvenPrecisionClass = Exclude<PrecisionClass, "legacy_unverified">;

export const PUBLICATION_TIMING_PRECISIONS = ["instant", "date", "observed_public"] as const;
export type PublicationTimingPrecision = (typeof PUBLICATION_TIMING_PRECISIONS)[number];

// A later filing's statement of an as-filed figure whose splits since the
// original could not be checked when it was stored is an unverified
// restatement: it may be a split recast or a real restatement.
export const DISCLOSURE_RELATIONS = ["original", "economic_restatement", "extraction_correction", "unverified_restatement"] as const;
export type DisclosureRelation = (typeof DISCLOSURE_RELATIONS)[number];

export const PERIOD_TYPES = ["duration", "instant"] as const;
export type PeriodType = (typeof PERIOD_TYPES)[number];

export const DIMENSION_SCOPES = ["consolidated", "segment"] as const;
export type DimensionScope = (typeof DIMENSION_SCOPES)[number];

// A filing restates its own per-share values and share counts for every split
// before it was filed, so such a value is on the split basis of its filing date.
export const ADJUSTMENT_BASES = ["unadjusted", "split_adjusted", "as_filed"] as const;
export type AdjustmentBasis = (typeof ADJUSTMENT_BASES)[number];
/** An as-filed value binds only once restated to the plan's reference date. */
export type BoundAdjustmentBasis = Exclude<AdjustmentBasis, "as_filed">;
export type AdjustmentContext =
  | Readonly<{ adjustment_basis: BoundAdjustmentBasis; as_filed_on?: never }>
  | Readonly<{ adjustment_basis: "as_filed"; as_filed_on: string }>;

export const SHARE_BASES = ["basic", "diluted", "not_applicable"] as const;
export type ShareBasis = (typeof SHARE_BASES)[number];

/** The classes of evidence a runtime authority allows a run to bind (#444). */
export const SOURCE_CLASSES = ["sec_filing", "issuer_disclosure", "licensed_fundamentals", "market_data"] as const;
export type SourceClass = (typeof SOURCE_CLASSES)[number];

/** What a source grounds in a run: a reported fact, or a share price. */
export type GroundedEvidence = "fact" | "price";

/**
 * Which sources ground which evidence, and as which class: every source of a
 * `sources.kind`, or only the approved sources of it. Every filing this system
 * ingests comes from EDGAR. A price is market data only from an approved
 * provider, Polygon's source (POLYGON_MARKET_SOURCE_ID, db/seed/sources.sql):
 * the Stooq, Yahoo and stock-screener feeds are `market_data` too, but they
 * serve development. A source no rule covers has no class, so no authority
 * admits it: an article, a press release, an upload, or a development feed.
 */
const SOURCE_CLASS_RULES: ReadonlyArray<Readonly<{ class: SourceClass; grounds: GroundedEvidence; kind: string; source_ids?: ReadonlyArray<string> }>> = [
  { class: "sec_filing", grounds: "fact", kind: "filing" },
  { class: "market_data", grounds: "price", kind: "market_data", source_ids: ["00000000-0000-4000-a000-000000000009"] },
];

/** The class of a source's evidence (#444), read at binding and again at the seal. */
export function sourceClassOf(source: Readonly<{ kind: string; source_id: string }>, grounds: GroundedEvidence): SourceClass | null {
  const id = source.source_id.toLowerCase();
  return SOURCE_CLASS_RULES.find((rule) => rule.grounds === grounds && rule.kind === source.kind && (rule.source_ids?.includes(id) ?? true))?.class ?? null;
}
