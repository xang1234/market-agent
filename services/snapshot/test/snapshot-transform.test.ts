import assert from "node:assert/strict";
import test from "node:test";

import {
  checkSnapshotTransform,
  snapshotTransformBoundaryResponse,
} from "../src/snapshot-transform.ts";
import type { SnapshotSubjectRef } from "../src/manifest-staging.ts";

const listingId = "00000000-0000-4000-8000-000000000001";
const subject_refs: ReadonlyArray<SnapshotSubjectRef> = Object.freeze([
  Object.freeze({ kind: "listing", id: listingId }),
]);
const allowedRange = Object.freeze({
  start: "2026-04-01T00:00:00.000Z",
  end: "2026-04-29T00:00:00.000Z",
});

test("checkSnapshotTransform allows listed range transforms within snapshot as_of", () => {
  assert.deepEqual(
    checkSnapshotTransform({
      manifest: sealedManifest(),
      request: {
        kind: "series",
        subject_refs,
        range: allowedRange,
        interval: "1d",
        basis: "split_adjusted",
        normalization: "raw",
      },
    }),
    { allowed: true, status: 200 },
  );
});

test("checkSnapshotTransform denies basis changes at the snapshot boundary", () => {
  assert.deepEqual(
    checkSnapshotTransform({
      manifest: sealedManifest(),
      request: {
        kind: "series",
        subject_refs,
        range: allowedRange,
        interval: "1d",
        basis: "unadjusted",
        normalization: "raw",
      },
    }),
    { allowed: false, status: 409, reason: "basis_change" },
  );
});

test("checkSnapshotTransform denies normalization and subject-set changes", () => {
  assert.deepEqual(
    checkSnapshotTransform({
      manifest: sealedManifest(),
      request: validRequest({ normalization: "pct_return" }),
    }),
    { allowed: false, status: 409, reason: "normalization_change" },
  );

  assert.deepEqual(
    checkSnapshotTransform({
      manifest: sealedManifest(),
      request: validRequest({
        subject_refs: [{ kind: "listing", id: "00000000-0000-4000-8000-000000000002" }],
      }),
    }),
    { allowed: false, status: 409, reason: "subject_set_change" },
  );
});

test("snapshotTransformBoundaryResponse returns refresh_required peer_set envelope for subject changes", () => {
  assert.deepEqual(
    snapshotTransformBoundaryResponse({
      manifest: sealedManifest(),
      request: validRequest({
        subject_refs: [{ kind: "listing", id: "00000000-0000-4000-8000-000000000002" }],
      }),
    }),
    {
      allowed: false,
      status: 409,
      body: {
        error: "refresh_required",
        refresh_required: { reason: "peer_set" },
      },
    },
  );
});

test("snapshotTransformBoundaryResponse maps refresh boundary dimensions into 409 envelopes", () => {
  const cases = [
    ["basis", validRequest({ basis: "unadjusted" })],
    ["normalization", validRequest({ normalization: "pct_return" })],
    [
      "freshness",
      validRequest({
        range: {
          start: "2026-04-01T00:00:00.000Z",
          end: "2026-04-30T00:00:00.000Z",
        },
      }),
    ],
    [
      "transform",
      validRequest({
        range: {
          start: "2026-04-02T00:00:00.000Z",
          end: "2026-04-29T00:00:00.000Z",
        },
      }),
    ],
  ] as const;

  for (const [reason, request] of cases) {
    assert.deepEqual(
      snapshotTransformBoundaryResponse({
        manifest: sealedManifest({
          allowed_transforms: {
            series: [
              {
                range: {
                  start: "2026-04-01T00:00:00.000Z",
                  end: "2026-04-30T00:00:00.000Z",
                },
                interval: "1d",
              },
            ],
          },
        }),
        request,
      }),
      {
        allowed: false,
        status: 409,
        body: {
          error: "refresh_required",
          refresh_required: { reason },
        },
      },
    );
  }
});

test("snapshotTransformBoundaryResponse passes through allowed transforms without an error body", () => {
  assert.deepEqual(
    snapshotTransformBoundaryResponse({
      manifest: sealedManifest(),
      request: validRequest(),
    }),
    { allowed: true, status: 200 },
  );
});

test("checkSnapshotTransform denies transforms requiring fresher data", () => {
  assert.deepEqual(
    checkSnapshotTransform({
      manifest: sealedManifest({
        allowed_transforms: {
          series: [
            {
              range: {
                start: "2026-04-01T00:00:00.000Z",
                end: "2026-04-30T00:00:00.000Z",
              },
              interval: "1d",
            },
          ],
        },
      }),
      request: validRequest({
        range: {
          start: "2026-04-01T00:00:00.000Z",
          end: "2026-04-30T00:00:00.000Z",
        },
      }),
    }),
    { allowed: false, status: 409, reason: "requires_fresher_data" },
  );
});

test("checkSnapshotTransform requires exact allowed range and interval matches", () => {
  assert.deepEqual(
    checkSnapshotTransform({
      manifest: sealedManifest(),
      request: validRequest({
        range: {
          start: "2026-04-02T00:00:00.000Z",
          end: "2026-04-29T00:00:00.000Z",
        },
      }),
    }),
    { allowed: false, status: 409, reason: "transform_not_allowed" },
  );

  assert.deepEqual(
    checkSnapshotTransform({
      manifest: sealedManifest(),
      request: validRequest({ interval: "1h" }),
    }),
    { allowed: false, status: 409, reason: "transform_not_allowed" },
  );
});

