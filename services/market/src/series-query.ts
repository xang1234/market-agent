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
import {
  AVAILABILITY_REASONS,
  type AvailabilityReason,
} from "./availability.ts";
import {
  assertListingRef,
  freezeListingRef,
  type ListingSubjectRef,
} from "./subject-ref.ts";
import { assertBoolean, assertIso8601Utc, assertOneOf } from "./validators.ts";

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

export type SeriesCoverageLevel = "full" | "partial" | "unavailable";

export const SERIES_COVERAGE_LEVELS: ReadonlyArray<SeriesCoverageLevel> = [
  "full",
  "partial",
  "unavailable",
];

export type SeriesPoint = {
  x: string;
  y: number;
};

export type NormalizedSeries = {
  listing: ListingSubjectRef;
  points: ReadonlyArray<SeriesPoint>;
  coverage_start: string | null;
  coverage_end: string | null;
  coverage_level: SeriesCoverageLevel;
  unavailable_reason?: AvailabilityReason;
};

export type NormalizedSeriesInput = {
  listing: ListingSubjectRef;
  points: ReadonlyArray<SeriesPoint>;
  unavailable_reason?: AvailabilityReason;
};

export type NormalizedSeriesResponse = {
  query: NormalizedSeriesQuery;
  snapshot_compatible: boolean;
  as_of: string;
  series: ReadonlyArray<NormalizedSeries>;
};

export type NormalizedSeriesResponseInput = {
  query: NormalizedSeriesQuery;
  snapshot_compatible: boolean;
  as_of: string;
  series: ReadonlyArray<NormalizedSeriesInput>;
};

export type SeriesCacheIdentity = NormalizedSeriesQuery & {
  freshness_boundary: string;
};

export type SeriesCacheAuditResult = "hit" | "miss";

export type SeriesCacheAuditEvent = {
  cacheName: string;
  result: SeriesCacheAuditResult;
  identity: SeriesCacheIdentity;
  observedAt: string;
};

export type SeriesCacheAuditBucket = {
  value: string;
  total: number;
  hits: number;
  misses: number;
  hitRate: number;
};

export type SeriesCacheAuditDashboard = {
  total: number;
  hits: number;
  misses: number;
  hitRate: number;
  byDimension: {
    interval: ReadonlyArray<SeriesCacheAuditBucket>;
    basis: ReadonlyArray<SeriesCacheAuditBucket>;
    normalization: ReadonlyArray<SeriesCacheAuditBucket>;
    freshnessBoundary: ReadonlyArray<SeriesCacheAuditBucket>;
    subjectSet: ReadonlyArray<SeriesCacheAuditBucket>;
  };
};

export type SeriesAllowedTransform = {
  range: BarRange;
  interval: BarInterval;
};

export type SeriesTransformReuseRejectionReason =
  | "identity_changed"
  | "requires_fresher_data"
  | "interval_not_allowed"
  | "range_not_allowed";

export type SeriesTransformReuseDecision =
  | { allowed: true }
  | { allowed: false; reason: SeriesTransformReuseRejectionReason };

