import type { ListingSubjectRef, UUID } from "./subject-ref.ts";
import { assertIso8601Utc, assertOneOf, assertUuid } from "./validators.ts";

// Per spec §6.2.1: provider failures, stale data, and missing coverage must
// surface as normalized availability outcomes. Adapters never let raw provider
// error payloads cross the seam.
export type AvailabilityReason =
  | "provider_error"
  | "missing_coverage"
  | "rate_limited"
  | "stale_data";

export const AVAILABILITY_REASONS: ReadonlyArray<AvailabilityReason> = [
  "provider_error",
  "missing_coverage",
  "rate_limited",
  "stale_data",
];

export type AvailableEnvelope<T> = {
  outcome: "available";
  data: T;
};

export type UnavailableEnvelope = {
  outcome: "unavailable";
  reason: AvailabilityReason;
  listing: ListingSubjectRef;
  source_id: UUID;
  as_of: string;
  retryable: boolean;
  detail?: string;
};

export type MarketDataOutcome<T> = AvailableEnvelope<T> | UnavailableEnvelope;

export function isAvailable<T>(
  outcome: MarketDataOutcome<T>,
): outcome is AvailableEnvelope<T> {
  return outcome.outcome === "available";
}

export function isUnavailable<T>(
  outcome: MarketDataOutcome<T>,
): outcome is UnavailableEnvelope {
  return outcome.outcome === "unavailable";
}

export function available<T>(data: T): AvailableEnvelope<T> {
  return Object.freeze({ outcome: "available", data });
}

export type UnavailableInput = {
  reason: AvailabilityReason;
  listing: ListingSubjectRef;
  source_id: UUID;
  as_of: string;
  retryable: boolean;
  detail?: string;
};

export function unavailable(input: UnavailableInput): UnavailableEnvelope {
  if (input.listing?.kind !== "listing") {
    throw new Error("unavailable: listing must be a listing SubjectRef");
  }
  assertOneOf(input.reason, AVAILABILITY_REASONS, "unavailable.reason");
  assertUuid(input.source_id, "unavailable.source_id");
  assertIso8601Utc(input.as_of, "unavailable.as_of");
  if (typeof input.retryable !== "boolean") {
    throw new Error("unavailable.retryable: must be a boolean");
  }
  if (input.detail !== undefined && typeof input.detail !== "string") {
    throw new Error("unavailable.detail: must be a string when provided");
  }

  return Object.freeze({
    outcome: "unavailable",
    reason: input.reason,
    listing: Object.freeze({
      kind: input.listing.kind,
      id: input.listing.id,
    }),
    source_id: input.source_id,
    as_of: input.as_of,
    retryable: input.retryable,
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
  });
}

export function assertUnavailableContract(
  value: unknown,
): asserts value is UnavailableEnvelope {
  if (value === null || typeof value !== "object") {
    throw new Error("unavailable: must be an object");
  }
  const u = value as Record<string, unknown>;
  if (u.outcome !== "unavailable") {
    throw new Error(`unavailable.outcome: expected "unavailable"; received ${String(u.outcome)}`);
  }
  if (
    !u.listing ||
    typeof u.listing !== "object" ||
    (u.listing as { kind?: unknown }).kind !== "listing" ||
    typeof (u.listing as { id?: unknown }).id !== "string"
  ) {
    throw new Error("unavailable.listing: must be a listing SubjectRef with string id");
  }
  assertOneOf(u.reason, AVAILABILITY_REASONS, "unavailable.reason");
  assertUuid(u.source_id, "unavailable.source_id");
  assertIso8601Utc(u.as_of, "unavailable.as_of");
  if (typeof u.retryable !== "boolean") {
    throw new Error("unavailable.retryable: must be a boolean");
  }
  if (u.detail !== undefined && typeof u.detail !== "string") {
    throw new Error("unavailable.detail: must be a string when present");
  }
}
