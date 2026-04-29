import type {
  JsonValue,
  SnapshotBasis,
  SnapshotNormalization,
  SnapshotSubjectRef,
} from "./manifest-staging.ts";
import {
  SNAPSHOT_BASES,
  SNAPSHOT_NORMALIZATIONS,
  SNAPSHOT_SUBJECT_KINDS,
} from "./manifest-staging.ts";

export type SnapshotTransformManifest = {
  subject_refs: ReadonlyArray<SnapshotSubjectRef>;
  as_of: string;
  basis: SnapshotBasis;
  normalization: SnapshotNormalization;
  allowed_transforms: JsonValue;
};

export type SnapshotSeriesTransformRequest = {
  kind: "series";
  subject_refs: ReadonlyArray<SnapshotSubjectRef>;
  range: SnapshotTransformRange;
  interval: string;
  basis: SnapshotBasis;
  normalization: SnapshotNormalization;
};

export type SnapshotTransformRange = {
  start: string;
  end: string;
};

export type SnapshotTransformRequest = SnapshotSeriesTransformRequest;

export type SnapshotTransformRejectionReason =
  | "basis_change"
  | "normalization_change"
  | "subject_set_change"
  | "requires_fresher_data"
  | "transform_not_allowed";

export type SnapshotRefreshRequiredReason =
  | "basis"
  | "normalization"
  | "peer_set"
  | "freshness"
  | "transform";

export type SnapshotRefreshRequiredEnvelope = {
  error: "refresh_required";
  refresh_required: {
    reason: SnapshotRefreshRequiredReason;
  };
};

export type SnapshotTransformDecision =
  | { allowed: true; status: 200 }
  | { allowed: false; status: 409; reason: SnapshotTransformRejectionReason };

export type SnapshotTransformBoundaryResponse =
  | { allowed: true; status: 200 }
  | { allowed: false; status: 409; body: SnapshotRefreshRequiredEnvelope };

export type CheckSnapshotTransformInput = {
  manifest: SnapshotTransformManifest;
  request: SnapshotTransformRequest;
};

type NormalizedSnapshotTransformManifest = Omit<SnapshotTransformManifest, "allowed_transforms"> & {
  allowed_transforms: ReadonlyArray<AllowedSeriesTransform>;
};

type AllowedSeriesTransform = {
  range: SnapshotTransformRange;
  interval: string;
};

const ISO_8601_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/;

export function checkSnapshotTransform(
  input: CheckSnapshotTransformInput,
): SnapshotTransformDecision {
  const manifest = normalizeManifest(input.manifest);
  const request = normalizeRequest(input.request);

  if (request.basis !== manifest.basis) {
    return deny("basis_change");
  }
  if (request.normalization !== manifest.normalization) {
    return deny("normalization_change");
  }
  if (!sameSubjectSet(request.subject_refs, manifest.subject_refs)) {
    return deny("subject_set_change");
  }
  if (compareCanonicalTimestamps(request.range.end, manifest.as_of) > 0) {
    return deny("requires_fresher_data");
  }
  if (!manifest.allowed_transforms.some((transform) => {
    return (
      transform.range.start === request.range.start &&
      transform.range.end === request.range.end &&
      transform.interval === request.interval
    );
  })) {
    return deny("transform_not_allowed");
  }

  return Object.freeze({ allowed: true, status: 200 });
}

export function snapshotTransformBoundaryResponse(
  input: CheckSnapshotTransformInput,
): SnapshotTransformBoundaryResponse {
  const decision = checkSnapshotTransform(input);
  if (decision.allowed) return decision;
  return Object.freeze({
    allowed: false,
    status: 409,
    body: Object.freeze({
      error: "refresh_required",
      refresh_required: Object.freeze({
        reason: refreshRequiredReason(decision.reason),
      }),
    }),
  });
}

export function normalizeSnapshotTransformRequest(
  request: SnapshotTransformRequest,
): SnapshotTransformRequest {
  return normalizeRequest(request);
}

function normalizeManifest(manifest: SnapshotTransformManifest): NormalizedSnapshotTransformManifest {
  if (manifest === null || typeof manifest !== "object") {
    throw new Error("checkSnapshotTransform.manifest: must be an object");
  }
  return Object.freeze({
    subject_refs: freezeSubjectRefs(
      manifest.subject_refs,
      "checkSnapshotTransform.manifest.subject_refs",
    ),
    as_of: canonicalTimestamp(manifest.as_of, "checkSnapshotTransform.manifest.as_of"),
    basis: assertOneOf(
      manifest.basis,
      SNAPSHOT_BASES,
      "checkSnapshotTransform.manifest.basis",
    ),
    normalization: assertOneOf(
      manifest.normalization,
      SNAPSHOT_NORMALIZATIONS,
      "checkSnapshotTransform.manifest.normalization",
    ),
    allowed_transforms: allowedSeriesTransforms(manifest.allowed_transforms),
  });
}

