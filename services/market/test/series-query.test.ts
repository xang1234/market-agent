import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSeriesQueryContract,
  normalizedSeriesQuery,
  SERIES_NORMALIZATIONS,
  seriesCacheIdentity,
  seriesCacheKey,
  seriesTransformReuseDecision,
  type NormalizedSeriesQuery,
  type SeriesAllowedTransform,
} from "../src/series-query.ts";
import { ADJUSTMENT_BASES, BAR_INTERVALS } from "../src/bar.ts";
import type { ListingSubjectRef } from "../src/subject-ref.ts";
import { aaplListing, msftListing } from "./fixtures.ts";

const RANGE = {
  start: "2026-01-01T00:00:00.000Z",
  end: "2026-04-01T00:00:00.000Z",
};
const FRESHNESS_BOUNDARY = "2026-04-22T15:30:00.000Z";
const SNAPSHOT_AS_OF = "2026-04-22T15:30:00.000Z";

function validInput(): NormalizedSeriesQuery {
  return {
    subject_refs: [aaplListing, msftListing],
    range: RANGE,
    interval: "1d",
    basis: "split_and_div_adjusted",
    normalization: "pct_return",
  };
}

function allowedTransform(
  range = RANGE,
  interval: NormalizedSeriesQuery["interval"] = "1d",
): SeriesAllowedTransform {
  return { range, interval };
}

function reuseDecision(input: {
  requested_query?: NormalizedSeriesQuery;
  allowed_transforms?: ReadonlyArray<SeriesAllowedTransform>;
  snapshot_as_of?: string;
}) {
  return seriesTransformReuseDecision({
    sealed_identity: seriesCacheIdentity(validInput(), FRESHNESS_BOUNDARY),
    snapshot_as_of: input.snapshot_as_of ?? SNAPSHOT_AS_OF,
    allowed_transforms: input.allowed_transforms ?? [allowedTransform()],
    requested_query: input.requested_query ?? validInput(),
  });
}

test("normalizedSeriesQuery accepts a fully bound query and returns frozen output", () => {
  const input = validInput();
  const q = normalizedSeriesQuery(input);

  assert.equal(Object.isFrozen(q), true);
  assert.equal(Object.isFrozen(q.subject_refs), true);
  assert.equal(Object.isFrozen(q.subject_refs[0]), true);
  assert.equal(Object.isFrozen(q.range), true);

  assert.notEqual(q.subject_refs, input.subject_refs);
  assert.notEqual(q.subject_refs[0], input.subject_refs[0]);
  assert.notEqual(q.range, input.range);

  assert.equal(q.subject_refs.length, 2);
  assert.equal(q.subject_refs[0].id, aaplListing.id);
  assert.equal(q.range.start, RANGE.start);
  assert.equal(q.interval, "1d");
  assert.equal(q.basis, "split_and_div_adjusted");
  assert.equal(q.normalization, "pct_return");
});

test("normalizedSeriesQuery accepts a single-subject query", () => {
  const q = normalizedSeriesQuery({ ...validInput(), subject_refs: [aaplListing] });
  assert.equal(q.subject_refs.length, 1);
});

test("normalizedSeriesQuery rejects a query missing subject_refs", () => {
  assert.throws(
    () =>
      normalizedSeriesQuery({
        range: RANGE,
        interval: "1d",
        basis: "split_and_div_adjusted",
        normalization: "pct_return",
      } as unknown as NormalizedSeriesQuery),
    /subject_refs/,
  );
});

test("normalizedSeriesQuery rejects a query missing range", () => {
  assert.throws(
    () =>
      normalizedSeriesQuery({
        subject_refs: [aaplListing, msftListing],
        interval: "1d",
        basis: "split_and_div_adjusted",
        normalization: "pct_return",
      } as unknown as NormalizedSeriesQuery),
    /range/,
  );
});

test("normalizedSeriesQuery rejects a query missing interval", () => {
  assert.throws(
    () =>
      normalizedSeriesQuery({
        subject_refs: [aaplListing, msftListing],
        range: RANGE,
        basis: "split_and_div_adjusted",
        normalization: "pct_return",
      } as unknown as NormalizedSeriesQuery),
    /interval/,
  );
});

