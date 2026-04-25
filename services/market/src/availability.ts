import { assertListingRef, freezeListingRef, type ListingSubjectRef, type UUID } from "./subject-ref.ts";
import {
  assertBoolean,
  assertIso8601Utc,
  assertOneOf,
  assertUuid,
} from "./validators.ts";

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

export type UnavailableInput = Omit<UnavailableEnvelope, "outcome">;

export function unavailable(input: UnavailableInput): UnavailableEnvelope {
  assertOneOf(input.reason, AVAILABILITY_REASONS, "unavailable.reason");
  assertUuid(input.source_id, "unavailable.source_id");
  assertIso8601Utc(input.as_of, "unavailable.as_of");
  assertBoolean(input.retryable, "unavailable.retryable");
  if (input.detail !== undefined && typeof input.detail !== "string") {
    throw new Error("unavailable.detail: must be a string when provided");
  }

  const envelope: UnavailableEnvelope = {
    outcome: "unavailable",
    reason: input.reason,
    listing: freezeListingRef(input.listing, "unavailable"),
    source_id: input.source_id,
    as_of: input.as_of,
    retryable: input.retryable,
  };
  if (input.detail !== undefined) envelope.detail = input.detail;
  return Object.freeze(envelope);
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
  assertListingRef(u.listing, "unavailable.listing");
  assertOneOf(u.reason, AVAILABILITY_REASONS, "unavailable.reason");
  assertUuid(u.source_id, "unavailable.source_id");
  assertIso8601Utc(u.as_of, "unavailable.as_of");
  assertBoolean(u.retryable, "unavailable.retryable");
  if (u.detail !== undefined && typeof u.detail !== "string") {
    throw new Error("unavailable.detail: must be a string when present");
  }
}