function normalizeRequest(request: SnapshotTransformRequest): SnapshotTransformRequest {
  if (request === null || typeof request !== "object") {
    throw new Error("checkSnapshotTransform.request: must be an object");
  }
  if (request.kind !== "series") {
    throw new Error("checkSnapshotTransform.request.kind: must be series");
  }
  return Object.freeze({
    kind: "series",
    subject_refs: freezeSubjectRefs(
      request.subject_refs,
      "checkSnapshotTransform.request.subject_refs",
    ),
    range: freezeRange(request.range, "checkSnapshotTransform.request.range"),
    interval: assertNonEmptyString(
      request.interval,
      "checkSnapshotTransform.request.interval",
    ),
    basis: assertOneOf(
      request.basis,
      SNAPSHOT_BASES,
      "checkSnapshotTransform.request.basis",
    ),
    normalization: assertOneOf(
      request.normalization,
      SNAPSHOT_NORMALIZATIONS,
      "checkSnapshotTransform.request.normalization",
    ),
  });
}

function allowedSeriesTransforms(value: JsonValue): ReadonlyArray<AllowedSeriesTransform> {
  if (!isRecord(value)) {
    throw new Error("checkSnapshotTransform.allowed_transforms: must be an object");
  }
  const record = value as Record<string, unknown>;
  const transforms: AllowedSeriesTransform[] = [];

  if (record.series !== undefined && !Array.isArray(record.series)) {
    throw new Error("checkSnapshotTransform.allowed_transforms.series: must be an array");
  }

  if (Array.isArray(record.series)) {
    record.series.forEach((item, index) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`checkSnapshotTransform.allowed_transforms.series[${index}]: must be an object`);
      }
      const transform = item as Record<string, unknown>;
      transforms.push(Object.freeze({
        range: freezeRange(
          transform.range,
          `checkSnapshotTransform.allowed_transforms.series[${index}].range`,
        ),
        interval: assertNonEmptyString(
          transform.interval,
          `checkSnapshotTransform.allowed_transforms.series[${index}].interval`,
        ),
      }));
    });
  }

  if (record.ranges !== undefined && !Array.isArray(record.ranges)) {
    throw new Error("checkSnapshotTransform.allowed_transforms.ranges: must be an array");
  }

  if (Array.isArray(record.ranges)) {
    record.ranges.forEach((item, index) => {
      if (!isRecord(item)) {
        throw new Error(`checkSnapshotTransform.allowed_transforms.ranges[${index}]: must be an object`);
      }
      transforms.push(Object.freeze({
        range: freezeRange(
          item.range,
          `checkSnapshotTransform.allowed_transforms.ranges[${index}].range`,
        ),
        interval: assertNonEmptyString(
          item.interval,
          `checkSnapshotTransform.allowed_transforms.ranges[${index}].interval`,
        ),
      }));
    });
  }

  return Object.freeze(transforms);
}

function freezeSubjectRefs(
  value: ReadonlyArray<SnapshotSubjectRef>,
  label: string,
): ReadonlyArray<SnapshotSubjectRef> {
  if (!Array.isArray(value)) {
    throw new Error(`${label}: must be an array`);
  }
  return Object.freeze(
    value.map((subject, index) => {
      if (subject === null || typeof subject !== "object") {
        throw new Error(`${label}[${index}]: must be an object`);
      }
      return Object.freeze({
        kind: assertOneOf(subject.kind, SNAPSHOT_SUBJECT_KINDS, `${label}[${index}].kind`),
        id: assertNonEmptyString(subject.id, `${label}[${index}].id`),
      });
    }),
  );
}

function freezeRange(value: unknown, label: string): SnapshotTransformRange {
  if (!isRecord(value)) {
    throw new Error(`${label}: must be an object`);
  }
  const start = canonicalTimestamp(value.start, `${label}.start`);
  const end = canonicalTimestamp(value.end, `${label}.end`);
  if (compareCanonicalTimestamps(start, end) > 0) {
    throw new Error(`${label}: start must be <= end`);
  }
  return Object.freeze({ start, end });
}