test("checkSnapshotTransform canonicalizes equivalent timestamp offsets", () => {
  assert.deepEqual(
    checkSnapshotTransform({
      manifest: sealedManifest(),
      request: validRequest({
        range: {
          start: "2026-04-01T08:00:00+08:00",
          end: "2026-04-29T08:00:00+08:00",
        },
      }),
    }),
    { allowed: true, status: 200 },
  );
});

test("checkSnapshotTransform rejects malformed transform contracts", () => {
  assert.throws(
    () =>
      checkSnapshotTransform({
        manifest: sealedManifest({
          allowed_transforms: {
            series: [{ range: { start: allowedRange.end, end: allowedRange.start }, interval: "1d" }],
          },
        }),
        request: validRequest(),
      }),
    /start must be <= end/,
  );

  assert.throws(
    () =>
      checkSnapshotTransform({
        manifest: sealedManifest({
          allowed_transforms: {
            series: [{ range: allowedRange }],
          },
        }),
        request: validRequest(),
      }),
    /interval/,
  );

  assert.throws(
    () =>
      checkSnapshotTransform({
        manifest: sealedManifest(),
        request: validRequest({ range: { start: "2026-04-01", end: allowedRange.end } }),
      }),
    /explicit Z or offset/,
  );

  assert.throws(
    () =>
      checkSnapshotTransform({
        manifest: sealedManifest({ allowed_transforms: { series: {} } }),
        request: validRequest(),
      }),
    /allowed_transforms\.series: must be an array/,
  );

  assert.throws(
    () =>
      checkSnapshotTransform({
        manifest: sealedManifest({ allowed_transforms: [] }),
        request: validRequest({ basis: "unadjusted" }),
      }),
    /allowed_transforms: must be an object/,
  );

  assert.throws(
    () =>
      checkSnapshotTransform({
        manifest: sealedManifest({ allowed_transforms: null }),
        request: validRequest(),
      }),
    /allowed_transforms: must be an object/,
  );

  assert.throws(
    () =>
      checkSnapshotTransform({
        manifest: sealedManifest({
          allowed_transforms: {
            ranges: [{ start: allowedRange.start, end: allowedRange.end, interval: "1d" }],
          },
        }),
        request: validRequest(),
      }),
    /allowed_transforms\.ranges\[0\]\.range: must be an object/,
  );
});

test("checkSnapshotTransform canonicalizes pre-epoch fractional timestamps", () => {
  const preEpochRange = {
    start: "1969-12-31T23:59:59.500000000Z",
    end: "1969-12-31T23:59:59.999999999Z",
  };

  assert.deepEqual(
    checkSnapshotTransform({
      manifest: sealedManifest({
        as_of: "1969-12-31T23:59:59.999999999Z",
        allowed_transforms: {
          series: [{ range: preEpochRange, interval: "1d" }],
        },
      }),
      request: validRequest({ range: preEpochRange }),
    }),
    { allowed: true, status: 200 },
  );
});

test("checkSnapshotTransform preserves sub-millisecond freshness and range precision", () => {
  assert.deepEqual(
    checkSnapshotTransform({
      manifest: sealedManifest({
        as_of: "2026-04-29T00:00:00.123000000Z",
        allowed_transforms: {
          series: [
            {
              range: {
                start: "2026-04-01T00:00:00.000000000Z",
                end: "2026-04-29T00:00:00.123000001Z",
              },
              interval: "1d",
            },
          ],
        },
      }),
      request: validRequest({
        range: {
          start: "2026-04-01T00:00:00.000000000Z",
          end: "2026-04-29T00:00:00.123000001Z",
        },
      }),
    }),
    { allowed: false, status: 409, reason: "requires_fresher_data" },
  );

  assert.deepEqual(
    checkSnapshotTransform({
      manifest: sealedManifest({
        as_of: "2026-04-29T00:00:00.123999999Z",
        allowed_transforms: {
          series: [
            {
              range: {
                start: "2026-04-01T00:00:00.000000000Z",
                end: "2026-04-29T00:00:00.123000001Z",
              },
              interval: "1d",
            },
          ],
        },
      }),
      request: validRequest({
        range: {
          start: "2026-04-01T00:00:00.000000000Z",
          end: "2026-04-29T00:00:00.123999999Z",
        },
      }),
    }),
    { allowed: false, status: 409, reason: "transform_not_allowed" },
  );
});

function validRequest(overrides: Partial<Parameters<typeof checkSnapshotTransform>[0]["request"]> = {}) {
  return {
    kind: "series" as const,
    subject_refs,
    range: allowedRange,
    interval: "1d",
    basis: "split_adjusted" as const,
    normalization: "raw" as const,
    ...overrides,
  };
}

function sealedManifest(
  overrides: Partial<Parameters<typeof checkSnapshotTransform>[0]["manifest"]> = {},
) {
  return Object.freeze({
    subject_refs,
    as_of: "2026-04-29T00:00:00.000Z",
    basis: "split_adjusted",
    normalization: "raw",
    allowed_transforms: Object.freeze({
      series: Object.freeze([
        Object.freeze({
          range: allowedRange,
          interval: "1d",
        }),
      ]),
    }),
    ...overrides,
  });
}
