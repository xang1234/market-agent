import test from "node:test";
import assert from "node:assert/strict";
import {
  assertHoldingSubjectRef,
  assertPortfolioHoldingCreateInput,
  HOLDING_SUBJECT_KINDS,
  isHoldingSubjectKind,
} from "../src/holdings.ts";

const VALID_INSTRUMENT_ID = "11111111-1111-4111-a111-111111111111";

test("HOLDING_SUBJECT_KINDS is exactly instrument and listing", () => {
  assert.deepEqual([...HOLDING_SUBJECT_KINDS], ["instrument", "listing"]);
});

test("isHoldingSubjectKind: accepts instrument and listing", () => {
  assert.equal(isHoldingSubjectKind("instrument"), true);
  assert.equal(isHoldingSubjectKind("listing"), true);
});

test("isHoldingSubjectKind: rejects higher-order subject kinds", () => {
  for (const kind of ["theme", "macro_topic", "portfolio", "screen", "issuer"]) {
    assert.equal(isHoldingSubjectKind(kind), false, `expected ${kind} rejected`);
  }
});

test("assertHoldingSubjectRef: accepts a well-formed instrument ref", () => {
  assert.doesNotThrow(() =>
    assertHoldingSubjectRef({ kind: "instrument", id: VALID_INSTRUMENT_ID }),
  );
});

test("assertHoldingSubjectRef: accepts a well-formed listing ref", () => {
  assert.doesNotThrow(() =>
    assertHoldingSubjectRef({ kind: "listing", id: VALID_INSTRUMENT_ID }),
  );
});

test("assertHoldingSubjectRef: rejects theme as holding identity", () => {
  assert.throws(
    () => assertHoldingSubjectRef({ kind: "theme", id: VALID_INSTRUMENT_ID }),
    /subject_ref\.kind/,
  );
});

test("assertHoldingSubjectRef: rejects screen as holding identity", () => {
  assert.throws(
    () => assertHoldingSubjectRef({ kind: "screen", id: VALID_INSTRUMENT_ID }),
    /subject_ref\.kind/,
  );
});

test("assertHoldingSubjectRef: rejects portfolio (self) as holding identity", () => {
  assert.throws(
    () => assertHoldingSubjectRef({ kind: "portfolio", id: VALID_INSTRUMENT_ID }),
    /subject_ref\.kind/,
  );
});

test("assertHoldingSubjectRef: rejects macro_topic as holding identity", () => {
  assert.throws(
    () => assertHoldingSubjectRef({ kind: "macro_topic", id: VALID_INSTRUMENT_ID }),
    /subject_ref\.kind/,
  );
});

test("assertHoldingSubjectRef: rejects issuer as holding identity", () => {
  assert.throws(
    () => assertHoldingSubjectRef({ kind: "issuer", id: VALID_INSTRUMENT_ID }),
    /subject_ref\.kind/,
  );
});

test("assertHoldingSubjectRef: rejects raw ticker string as id (not a UUID)", () => {
  assert.throws(
    () => assertHoldingSubjectRef({ kind: "listing", id: "AAPL" }),
    /subject_ref\.id/,
  );
});

test("assertHoldingSubjectRef: rejects missing kind", () => {
  assert.throws(
    () => assertHoldingSubjectRef({ id: VALID_INSTRUMENT_ID }),
    /subject_ref\.kind/,
  );
});

test("assertPortfolioHoldingCreateInput: accepts minimal valid input", () => {
  assert.doesNotThrow(() =>
    assertPortfolioHoldingCreateInput({
      subject_ref: { kind: "instrument", id: VALID_INSTRUMENT_ID },
      quantity: 100,
    }),
  );
});

test("assertPortfolioHoldingCreateInput: accepts full optional fields", () => {
  assert.doesNotThrow(() =>
    assertPortfolioHoldingCreateInput({
      subject_ref: { kind: "listing", id: VALID_INSTRUMENT_ID },
      quantity: 50.5,
      cost_basis: 1234.56,
      opened_at: "2026-04-27T00:00:00.000Z",
      closed_at: "2026-04-28T00:00:00.000Z",
    }),
  );
});

test("assertPortfolioHoldingCreateInput: accepts null cost_basis and timestamps", () => {
  assert.doesNotThrow(() =>
    assertPortfolioHoldingCreateInput({
      subject_ref: { kind: "instrument", id: VALID_INSTRUMENT_ID },
      quantity: 1,
      cost_basis: null,
      opened_at: null,
      closed_at: null,
    }),
  );
});

test("assertPortfolioHoldingCreateInput: rejects theme subject", () => {
  assert.throws(
    () =>
      assertPortfolioHoldingCreateInput({
        subject_ref: { kind: "theme", id: VALID_INSTRUMENT_ID },
        quantity: 100,
      }),
    /subject_ref\.kind/,
  );
});

test("assertPortfolioHoldingCreateInput: rejects missing quantity", () => {
  assert.throws(
    () =>
      assertPortfolioHoldingCreateInput({
        subject_ref: { kind: "instrument", id: VALID_INSTRUMENT_ID },
      }),
    /quantity/,
  );
});

test("assertPortfolioHoldingCreateInput: rejects non-finite quantity", () => {
  assert.throws(
    () =>
      assertPortfolioHoldingCreateInput({
        subject_ref: { kind: "instrument", id: VALID_INSTRUMENT_ID },
        quantity: "100",
      }),
    /quantity/,
  );
  assert.throws(
    () =>
      assertPortfolioHoldingCreateInput({
        subject_ref: { kind: "instrument", id: VALID_INSTRUMENT_ID },
        quantity: Number.POSITIVE_INFINITY,
      }),
    /quantity/,
  );
});

test("assertPortfolioHoldingCreateInput: rejects malformed timestamps", () => {
  assert.throws(
    () =>
      assertPortfolioHoldingCreateInput({
        subject_ref: { kind: "instrument", id: VALID_INSTRUMENT_ID },
        quantity: 1,
        opened_at: "yesterday",
      }),
    /opened_at/,
  );
});

test("assertPortfolioHoldingCreateInput: rejects non-object body", () => {
  assert.throws(() => assertPortfolioHoldingCreateInput(null), /must be an object/);
});