function sameSubjectSet(
  left: ReadonlyArray<SnapshotSubjectRef>,
  right: ReadonlyArray<SnapshotSubjectRef>,
): boolean {
  if (left.length !== right.length) return false;
  const leftKeys = left.map(subjectRefKey).sort();
  const rightKeys = right.map(subjectRefKey).sort();
  return leftKeys.every((key, index) => key === rightKeys[index]);
}

function subjectRefKey(subject: SnapshotSubjectRef): string {
  return `${subject.kind}:${subject.id}`;
}

function canonicalTimestamp(value: unknown, label: string): string {
  const parts = timestampParts(value, label);
  const { epochSeconds, nanoseconds } = splitEpochNanoseconds(parts.epochNanoseconds);
  const secondDate = new Date(Number(epochSeconds) * 1000);
  const datePart = secondDate.toISOString().slice(0, 19);
  const nanosecondPart = nanoseconds.toString().padStart(9, "0");
  return `${datePart}.${nanosecondPart}Z`;
}

function compareCanonicalTimestamps(left: string, right: string): number {
  const leftNs = timestampParts(left, "left").epochNanoseconds;
  const rightNs = timestampParts(right, "right").epochNanoseconds;
  if (leftNs < rightNs) return -1;
  if (leftNs > rightNs) return 1;
  return 0;
}

function timestampParts(value: unknown, label: string): { epochNanoseconds: bigint } {
  if (typeof value !== "string") {
    throw new Error(`${label}: must be an ISO-8601 timestamp with explicit Z or offset`);
  }
  const match = ISO_8601_WITH_OFFSET.exec(value);
  if (!match || !isValidTimestampMatch(match)) {
    throw new Error(`${label}: must be an ISO-8601 timestamp with explicit Z or offset`);
  }
  const [, year, month, day, hour, minute, second, fraction, zone, offsetSign, offsetHour, offsetMinute] = match;
  const utcSecondMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  ) - offsetMinutes(zone, offsetSign, offsetHour, offsetMinute) * 60_000;
  if (!Number.isFinite(utcSecondMs)) {
    throw new Error(`${label}: must be an ISO-8601 timestamp with explicit Z or offset`);
  }
  const fractionNanoseconds = BigInt((fraction ?? ".0").slice(1).padEnd(9, "0"));
  return Object.freeze({
    epochNanoseconds: BigInt(utcSecondMs) * 1_000_000n + fractionNanoseconds,
  });
}

function splitEpochNanoseconds(epochNanoseconds: bigint): {
  epochSeconds: bigint;
  nanoseconds: bigint;
} {
  let epochSeconds = epochNanoseconds / 1_000_000_000n;
  let nanoseconds = epochNanoseconds % 1_000_000_000n;
  if (nanoseconds < 0n) {
    epochSeconds -= 1n;
    nanoseconds += 1_000_000_000n;
  }
  return { epochSeconds, nanoseconds };
}

function isValidTimestampMatch(match: RegExpExecArray): boolean {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHourText = match[10];
  const offsetMinuteText = match[11];

  if (
    !isValidDate(year, month, day) ||
    !isInRange(hour, 0, 23) ||
    !isInRange(minute, 0, 59) ||
    !isInRange(second, 0, 59)
  ) {
    return false;
  }
  if (offsetHourText === undefined || offsetMinuteText === undefined) return true;
  return (
    isInRange(Number(offsetHourText), 0, 23) &&
    isInRange(Number(offsetMinuteText), 0, 59)
  );
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !isInRange(month, 1, 12)) return false;
  return isInRange(day, 1, daysInMonth(year, month));
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function offsetMinutes(
  zone: string,
  sign: string | undefined,
  hour: string | undefined,
  minute: string | undefined,
): number {
  if (zone === "Z") return 0;
  const direction = sign === "+" ? 1 : -1;
  return direction * (Number(hour) * 60 + Number(minute));
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label}: must be a non-empty string`);
  }
  return value;
}

function assertOneOf<T extends string>(
  value: unknown,
  allowed: ReadonlyArray<T>,
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label}: must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deny(reason: SnapshotTransformRejectionReason): SnapshotTransformDecision {
  return Object.freeze({ allowed: false, status: 409, reason });
}

function refreshRequiredReason(
  reason: SnapshotTransformRejectionReason,
): SnapshotRefreshRequiredReason {
  switch (reason) {
    case "basis_change":
      return "basis";
    case "normalization_change":
      return "normalization";
    case "subject_set_change":
      return "peer_set";
    case "requires_fresher_data":
      return "freshness";
    case "transform_not_allowed":
      return "transform";
  }
  const _exhaustive: never = reason;
  throw new Error(`unsupported snapshot transform rejection reason: ${_exhaustive}`);
}