test("normalizedSeriesQuery rejects a query missing basis", () => {
  assert.throws(
    () =>
      normalizedSeriesQuery({
        subject_refs: [aaplListing, msftListing],
        range: RANGE,
        interval: "1d",
        normalization: "pct_return",
      } as unknown as NormalizedSeriesQuery),
    /basis/,
  );
});

test("normalizedSeriesQuery rejects a query missing normalization", () => {
  assert.throws(
    () =>
      normalizedSeriesQuery({
        subject_refs: [aaplListing, msftListing],
        range: RANGE,
        interval: "1d",
        basis: "split_and_div_adjusted",
      } as unknown as NormalizedSeriesQuery),
    /normalization/,
  );
});

test("normalizedSeriesQuery rejects an empty subject_refs array", () => {
  assert.throws(
    () => normalizedSeriesQuery({ ...validInput(), subject_refs: [] }),
    /at least one/,
  );
});

test("normalizedSeriesQuery rejects duplicate listing ids in subject_refs", () => {
  assert.throws(
    () =>
      normalizedSeriesQuery({
        ...validInput(),
        subject_refs: [aaplListing, aaplListing],
      }),
    /duplicate listing id/,
  );
});

test("normalizedSeriesQuery rejects non-listing SubjectRef kinds", () => {
  const issuerRef = { kind: "issuer", id: aaplListing.id } as unknown as ListingSubjectRef;
  assert.throws(
    () => normalizedSeriesQuery({ ...validInput(), subject_refs: [issuerRef] }),
    /listing SubjectRef/,
  );
});

test("normalizedSeriesQuery rejects unknown interval values", () => {
  assert.throws(
    () =>
      normalizedSeriesQuery({
        ...validInput(),
        interval: "1wk" as unknown as (typeof BAR_INTERVALS)[number],
      }),
    /interval/,
  );
});

test("normalizedSeriesQuery rejects unknown basis values", () => {
  assert.throws(
    () =>
      normalizedSeriesQuery({
        ...validInput(),
        basis: "raw" as unknown as (typeof ADJUSTMENT_BASES)[number],
      }),
    /basis/,
  );
});

test("normalizedSeriesQuery rejects unknown normalization values", () => {
  assert.throws(
    () =>
      normalizedSeriesQuery({
        ...validInput(),
        normalization:
          "log_return" as unknown as (typeof SERIES_NORMALIZATIONS)[number],
      }),
    /normalization/,
  );
});

test("normalizedSeriesQuery rejects a range whose start is not strictly before end", () => {
  assert.throws(
    () =>
      normalizedSeriesQuery({
        ...validInput(),
        range: { start: RANGE.end, end: RANGE.start },
      }),
    /start must be strictly before end/,
  );
});

test("normalizedSeriesQuery rejects a range with a non-ISO timestamp", () => {
  assert.throws(
    () =>
      normalizedSeriesQuery({
        ...validInput(),
        range: { start: "2026-01-01", end: RANGE.end },
      }),
    /range\.start/,
  );
});

test("assertSeriesQueryContract validates untrusted cross-boundary input", () => {
  assert.doesNotThrow(() => assertSeriesQueryContract(validInput()));
  assert.throws(() => assertSeriesQueryContract(null), /must be an object/);
  assert.throws(() => assertSeriesQueryContract({}), /subject_refs/);
});

test("normalizedSeriesQuery accepts every basis × normalization combination", () => {
  for (const basis of ADJUSTMENT_BASES) {
    for (const normalization of SERIES_NORMALIZATIONS) {
      const q = normalizedSeriesQuery({ ...validInput(), basis, normalization });
      assert.equal(q.basis, basis);
      assert.equal(q.normalization, normalization);
    }
  }
});

