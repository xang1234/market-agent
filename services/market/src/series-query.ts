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
import { assertIso8601Utc, assertOneOf } from "./validators.ts";

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

export type SeriesCacheIdentity = NormalizedSeriesQuery & {
  freshness_boundary: string;
};

const SERIES_CACHE_KEY_VERSION = "series:v1";
const CACHE_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;

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

export function seriesCacheIdentity(
  input: NormalizedSeriesQuery,
  freshness_boundary: string,
): SeriesCacheIdentity {
  const q = normalizedSeriesQuery(input);
  const subject_refs = freezeCanonicalSubjectSet(q.subject_refs);
  const range = Object.freeze({
    start: canonicalTimestamp(q.range.start, "seriesCacheIdentity.range.start"),
    end: canonicalTimestamp(q.range.end, "seriesCacheIdentity.range.end"),
  });

  return Object.freeze({
    subject_refs,
    range,
    interval: q.interval,
    basis: q.basis,
    normalization: q.normalization,
    freshness_boundary: canonicalTimestamp(
      freshness_boundary,
      "seriesCacheIdentity.freshness_boundary",
    ),
  });
}

export function seriesCacheKey(
  input: NormalizedSeriesQuery,
  freshness_boundary: string,
): string {
  const identity = seriesCacheIdentity(input, freshness_boundary);
  return `${SERIES_CACHE_KEY_VERSION}:${JSON.stringify(identity)}`;
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

function freezeCanonicalSubjectSet(
  subject_refs: ReadonlyArray<ListingSubjectRef>,
): ReadonlyArray<ListingSubjectRef> {
  const refs = subject_refs
    .map((ref) => ({ kind: ref.kind, id: ref.id } as ListingSubjectRef))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return Object.freeze(refs.map((ref) => Object.freeze(ref)));
}

function canonicalTimestamp(value: string, label: string): string {
  assertIso8601Utc(value, label);
  const match = CACHE_TIMESTAMP.exec(value);
  if (!match) {
    throw new Error(`${label}: must be an ISO-8601 timestamp with explicit Z or offset; received ${String(value)}`);
  }

  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
    fraction,
    zone,
    offsetSign,
    offsetHour,
    offsetMinute,
  ] = match;
  const localSecond = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      0,
    ),
  );
  localSecond.setUTCFullYear(Number(year));

  const offsetMinutes =
    zone === "Z"
      ? 0
      : (offsetSign === "+" ? 1 : -1) *
        (Number(offsetHour) * 60 + Number(offsetMinute));
  const utcSecond = new Date(localSecond.getTime() - offsetMinutes * 60_000);
  const datePart = utcSecond.toISOString().slice(0, 19);
  return `${datePart}.${canonicalFraction(fraction)}Z`;
}

function canonicalFraction(fraction: string | undefined): string {
  if (!fraction || /^0+$/.test(fraction)) {
    return "000";
  }
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed.length < 3 ? trimmed.padEnd(3, "0") : trimmed;
}