export type SeriesTransformReuseInput = {
  sealed_identity: SeriesCacheIdentity;
  snapshot_as_of: string;
  allowed_transforms: ReadonlyArray<SeriesAllowedTransform>;
  requested_query: NormalizedSeriesQuery;
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

export function normalizedSeriesResponse(
  input: NormalizedSeriesResponseInput,
): NormalizedSeriesResponse {
  if (input === null || typeof input !== "object") {
    throw new Error("normalizedSeriesResponse: must be an object");
  }
  const query = normalizedSeriesQuery(input.query);
  assertBoolean(
    input.snapshot_compatible,
    "normalizedSeriesResponse.snapshot_compatible",
  );
  const as_of = canonicalTimestamp(input.as_of, "normalizedSeriesResponse.as_of");
  const series = normalizeSeriesResponseSubjects(input.series, query);

  return Object.freeze({
    query,
    snapshot_compatible: input.snapshot_compatible,
    as_of,
    series,
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

export function buildSeriesCacheAuditDashboard(
  events: ReadonlyArray<SeriesCacheAuditEvent>,
): SeriesCacheAuditDashboard {
  const totals = countCacheEvents(events);
  return Object.freeze({
    ...totals,
    byDimension: Object.freeze({
      interval: bucketBy(events, (event) => event.identity.interval),
      basis: bucketBy(events, (event) => event.identity.basis),
      normalization: bucketBy(events, (event) => event.identity.normalization),
      freshnessBoundary: bucketBy(
        events,
        (event) => event.identity.freshness_boundary,
      ),
      subjectSet: bucketBy(events, (event) =>
        event.identity.subject_refs.map((ref) => ref.id).join(","),
      ),
    }),
  });
}

export function seriesTransformReuseDecision(
  input: SeriesTransformReuseInput,
): SeriesTransformReuseDecision {
  const sealed = seriesCacheIdentity(
    input.sealed_identity,
    input.sealed_identity.freshness_boundary,
  );
  const requested = seriesCacheIdentity(
    input.requested_query,
    sealed.freshness_boundary,
  );
  const snapshot_as_of = canonicalTimestamp(
    input.snapshot_as_of,
    "seriesTransformReuseDecision.snapshot_as_of",
  );
  const allowed_transforms = normalizedAllowedTransforms(
    input.allowed_transforms,
  );

  if (
    !sameSubjectSet(requested.subject_refs, sealed.subject_refs) ||
    requested.basis !== sealed.basis ||
    requested.normalization !== sealed.normalization
  ) {
    return denySeriesReuse("identity_changed");
  }

  if (compareCanonicalTimestamps(requested.range.end, snapshot_as_of) > 0) {
    return denySeriesReuse("requires_fresher_data");
  }

  if (
    !allowed_transforms.some(
      (transform) => transform.interval === requested.interval,
    )
  ) {
    return denySeriesReuse("interval_not_allowed");
  }

  if (
    !allowed_transforms.some(
      (transform) =>
        transform.interval === requested.interval &&
        transform.range.start === requested.range.start &&
        transform.range.end === requested.range.end,
    )
  ) {
    return denySeriesReuse("range_not_allowed");
  }

  return Object.freeze({ allowed: true });
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

export function assertSeriesResponseContract(
  value: unknown,
): asserts value is NormalizedSeriesResponse {
  if (value === null || typeof value !== "object") {
    throw new Error("seriesResponse: must be an object");
  }
  const response = value as Record<string, unknown>;
  assertSeriesQueryContract(response.query);
  assertBoolean(response.snapshot_compatible, "seriesResponse.snapshot_compatible");
  assertIso8601Utc(response.as_of, "seriesResponse.as_of");
  assertSeriesContractItems(
    response.series,
    normalizedSeriesQuery(response.query as NormalizedSeriesQuery),
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

function countCacheEvents(
  events: ReadonlyArray<Pick<SeriesCacheAuditEvent, "result">>,
): Omit<SeriesCacheAuditBucket, "value"> {
  let hits = 0;
  let misses = 0;
  for (const event of events) {
    if (event.result === "hit") hits++;
    else misses++;
  }
  const total = hits + misses;
  return Object.freeze({
    total,
    hits,
    misses,
    hitRate: total === 0 ? 0 : hits / total,
  });
}

function bucketBy(
  events: ReadonlyArray<SeriesCacheAuditEvent>,
  keyFor: (event: SeriesCacheAuditEvent) => string,
): ReadonlyArray<SeriesCacheAuditBucket> {
  const groups = new Map<string, SeriesCacheAuditEvent[]>();
  for (const event of events) {
    const key = keyFor(event);
    const bucket = groups.get(key);
    if (bucket) bucket.push(event);
    else groups.set(key, [event]);
  }

  const buckets = Array.from(groups.entries()).map(([value, group]) =>
    Object.freeze({
      value,
      ...countCacheEvents(group),
    }),
  );
  buckets.sort((a, b) => b.total - a.total || a.value.localeCompare(b.value));
  return Object.freeze(buckets);
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

function normalizeSeriesResponseSubjects(
  value: unknown,
  query: NormalizedSeriesQuery,
): ReadonlyArray<NormalizedSeries> {
  if (!Array.isArray(value)) {
    throw new Error("normalizedSeriesResponse.series: must be an array");
  }

  const expectedIds = new Set(query.subject_refs.map((ref) => ref.id));
  const byId = new Map<string, NormalizedSeries>();
  for (let i = 0; i < value.length; i++) {
    const series = normalizeSeriesResponseSubject(
      value[i],
      query,
      `normalizedSeriesResponse.series[${i}]`,
    );
    if (!expectedIds.has(series.listing.id)) {
      throw new Error(
        `normalizedSeriesResponse.series[${i}].listing: unexpected series for subject ${series.listing.id}`,
      );
    }
    if (byId.has(series.listing.id)) {
      throw new Error(
        `normalizedSeriesResponse.series[${i}].listing: duplicate series for subject ${series.listing.id}`,
      );
    }
    byId.set(series.listing.id, series);
  }

  const ordered: NormalizedSeries[] = [];
  for (const subject of query.subject_refs) {
    const series = byId.get(subject.id);
    if (!series) {
      throw new Error(
        `normalizedSeriesResponse.series: missing series for subject ${subject.id}`,
      );
    }
    ordered.push(series);
  }
  return Object.freeze(ordered);
}

function normalizeSeriesResponseSubject(
  value: unknown,
  query: NormalizedSeriesQuery,
  label: string,
): NormalizedSeries {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  const item = value as Record<string, unknown>;
  const listing = freezeListingRef(item.listing as ListingSubjectRef, `${label}.listing`);
  const points = normalizeSeriesPoints(item.points, query.range, `${label}.points`);

  if (points.length === 0) {
    const reason = item.unavailable_reason ?? "missing_coverage";
    assertOneOf(reason, AVAILABILITY_REASONS, `${label}.unavailable_reason`);
    return Object.freeze({
      listing,
      points,
      coverage_start: null,
      coverage_end: null,
      coverage_level: "unavailable",
      unavailable_reason: reason,
    });
  }

  if (item.unavailable_reason !== undefined) {
    throw new Error(
      `${label}.unavailable_reason: must be omitted when points are available`,
    );
  }

  const coverage_start = points[0].x;
  const coverage_end = points[points.length - 1].x;
  const requestedStart = canonicalTimestamp(
    query.range.start,
    `${label}.query.range.start`,
  );
  const coverage_level =
    compareCanonicalTimestamps(coverage_start, requestedStart) > 0
      ? "partial"
      : "full";

  return Object.freeze({
    listing,
    points,
    coverage_start,
    coverage_end,
    coverage_level,
  });
}

function normalizeSeriesPoints(
  value: unknown,
  range: BarRange,
  label: string,
): ReadonlyArray<SeriesPoint> {
  if (!Array.isArray(value)) {
    throw new Error(`${label}: must be an array`);
  }
  const start = canonicalTimestamp(range.start, `${label}.range.start`);
  const end = canonicalTimestamp(range.end, `${label}.range.end`);
  let previous: string | undefined;
  const points: SeriesPoint[] = [];

  for (let i = 0; i < value.length; i++) {
    const point = normalizeSeriesPoint(value[i], `${label}[${i}]`);
    if (
      compareCanonicalTimestamps(point.x, start) < 0 ||
      compareCanonicalTimestamps(point.x, end) >= 0
    ) {
      throw new Error(
        `${label}[${i}].x: ${point.x} falls outside requested range [${start}, ${end})`,
      );
    }
    if (
      previous !== undefined &&
      compareCanonicalTimestamps(point.x, previous) <= 0
    ) {
      throw new Error(
        `${label}[${i}].x: ${point.x} is not strictly after the previous point`,
      );
    }
    previous = point.x;
    points.push(point);
  }

  return Object.freeze(points);
}

function normalizeSeriesPoint(value: unknown, label: string): SeriesPoint {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  const point = value as Record<string, unknown>;
  const x = canonicalTimestamp(point.x as string, `${label}.x`);
  assertFiniteNumber(point.y, `${label}.y`);
  return Object.freeze({ x, y: point.y as number });
}

function assertSeriesContractItems(
  value: unknown,
  query: NormalizedSeriesQuery,
): void {
  if (!Array.isArray(value)) {
    throw new Error("seriesResponse.series: must be an array");
  }
  const expectedIds = new Set(query.subject_refs.map((ref) => ref.id));
  const seenIds = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    assertSeriesContractItem(value[i], query, `seriesResponse.series[${i}]`);
    const id = (value[i] as NormalizedSeries).listing.id;
    if (!expectedIds.has(id)) {
      throw new Error(
        `seriesResponse.series[${i}].listing: unexpected series for subject ${id}`,
      );
    }
    if (seenIds.has(id)) {
      throw new Error(
        `seriesResponse.series[${i}].listing: duplicate series for subject ${id}`,
      );
    }
    seenIds.add(id);
  }
  for (const subject of query.subject_refs) {
    if (!seenIds.has(subject.id)) {
      throw new Error(
        `seriesResponse.series: missing series for subject ${subject.id}`,
      );
    }
  }
}

function assertSeriesContractItem(
  value: unknown,
  query: NormalizedSeriesQuery,
  label: string,
): void {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  const item = value as Record<string, unknown>;
  assertListingRef(item.listing, `${label}.listing`);
  const points = normalizeSeriesPoints(item.points, query.range, `${label}.points`);
  if (!Object.hasOwn(item, "coverage_start")) {
    throw new Error(`${label}.coverage_start: required coverage field`);
  }
  if (!Object.hasOwn(item, "coverage_end")) {
    throw new Error(`${label}.coverage_end: required coverage field`);
  }
  assertOneOf(item.coverage_level, SERIES_COVERAGE_LEVELS, `${label}.coverage_level`);

  if (item.coverage_level === "unavailable") {
    if (points.length !== 0) {
      throw new Error(`${label}.points: unavailable coverage requires no points`);
    }
    if (item.coverage_start !== null || item.coverage_end !== null) {
      throw new Error(
        `${label}: unavailable coverage requires null coverage_start and coverage_end`,
      );
    }
    assertOneOf(
      item.unavailable_reason,
      AVAILABILITY_REASONS,
      `${label}.unavailable_reason`,
    );
    return;
  }

  if (points.length === 0) {
    throw new Error(`${label}.points: available coverage requires at least one point`);
  }
  const coverageStart = canonicalTimestamp(
    item.coverage_start as string,
    `${label}.coverage_start`,
  );
  const coverageEnd = canonicalTimestamp(
    item.coverage_end as string,
    `${label}.coverage_end`,
  );
  if (coverageStart !== points[0].x) {
    throw new Error(
      `${label}.coverage_start: must equal the first point timestamp`,
    );
  }
  if (coverageEnd !== points[points.length - 1].x) {
    throw new Error(`${label}.coverage_end: must equal the last point timestamp`);
  }
  const requestedStart = canonicalTimestamp(
    query.range.start,
    `${label}.query.range.start`,
  );
  const expectedCoverageLevel =
    compareCanonicalTimestamps(coverageStart, requestedStart) > 0
      ? "partial"
      : "full";
  if (item.coverage_level !== expectedCoverageLevel) {
    throw new Error(
      `${label}.coverage_level: expected ${expectedCoverageLevel} for coverage_start ${coverageStart}`,
    );
  }
  if (item.unavailable_reason !== undefined) {
    throw new Error(
      `${label}.unavailable_reason: must be omitted when coverage is available`,
    );
  }
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label}: must be a finite number; received ${String(value)}`);
  }
}

function canonicalTimestamp(value: string, label: string): string {
  assertIso8601Utc(value, label);
  const match = CACHE_TIMESTAMP.exec(value);
  if (!match) {
    throw new Error(
      `${label}: must be an ISO-8601 timestamp with explicit Z or offset; received ${String(value)}`,
    );
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

function normalizedAllowedTransforms(
  value: unknown,
): ReadonlyArray<SeriesAllowedTransform> {
  if (!Array.isArray(value)) {
    throw new Error(
      "seriesTransformReuseDecision.allowed_transforms: must be an array",
    );
  }
  return Object.freeze(
    value.map((transform, index) =>
      normalizeAllowedTransform(
        transform,
        `seriesTransformReuseDecision.allowed_transforms[${index}]`,
      ),
    ),
  );
}

function normalizeAllowedTransform(
  value: unknown,
  label: string,
): SeriesAllowedTransform {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  const transform = value as Record<string, unknown>;
  assertOneOf(transform.interval, BAR_INTERVALS, `${label}.interval`);
  assertBarRange(transform.range, `${label}.range`);
  const range = transform.range as BarRange;
  return Object.freeze({
    interval: transform.interval,
    range: Object.freeze({
      start: canonicalTimestamp(range.start, `${label}.range.start`),
      end: canonicalTimestamp(range.end, `${label}.range.end`),
    }),
  });
}

function sameSubjectSet(
  left: ReadonlyArray<ListingSubjectRef>,
  right: ReadonlyArray<ListingSubjectRef>,
): boolean {
  return (
    left.length === right.length &&
    left.every((ref, index) => ref.id === right[index].id)
  );
}

function compareCanonicalTimestamps(left: string, right: string): number {
  const leftParts = canonicalTimestampParts(left);
  const rightParts = canonicalTimestampParts(right);
  const secondDiff = leftParts.secondMs - rightParts.secondMs;
  if (secondDiff !== 0) {
    return secondDiff;
  }
  return leftParts.fractionNanos - rightParts.fractionNanos;
}

function canonicalTimestampParts(value: string): {
  secondMs: number;
  fractionNanos: number;
} {
  const match = CACHE_TIMESTAMP.exec(value);
  if (!match) {
    throw new Error(`timestamp: expected canonical timestamp; received ${value}`);
  }
  const [, year, month, day, hour, minute, second, fraction] = match;
  return {
    secondMs: Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      0,
    ),
    fractionNanos: Number((fraction ?? "0").padEnd(9, "0")),
  };
}

function denySeriesReuse(
  reason: SeriesTransformReuseRejectionReason,
): SeriesTransformReuseDecision {
  return Object.freeze({ allowed: false, reason });
}
