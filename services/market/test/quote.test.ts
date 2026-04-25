import test from "node:test";
import assert from "node:assert/strict";
import {
  assertQuoteContract,
  DELAY_CLASSES,
  normalizedQuote,
  quoteMove,
  SESSION_STATES,
  type NormalizedQuote,
} from "../src/quote.ts";
import type { ListingSubjectRef } from "../src/subject-ref.ts";
import { aaplListing, POLYGON_SOURCE_ID as SOURCE_ID } from "./fixtures.ts";

const AS_OF = "2026-04-22T15:30:00.000Z";

function validInput() {
  return {
    listing: aaplListing,
    price: 187.42,
    prev_close: 185.0,
    session_state: "regular" as const,
    as_of: AS_OF,
    delay_class: "real_time" as const,
    currency: "USD",
    source_id: SOURCE_ID,
  };
}

test("quoteMove derives absolute and percentage move from price and prev_close", () => {
  const q = normalizedQuote(validInput());
  const move = quoteMove(q);
  assert.ok(Math.abs(move.change_abs - 2.42) < 1e-9);
  assert.ok(Math.abs(move.change_pct - (2.42 / 185.0)) < 1e-12);
});

test("normalizedQuote carries required absolute and percentage move fields", () => {
  const q = normalizedQuote(validInput());

  assert.ok(Math.abs(q.change_abs - 2.42) < 1e-9);
  assert.ok(Math.abs(q.change_pct - (2.42 / 185.0)) < 1e-12);
});

test("normalizedQuote returns a frozen object so adapters can't post-hoc mutate", () => {
  const q = normalizedQuote(validInput());
  assert.equal(Object.isFrozen(q), true);
});

test("normalizedQuote clones and freezes the nested listing ref", () => {
  const input = validInput();
  const q = normalizedQuote(input);

  assert.notEqual(q.listing, input.listing);
  assert.equal(Object.isFrozen(q.listing), true);
});

test("normalizedQuote rejects non-listing SubjectRef kinds (issuer, instrument)", () => {
  const issuerRef = { kind: "issuer", id: aaplListing.id } as unknown as ListingSubjectRef;
  assert.throws(
    () => normalizedQuote({ ...validInput(), listing: issuerRef }),
    /listing must be a listing SubjectRef/,
  );
});

test("normalizedQuote rejects non-positive price and prev_close", () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => normalizedQuote({ ...validInput(), price: bad }),
      /price.*finite positive/,
      `expected price=${bad} to be rejected`,
    );
    assert.throws(
      () => normalizedQuote({ ...validInput(), prev_close: bad }),
      /prev_close.*finite positive/,
      `expected prev_close=${bad} to be rejected`,
    );
  }
});

test("normalizedQuote rejects ISO-8601 strings without an explicit Z or offset", () => {
  assert.throws(
    () => normalizedQuote({ ...validInput(), as_of: "2026-04-22T15:30:00" }),
    /ISO-8601 timestamp with explicit Z or offset/,
  );
});

test("normalizedQuote accepts ISO-8601 with explicit positive/negative offsets", () => {
  const east = normalizedQuote({ ...validInput(), as_of: "2026-04-22T15:30:00+09:00" });
  const west = normalizedQuote({ ...validInput(), as_of: "2026-04-22T15:30:00-05:00" });
  assert.equal(east.as_of, "2026-04-22T15:30:00+09:00");
  assert.equal(west.as_of, "2026-04-22T15:30:00-05:00");
});

test("normalizedQuote rejects invalid currency codes (not exactly 3 uppercase letters)", () => {
  for (const bad of ["usd", "us", "USDA", "US$", "", "12345"]) {
    assert.throws(
      () => normalizedQuote({ ...validInput(), currency: bad }),
      /currency.*ISO 4217/,
      `expected currency=${JSON.stringify(bad)} to be rejected`,
    );
  }
});

test("normalizedQuote rejects non-UUID source_id (and non-v4 UUIDs)", () => {
  for (const bad of [
    "not-a-uuid",
    "11111111-1111-1111-1111-111111111111", // version digit is 1, not 4
    "11111111-1111-4111-c111-111111111111", // variant digit is c, not 8/9/a/b
    "",
  ]) {
    assert.throws(
      () => normalizedQuote({ ...validInput(), source_id: bad }),
      /source_id.*UUID v4/,
      `expected source_id=${JSON.stringify(bad)} to be rejected`,
    );
  }
});

test("normalizedQuote rejects unknown delay_class and session_state values", () => {
  assert.throws(
    () =>
      normalizedQuote({
        ...validInput(),
        delay_class: "delayed_5m" as unknown as (typeof DELAY_CLASSES)[number],
      }),
    /delay_class/,
  );
  assert.throws(
    () =>
      normalizedQuote({
        ...validInput(),
        session_state: "halt" as unknown as (typeof SESSION_STATES)[number],
      }),
    /session_state/,
  );
});

test("assertQuoteContract accepts a quote built via the smart constructor", () => {
  const q: NormalizedQuote = normalizedQuote(validInput());
  assert.doesNotThrow(() => assertQuoteContract(q));
});

test("assertQuoteContract rejects a quote missing required metadata fields", () => {
  for (const drop of ["as_of", "delay_class", "currency", "source_id", "change_abs", "change_pct"] as const) {
    const q = normalizedQuote(validInput()) as NormalizedQuote;
    const tampered: Record<string, unknown> = { ...q };
    delete tampered[drop];
    assert.throws(
      () => assertQuoteContract(tampered),
      undefined,
      `expected missing ${drop} to be rejected`,
    );
  }
});

test("assertQuoteContract rejects a quote whose listing is not kind=listing", () => {
  const q = normalizedQuote(validInput()) as NormalizedQuote;
  const tampered = { ...q, listing: { kind: "issuer", id: q.listing.id } };
  assert.throws(() => assertQuoteContract(tampered), /listing/);
});

test("assertQuoteContract rejects quote move fields that disagree with price and prev_close", () => {
  const q = normalizedQuote(validInput());

  assert.throws(() => assertQuoteContract({ ...q, change_abs: 999 }), /change_abs/);
  assert.throws(() => assertQuoteContract({ ...q, change_pct: 999 }), /change_pct/);
});
