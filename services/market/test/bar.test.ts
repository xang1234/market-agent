import test from "node:test";
import assert from "node:assert/strict";
import {
  ADJUSTMENT_BASES,
  assertBarsContract,
  BAR_INTERVALS,
  normalizedBars,
  type AdjustmentBasis,
  type BarInterval,
  type NormalizedBar,
  type NormalizedBars,
} from "../src/bar.ts";
import type { ListingSubjectRef } from "../src/subject-ref.ts";
import { aaplListing, POLYGON_SOURCE_ID as SOURCE_ID } from "./fixtures.ts";

const RANGE = {
  start: "2026-04-22T00:00:00.000Z",
  end: "2026-04-23T00:00:00.000Z",
};

function bar(tsHours: number, overrides: Partial<NormalizedBar> = {}): NormalizedBar {
  return {
    ts: new Date(`2026-04-22T${String(tsHours).padStart(2, "0")}:00:00.000Z`).toISOString(),
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 1000,
    ...overrides,
  };
}

function validInput(): NormalizedBars {
  return {
    listing: aaplListing,
    interval: "1h",
    range: RANGE,
    bars: [bar(0), bar(1), bar(2)],
    as_of: "2026-04-22T02:00:00.000Z",
    delay_class: "eod",
    currency: "USD",
    source_id: SOURCE_ID,
    adjustment_basis: "split_and_div_adjusted",
  };
}

test("normalizedBars accepts a well-formed series and returns a frozen result", () => {
  const input = validInput();
  const result = normalizedBars(input);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.listing), true);
  assert.equal(Object.isFrozen(result.range), true);
  assert.equal(Object.isFrozen(result.bars), true);
  assert.equal(Object.isFrozen(result.bars[0]), true);
  assert.notEqual(result.listing, input.listing);
  assert.notEqual(result.range, input.range);
  assert.equal(result.bars.length, 3);
});

test("normalizedBars accepts an empty bar series (off-hours request)", () => {
  const result = normalizedBars({ ...validInput(), bars: [] });
  assert.equal(result.bars.length, 0);
});

test("normalizedBars rejects non-listing SubjectRef kinds", () => {
  const issuerRef = { kind: "issuer", id: aaplListing.id } as unknown as ListingSubjectRef;
  assert.throws(
    () => normalizedBars({ ...validInput(), listing: issuerRef }),
    /listing/,
  );
});

test("normalizedBars rejects unknown interval / adjustment_basis values", () => {
  assert.throws(
    () =>
      normalizedBars({
        ...validInput(),
        interval: "30m" as unknown as (typeof BAR_INTERVALS)[number],
      }),
    /interval/,
  );
  assert.throws(
    () =>
      normalizedBars({
        ...validInput(),
        adjustment_basis: "split_only" as unknown as (typeof ADJUSTMENT_BASES)[number],
      }),
    /adjustment_basis/,
  );
});

test("normalizedBars rejects a range whose start is not strictly before end", () => {
  assert.throws(
    () =>
      normalizedBars({
        ...validInput(),
        range: { start: RANGE.end, end: RANGE.end },
      }),
    /start must be strictly before end/,
  );
});

test("normalizedBars rejects a bar outside the requested half-open range", () => {
  // ts equal to range.end falls outside [start, end) — exclusive end.
  const tooLate = bar(0, { ts: RANGE.end });
  assert.throws(
    () => normalizedBars({ ...validInput(), bars: [tooLate] }),
    /falls outside requested range/,
  );

  const tooEarly = bar(0, { ts: "2026-04-21T23:59:59.000Z" });
  assert.throws(
    () => normalizedBars({ ...validInput(), bars: [tooEarly] }),
    /falls outside requested range/,
  );
});

test("normalizedBars rejects bars not strictly ascending by ts (duplicates and reversals)", () => {
  const duplicate = [bar(0), bar(0)];
  assert.throws(
    () => normalizedBars({ ...validInput(), bars: duplicate }),
    /not strictly after/,
  );

  const reversed = [bar(2), bar(1)];
  assert.throws(
    () => normalizedBars({ ...validInput(), bars: reversed }),
    /not strictly after/,
  );
});

test("normalizedBars rejects OHLCV violations (high < low, high < open, low > close, etc.)", () => {
  assert.throws(
    () => normalizedBars({ ...validInput(), bars: [bar(0, { high: 90, low: 99 })] }),
    /high.*must be >= low/,
  );
  assert.throws(
    () => normalizedBars({ ...validInput(), bars: [bar(0, { high: 99, open: 100 })] }),
    /high.*must be >= max\(open, close\)/,
  );
  assert.throws(
    () => normalizedBars({ ...validInput(), bars: [bar(0, { low: 101, close: 100.5 })] }),
    /low.*must be <= min\(open, close\)/,
  );
});

test("normalizedBars rejects negative volume but accepts zero (silent session)", () => {
  assert.throws(
    () => normalizedBars({ ...validInput(), bars: [bar(0, { volume: -1 })] }),
    /volume.*non-negative/,
  );
  assert.doesNotThrow(() =>
    normalizedBars({ ...validInput(), bars: [bar(0, { volume: 0 })] }),
  );
});

test("normalizedBars rejects malformed metadata (bad currency, bad UUID source_id, naive timestamp)", () => {
  assert.throws(
    () => normalizedBars({ ...validInput(), currency: "usd" }),
    /currency/,
  );
  assert.throws(
    () => normalizedBars({ ...validInput(), source_id: "not-a-uuid" }),
    /source_id/,
  );
  assert.throws(
    () => normalizedBars({ ...validInput(), as_of: "2026-04-22T15:30:00" }),
    /as_of/,
  );
});

test("assertBarsContract accepts a result built via the smart constructor", () => {
  const built = normalizedBars(validInput());
  assert.doesNotThrow(() => assertBarsContract(built));
});

test("assertBarsContract rejects a result missing required metadata fields", () => {
  for (const drop of [
    "as_of",
    "delay_class",
    "currency",
    "source_id",
    "adjustment_basis",
    "interval",
    "range",
  ] as const) {
    const built = normalizedBars(validInput());
    const tampered: Record<string, unknown> = { ...built };
    delete tampered[drop];
    assert.throws(
      () => assertBarsContract(tampered),
      undefined,
      `expected missing ${drop} to be rejected`,
    );
  }
});

test("assertBarsContract rejects bars whose ts has been tampered out of order", () => {
  const built = normalizedBars(validInput());
  const tampered = {
    ...built,
    bars: [built.bars[2], built.bars[1], built.bars[0]],
  };
  assert.throws(() => assertBarsContract(tampered), /not strictly after/);
});

test("assertBarsContract rejects all three adjustment_basis enum violations distinctly", () => {
  for (const bad of ["adjusted", "raw", "split-and-div"]) {
    const tampered = {
      ...normalizedBars(validInput()),
      adjustment_basis: bad as AdjustmentBasis,
    };
    assert.throws(
      () => assertBarsContract(tampered),
      /adjustment_basis/,
      `expected adjustment_basis=${bad} to be rejected`,
    );
  }
});

test("normalizedBars accepts every supported BarInterval value", () => {
  for (const interval of BAR_INTERVALS) {
    const result = normalizedBars({ ...validInput(), interval, bars: [] });
    assert.equal(result.interval, interval);
  }
});

test("normalizedBars accepts every supported AdjustmentBasis value", () => {
  for (const basis of ADJUSTMENT_BASES) {
    const result = normalizedBars({ ...validInput(), adjustment_basis: basis });
    assert.equal(result.adjustment_basis, basis);
  }
});
