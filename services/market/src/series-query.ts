// Series query binding (spec §6.2.3). Every series request must pin all
// five identity dimensions — `subject_refs`, `range`, `interval`, `basis`,
// `normalization` — before execution, caching, or snapshot binding.
// Implicit defaults are how comparison charts silently drift between
// adjusted and unadjusted history, or between pct-return and raw price,
// between calls.

import {
  ADJUSTMENT_BASES,
  assertBarRange,
  BAR_INTERVALS,
  freezeBarRange,
  type AdjustmentBasis,
  type BarInterval,
  type BarRange,
} from "./bar.ts";
import { assertListingRef, type ListingSubjectRef } from "./subject-ref.ts";
import { assertOneOf } from "./validators.ts";

// Spec §5 (SnapshotManifest): canonical normalization vocabulary. `raw` is
// the price/level passthrough; `pct_return` rebases each series to period
// returns; `index_100` rebases each series to 100 at coverage start;
// `currency_normalized` converts each series into one shared currency.
export type SeriesNormalization =
  | "raw"
  | "pct_return"
  | "index_100"
  | "currency_normalized";

export const SERIES_NORMALIZATIONS: ReadonlyArray<SeriesNormalization> = [
  "raw",
  "pct_return",
  "index_100",
  "currency_normalized",
];

export type NormalizedSeriesQuery = {
  subject_refs: ReadonlyArray<ListingSubjectRef>;
  range: BarRange;
  interval: BarInterval;
  basis: AdjustmentBasis;
  normalization: SeriesNormalization;
};

export function normalizedSeriesQuery(
  input: NormalizedSeriesQuery,
): NormalizedSeriesQuery {
  const subject_refs = freezeSubjectRefs(
    input.subject_refs,
    "normalizedSeriesQuery.subject_refs",
  );
  const range = freezeBarRange(input.range, "normalizedSeriesQuery.range");
  assertOneOf(input.interval, BAR_INTERVALS, "normalizedSeriesQuery.interval");
  assertOneOf(input.basis, ADJUSTMENT_BASES, "normalizedSeriesQuery.basis");
  assertOneOf(
    input.normalization,
    SERIES_NORMALIZATIONS,
    "normalizedSeriesQuery.normalization",
  );

  return Object.freeze({
    subject_refs,
    range,
    interval: input.interval,
    basis: input.basis,
    normalization: input.normalization,
  });
}

export function assertSeriesQueryContract(
  value: unknown,
): asserts value is NormalizedSeriesQuery {
  if (value === null || typeof value !== "object") {
    throw new Error("seriesQuery: must be an object");
  }
  const q = value as Record<string, unknown>;
  assertSubjectRefs(q.subject_refs, "seriesQuery.subject_refs");
  assertBarRange(q.range, "seriesQuery.range");
  assertOneOf(q.interval, BAR_INTERVALS, "seriesQuery.interval");
  assertOneOf(q.basis, ADJUSTMENT_BASES, "seriesQuery.basis");
  assertOneOf(
    q.normalization,
    SERIES_NORMALIZATIONS,
    "seriesQuery.normalization",
  );
}

function assertSubjectRefs(
  value: unknown,
  label: string,
): asserts value is ReadonlyArray<ListingSubjectRef> {
  if (!Array.isArray(value)) {
    throw new Error(`${label}: must be an array of listing SubjectRefs`);
  }
  if (value.length === 0) {
    throw new Error(`${label}: must contain at least one listing SubjectRef`);
  }
  // A duplicate listing inside one series query would silently inflate
  // weight in any equal-weighted comparison; reject at the binding boundary
  // so cache identity (cw0.2.2) doesn't have to.
  const seen = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    assertListingRef(value[i], `${label}[${i}]`);
    const id = (value[i] as ListingSubjectRef).id;
    if (seen.has(id)) {
      throw new Error(
        `${label}[${i}]: duplicate listing id "${id}" — series queries must contain each subject at most once`,
      );
    }
    seen.add(id);
  }
}

function freezeSubjectRefs(
  value: unknown,
  label: string,
): ReadonlyArray<ListingSubjectRef> {
  assertSubjectRefs(value, label);
  return Object.freeze(
    (value as ReadonlyArray<ListingSubjectRef>).map((ref) =>
      Object.freeze({ kind: ref.kind, id: ref.id } as ListingSubjectRef),
    ),
  );
}
