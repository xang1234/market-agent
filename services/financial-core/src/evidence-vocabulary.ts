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

export const DISCLOSURE_RELATIONS = ["original", "economic_restatement", "extraction_correction"] as const;
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
