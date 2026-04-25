import test from "node:test";
import assert from "node:assert/strict";
import {
  AVAILABILITY_REASONS,
  assertUnavailableContract,
  available,
  isAvailable,
  isUnavailable,
  type MarketDataOutcome,
  unavailable,
  type UnavailableEnvelope,
} from "../src/availability.ts";
import { aaplListing, POLYGON_SOURCE_ID } from "./fixtures.ts";

const AS_OF = "2026-04-22T15:30:00.000Z";

function validUnavailable(): Parameters<typeof unavailable>[0] {
  return {
    reason: "provider_error",
    listing: aaplListing,
    source_id: POLYGON_SOURCE_ID,
    as_of: AS_OF,
    retryable: true,
    detail: "polygon: 503 Service Unavailable",
  };
}

test("available envelope wraps data and is frozen", () => {
  const env = available({ value: 42 });
  assert.equal(env.outcome, "available");
  assert.deepEqual(env.data, { value: 42 });
  assert.equal(Object.isFrozen(env), true);
});

test("unavailable envelope copies the listing ref and freezes the result", () => {
  const env = unavailable(validUnavailable());
  assert.equal(env.outcome, "unavailable");
  assert.equal(env.reason, "provider_error");
  assert.equal(env.listing.id, aaplListing.id);
  assert.notEqual(env.listing, aaplListing, "listing must be a defensive copy");
  assert.equal(Object.isFrozen(env), true);
  assert.equal(Object.isFrozen(env.listing), true);
});

test("unavailable envelope omits detail when not provided", () => {
  const { detail: _detail, ...rest } = validUnavailable();
  const env = unavailable(rest);
  assert.equal("detail" in env, false);
});

test("unavailable rejects non-listing SubjectRefs", () => {
  const issuerRef = { kind: "issuer", id: aaplListing.id } as unknown as typeof aaplListing;
  assert.throws(
    () => unavailable({ ...validUnavailable(), listing: issuerRef }),
    /listing must be a listing SubjectRef/,
  );
});

test("unavailable rejects unknown reasons", () => {
  assert.throws(
    () =>
      unavailable({
        ...validUnavailable(),
        reason: "timeout" as unknown as (typeof AVAILABILITY_REASONS)[number],
      }),
    /reason/,
  );
});

test("unavailable rejects non-UUID source_id and naive timestamps", () => {
  assert.throws(
    () => unavailable({ ...validUnavailable(), source_id: "not-a-uuid" }),
    /source_id/,
  );
  assert.throws(
    () => unavailable({ ...validUnavailable(), as_of: "2026-04-22T15:30:00" }),
    /as_of/,
  );
});

test("unavailable rejects non-boolean retryable", () => {
  assert.throws(
    () =>
      unavailable({
        ...validUnavailable(),
        retryable: "true" as unknown as boolean,
      }),
    /retryable/,
  );
});

test("isAvailable / isUnavailable type guards discriminate exclusively", () => {
  const ok: MarketDataOutcome<number> = available(7);
  const fail: MarketDataOutcome<number> = unavailable(validUnavailable());
  assert.equal(isAvailable(ok), true);
  assert.equal(isUnavailable(ok), false);
  assert.equal(isAvailable(fail), false);
  assert.equal(isUnavailable(fail), true);
});

test("assertUnavailableContract accepts a smart-constructor envelope", () => {
  const env = unavailable(validUnavailable());
  assert.doesNotThrow(() => assertUnavailableContract(env));
});

test("assertUnavailableContract rejects envelopes missing required fields", () => {
  for (const drop of ["reason", "listing", "source_id", "as_of", "retryable"] as const) {
    const env = unavailable(validUnavailable());
    const tampered: Record<string, unknown> = { ...env };
    delete tampered[drop];
    assert.throws(
      () => assertUnavailableContract(tampered),
      undefined,
      `expected missing ${drop} to be rejected`,
    );
  }
});

test("assertUnavailableContract rejects an envelope whose listing is not kind=listing", () => {
  const env = unavailable(validUnavailable()) as UnavailableEnvelope;
  const tampered = { ...env, listing: { kind: "issuer", id: env.listing.id } };
  assert.throws(() => assertUnavailableContract(tampered), /listing/);
});

test("every AvailabilityReason value is accepted by the smart constructor", () => {
  for (const reason of AVAILABILITY_REASONS) {
    const env = unavailable({ ...validUnavailable(), reason });
    assert.equal(env.reason, reason);
  }
});