test("seriesCacheKey misses when any cache identity dimension changes", () => {
  const base = validInput();
  const baseKey = seriesCacheKey(base, FRESHNESS_BOUNDARY);
  assert.equal(seriesCacheKey({ ...base }, FRESHNESS_BOUNDARY), baseKey);

  const variants: Array<[string, NormalizedSeriesQuery, string]> = [
    [
      "subject set",
      { ...base, subject_refs: [aaplListing] },
      FRESHNESS_BOUNDARY,
    ],
    [
      "range",
      {
        ...base,
        range: {
          start: "2026-01-02T00:00:00.000Z",
          end: RANGE.end,
        },
      },
      FRESHNESS_BOUNDARY,
    ],
    ["interval", { ...base, interval: "1h" }, FRESHNESS_BOUNDARY],
    ["basis", { ...base, basis: "unadjusted" }, FRESHNESS_BOUNDARY],
    ["normalization", { ...base, normalization: "raw" }, FRESHNESS_BOUNDARY],
    ["freshness", base, "2026-04-22T15:31:00.000Z"],
  ];

  for (const [dimension, query, freshness] of variants) {
    assert.notEqual(
      seriesCacheKey(query, freshness),
      baseKey,
      `${dimension} must be part of series cache identity`,
    );
  }
});

test("seriesCacheIdentity canonicalizes subject set and timestamp spellings", () => {
  const aThenM = seriesCacheIdentity(validInput(), FRESHNESS_BOUNDARY);
  const mThenA = seriesCacheIdentity(
    {
      ...validInput(),
      subject_refs: [msftListing, aaplListing],
      range: {
        start: "2025-12-31T19:00:00.000-05:00",
        end: "2026-03-31T20:00:00.000-04:00",
      },
    },
    "2026-04-22T11:30:00.000-04:00",
  );

  assert.deepEqual(mThenA, aThenM);
  assert.equal(Object.isFrozen(aThenM), true);
  assert.equal(Object.isFrozen(aThenM.subject_refs), true);
  assert.equal(Object.isFrozen(aThenM.subject_refs[0]), true);
  assert.equal(Object.isFrozen(aThenM.range), true);
});

test("seriesCacheKey rejects malformed freshness boundaries", () => {
  assert.throws(
    () => seriesCacheKey(validInput(), "2026-04-22"),
    /freshness_boundary/,
  );
});

test("seriesCacheKey preserves sub-millisecond freshness precision", () => {
  const first = seriesCacheKey(validInput(), "2026-04-22T15:30:00.000000001Z");
  const second = seriesCacheKey(validInput(), "2026-04-22T15:30:00.000999999Z");

  assert.notEqual(first, second);
});

test("seriesTransformReuseDecision allows explicitly listed in-snapshot transforms", () => {
  const decision = reuseDecision({});

  assert.deepEqual(decision, { allowed: true });
  assert.equal(Object.isFrozen(decision), true);
});

test("seriesTransformReuseDecision rejects subject, basis, and normalization changes", () => {
  const variants: Array<[string, NormalizedSeriesQuery]> = [
    ["subject set", { ...validInput(), subject_refs: [aaplListing] }],
    ["basis", { ...validInput(), basis: "unadjusted" }],
    ["normalization", { ...validInput(), normalization: "raw" }],
  ];

  for (const [dimension, requested_query] of variants) {
    assert.deepEqual(
      reuseDecision({ requested_query }),
      { allowed: false, reason: "identity_changed" },
      `${dimension} changes must cross the snapshot boundary`,
    );
  }
});

test("seriesTransformReuseDecision rejects unlisted intervals", () => {
  assert.deepEqual(
    reuseDecision({ allowed_transforms: [allowedTransform(RANGE, "1h")] }),
    { allowed: false, reason: "interval_not_allowed" },
  );
});

test("seriesTransformReuseDecision treats allowed transforms as exact range and interval pairs", () => {
  const otherRange = {
    start: "2026-02-01T00:00:00.000Z",
    end: "2026-03-01T00:00:00.000Z",
  };

  assert.deepEqual(
    reuseDecision({
      allowed_transforms: [
        allowedTransform(RANGE, "1h"),
        allowedTransform(otherRange, "1d"),
      ],
    }),
    { allowed: false, reason: "range_not_allowed" },
  );
});

test("seriesTransformReuseDecision rejects transforms requiring fresher data than snapshot as_of", () => {
  const futureRange = {
    start: RANGE.start,
    end: "2026-04-23T00:00:00.000Z",
  };
  const requested_query = { ...validInput(), range: futureRange };

  assert.deepEqual(
    reuseDecision({
      requested_query,
      allowed_transforms: [allowedTransform(futureRange, "1d")],
      snapshot_as_of: SNAPSHOT_AS_OF,
    }),
    { allowed: false, reason: "requires_fresher_data" },
  );
});
