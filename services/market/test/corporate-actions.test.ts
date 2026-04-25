import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCorporateActions,
  corporateAction,
  CORPORATE_ACTION_KINDS,
  type CashDividend,
  type CorporateAction,
  type SpinOff,
  type Split,
  type StockDividend,
} from "../src/corporate-actions.ts";
import type { NormalizedBar } from "../src/bar.ts";
import type { ListingSubjectRef } from "../src/subject-ref.ts";

const aaplListing: ListingSubjectRef = {
  kind: "listing",
  id: "11111111-1111-4111-a111-111111111111",
};

const targetListing: ListingSubjectRef = {
  kind: "listing",
  id: "22222222-2222-4222-a222-222222222222",
};

const SOURCE_ID = "00000000-0000-4000-a000-000000000001";

function bar(date: string, close: number, volume = 1000): NormalizedBar {
  // Construct a minimal valid OHLCV bar; tests only care about close/volume
  // for adjustment math, but the contract validators enforce OHLCV invariants.
  return {
    ts: `${date}T20:00:00.000Z`,
    open: close,
    high: close,
    low: close,
    close,
    volume,
  };
}

const ROUND = (n: number): number => Math.round(n * 1_000_000) / 1_000_000;

test("unadjusted basis returns a deep copy of the input bars unchanged", () => {
  const bars = [bar("2026-01-01", 100), bar("2026-01-02", 101)];
  const split: Split = {
    kind: "split",
    listing: aaplListing,
    effective_date: "2026-01-02T00:00:00.000Z",
    numerator: 2,
    denominator: 1,
    source_id: SOURCE_ID,
  };
  const result = applyCorporateActions(bars, [split], "unadjusted");
  assert.deepEqual(result, bars);
  assert.notEqual(result[0], bars[0], "unadjusted must still copy bars defensively");
});

test("split adjustment halves pre-split prices and doubles pre-split volume (2-for-1)", () => {
  const bars = [
    bar("2026-01-01", 100, 1_000),
    bar("2026-01-02", 102, 1_100),
    bar("2026-01-03", 51, 2_200), // post-split
    bar("2026-01-04", 52, 2_100),
  ];
  const split: Split = {
    kind: "split",
    listing: aaplListing,
    effective_date: "2026-01-03T00:00:00.000Z",
    numerator: 2,
    denominator: 1,
    source_id: SOURCE_ID,
  };
  const adjusted = applyCorporateActions(bars, [split], "split_adjusted");

  assert.equal(adjusted[0].close, 50);
  assert.equal(adjusted[1].close, 51);
  assert.equal(adjusted[2].close, 51, "post-split bars unchanged");
  assert.equal(adjusted[3].close, 52);

  assert.equal(adjusted[0].volume, 2_000);
  assert.equal(adjusted[1].volume, 2_200);
  assert.equal(adjusted[2].volume, 2_200);
});

test("verification clause: adjusted series shows price continuity across the split date", () => {
  // Construct a series where the only large day-to-day move is the split.
  // Pre-split: smooth uptrend $100 → $102 over two days.
  // Split day: price = 102 / 2 = $51 (no fundamental change).
  // Post-split: smooth uptrend $51 → $52.
  const bars = [
    bar("2026-01-01", 100),
    bar("2026-01-02", 102),
    bar("2026-01-03", 51),
    bar("2026-01-04", 52),
  ];
  const split: Split = {
    kind: "split",
    listing: aaplListing,
    effective_date: "2026-01-03T00:00:00.000Z",
    numerator: 2,
    denominator: 1,
    source_id: SOURCE_ID,
  };

  const unadjusted = applyCorporateActions(bars, [split], "unadjusted");
  const adjusted = applyCorporateActions(bars, [split], "split_adjusted");

  // In the unadjusted series, the largest day-to-day move is the split jump.
  const unadjustedJumps = unadjusted.slice(1).map((b, i) => Math.abs(b.close - unadjusted[i].close));
  const maxUnadjustedJump = Math.max(...unadjustedJumps);
  assert.ok(maxUnadjustedJump >= 50, "unadjusted should retain the artificial split-day drop");

  // In the adjusted series, every day-to-day move is small (no factor-of-2 step).
  const adjustedJumps = adjusted.slice(1).map((b, i) => Math.abs(b.close - adjusted[i].close));
  const maxAdjustedJump = Math.max(...adjustedJumps);
  assert.ok(maxAdjustedJump <= 1, `adjusted series broke continuity: max jump = ${maxAdjustedJump}`);
});

test("cash dividend adjustment scales pre-ex prices but leaves volume unchanged", () => {
  // Stock at $100 closes, then ex-dividend $1, so first ex-day open is ~$99.
  // Adjustment factor for pre-ex prices: (100 - 1) / 100 = 0.99
  const bars = [
    bar("2026-01-01", 100, 1_000),
    bar("2026-01-02", 99, 1_100), // ex-dividend
    bar("2026-01-03", 99.5, 1_050),
  ];
  const dividend: CashDividend = {
    kind: "cash_dividend",
    listing: aaplListing,
    effective_date: "2026-01-02T00:00:00.000Z",
    cash_amount: 1,
    currency: "USD",
    source_id: SOURCE_ID,
  };

  const adjusted = applyCorporateActions(bars, [dividend], "split_and_div_adjusted");
  assert.equal(adjusted[0].close, 99);
  assert.equal(adjusted[1].close, 99, "ex-day and later: unchanged");
  assert.equal(adjusted[2].close, 99.5);
  assert.equal(adjusted[0].volume, 1_000, "cash dividend does not adjust volume");
});

test("split_adjusted basis skips cash dividends and spin-offs", () => {
  const bars = [bar("2026-01-01", 100, 1_000), bar("2026-01-02", 99, 1_000)];
  const dividend: CashDividend = {
    kind: "cash_dividend",
    listing: aaplListing,
    effective_date: "2026-01-02T00:00:00.000Z",
    cash_amount: 1,
    currency: "USD",
    source_id: SOURCE_ID,
  };
  const spinoff: SpinOff = {
    kind: "spin_off",
    listing: aaplListing,
    effective_date: "2026-01-02T00:00:00.000Z",
    target_listing: targetListing,
    spinoff_value: 5,
    currency: "USD",
    source_id: SOURCE_ID,
  };
  const result = applyCorporateActions(bars, [dividend, spinoff], "split_adjusted");
  assert.equal(result[0].close, 100, "value-distribution actions ignored at split_adjusted basis");
  assert.equal(result[1].close, 99);
});

test("stock dividend (1 new share per 10 held) scales pre-ex prices by 11/10", () => {
  const bars = [bar("2026-01-01", 110), bar("2026-01-02", 100)];
  const stockDiv: StockDividend = {
    kind: "stock_dividend",
    listing: aaplListing,
    effective_date: "2026-01-02T00:00:00.000Z",
    numerator: 1,
    denominator: 10,
    source_id: SOURCE_ID,
  };
  const adjusted = applyCorporateActions(bars, [stockDiv], "split_adjusted");
  // Pre-ex: 110 / (11/10) = 100
  assert.equal(ROUND(adjusted[0].close), 100);
  assert.equal(adjusted[1].close, 100);
});

test("spin-off scales pre-effective prices like a value distribution", () => {
  const bars = [bar("2026-01-01", 100), bar("2026-01-02", 95)];
  const spinoff: SpinOff = {
    kind: "spin_off",
    listing: aaplListing,
    effective_date: "2026-01-02T00:00:00.000Z",
    target_listing: targetListing,
    spinoff_value: 5,
    currency: "USD",
    source_id: SOURCE_ID,
  };
  const adjusted = applyCorporateActions(bars, [spinoff], "split_and_div_adjusted");
  // factor = (100 - 5) / 100 = 0.95
  assert.equal(adjusted[0].close, 95);
  assert.equal(adjusted[1].close, 95);
});

test("multiple actions compose in chronological order regardless of input order", () => {
  // Two splits: 2-for-1 in March, then 3-for-1 in September.
  // Pre-March raw price $600. Mar–Sep raw $300. Post-Sep raw $100.
  // Final adjusted-to-current: pre-March = 600/(2*3) = 100; Mar–Sep = 300/3 = 100; post-Sep = 100.
  const bars = [
    bar("2026-02-01", 600),
    bar("2026-04-01", 300),
    bar("2026-10-01", 100),
  ];
  const splitMar: Split = {
    kind: "split",
    listing: aaplListing,
    effective_date: "2026-03-01T00:00:00.000Z",
    numerator: 2,
    denominator: 1,
    source_id: SOURCE_ID,
  };
  const splitSep: Split = {
    kind: "split",
    listing: aaplListing,
    effective_date: "2026-09-01T00:00:00.000Z",
    numerator: 3,
    denominator: 1,
    source_id: SOURCE_ID,
  };

  // Out-of-order input: September split first, then March split.
  const adjusted = applyCorporateActions(bars, [splitSep, splitMar], "split_adjusted");
  assert.equal(adjusted[0].close, 100);
  assert.equal(adjusted[1].close, 100);
  assert.equal(adjusted[2].close, 100);
});

test("cash dividend uses prior-bar close, not the lowest pre-ex close, as factor base", () => {
  const bars = [
    bar("2026-01-01", 50), // earlier bar — not the immediate prior
    bar("2026-01-02", 100), // close the day before ex-date
    bar("2026-01-03", 99), // ex-dividend $1
  ];
  const dividend: CashDividend = {
    kind: "cash_dividend",
    listing: aaplListing,
    effective_date: "2026-01-03T00:00:00.000Z",
    cash_amount: 1,
    currency: "USD",
    source_id: SOURCE_ID,
  };
  const adjusted = applyCorporateActions(bars, [dividend], "split_and_div_adjusted");
  // Factor must use prior close 100, not the older 50: (100 - 1) / 100 = 0.99
  assert.equal(ROUND(adjusted[0].close), 49.5);
  assert.equal(adjusted[1].close, 99);
  assert.equal(adjusted[2].close, 99);
});

test("actions whose effective_date is at or before the first bar leave bars untouched", () => {
  const bars = [bar("2026-02-01", 100)];
  const split: Split = {
    kind: "split",
    listing: aaplListing,
    effective_date: "2026-01-01T00:00:00.000Z",
    numerator: 2,
    denominator: 1,
    source_id: SOURCE_ID,
  };
  const adjusted = applyCorporateActions(bars, [split], "split_adjusted");
  assert.equal(adjusted[0].close, 100, "no pre-effective bars: nothing to adjust");
});

test("cash dividend with no prior bar in range is a safe no-op", () => {
  const bars = [bar("2026-01-03", 99)]; // already at/after ex-date
  const dividend: CashDividend = {
    kind: "cash_dividend",
    listing: aaplListing,
    effective_date: "2026-01-03T00:00:00.000Z",
    cash_amount: 1,
    currency: "USD",
    source_id: SOURCE_ID,
  };
  const adjusted = applyCorporateActions(bars, [dividend], "split_and_div_adjusted");
  assert.equal(adjusted[0].close, 99);
});

test("corporateAction smart constructor validates and freezes the result", () => {
  const built = corporateAction({
    kind: "split",
    listing: aaplListing,
    effective_date: "2026-01-03T00:00:00.000Z",
    numerator: 2,
    denominator: 1,
    source_id: SOURCE_ID,
  });
  assert.equal(built.kind, "split");
  assert.equal(Object.isFrozen(built), true);
  assert.equal(Object.isFrozen(built.listing), true);
});

test("corporateAction rejects bad inputs distinctly per kind", () => {
  assert.throws(
    () =>
      corporateAction({
        kind: "split",
        listing: aaplListing,
        effective_date: "2026-01-03T00:00:00.000Z",
        numerator: 0,
        denominator: 1,
        source_id: SOURCE_ID,
      }),
    /numerator/,
  );
  assert.throws(
    () =>
      corporateAction({
        kind: "cash_dividend",
        listing: aaplListing,
        effective_date: "2026-01-03T00:00:00.000Z",
        cash_amount: 1,
        currency: "usd",
        source_id: SOURCE_ID,
      }),
    /currency/,
  );
  assert.throws(
    () =>
      corporateAction({
        kind: "split",
        listing: { kind: "issuer", id: aaplListing.id } as unknown as ListingSubjectRef,
        effective_date: "2026-01-03T00:00:00.000Z",
        numerator: 2,
        denominator: 1,
        source_id: SOURCE_ID,
      }),
    /listing must be a listing SubjectRef/,
  );
  assert.throws(
    () =>
      corporateAction({
        kind: "spin_off",
        listing: aaplListing,
        effective_date: "2026-01-03T00:00:00.000Z",
        target_listing: { kind: "issuer", id: targetListing.id } as unknown as ListingSubjectRef,
        spinoff_value: 5,
        currency: "USD",
        source_id: SOURCE_ID,
      }),
    /target_listing/,
  );
});

test("CORPORATE_ACTION_KINDS contains every union variant", () => {
  // Compile-time + runtime: ensures the const array stays in sync with the
  // union, so a future kind addition can't silently skip the eligible-set
  // wiring in applyCorporateActions.
  const variants: CorporateActionKind[] = [
    "split",
    "cash_dividend",
    "stock_dividend",
    "spin_off",
  ];
  for (const v of variants) {
    assert.ok(CORPORATE_ACTION_KINDS.includes(v), `missing kind: ${v}`);
  }
  assert.equal(CORPORATE_ACTION_KINDS.length, variants.length);
});

test("split + cash dividend interact: dividend factor uses prevClose after prior split", () => {
  // Action 1 (Mar): 2-for-1 split. Action 2 (Jun): $1 cash dividend.
  // Raw bars:
  //   Pre-March $100 (raw). Mar–May $50. May 31 close $51. Jun ex-div: $50.
  // After split applied: pre-Mar bar becomes $50.
  // For dividend (oldest-first), prevClose on May 31 is $51 (unchanged by
  // the prior split, since May 31 ≥ March eff_date). Factor = (51-1)/51.
  const bars = [
    bar("2026-02-01", 100),
    bar("2026-04-01", 50),
    bar("2026-05-31", 51),
    bar("2026-06-02", 50), // ex-dividend
  ];
  const split: Split = {
    kind: "split",
    listing: aaplListing,
    effective_date: "2026-03-01T00:00:00.000Z",
    numerator: 2,
    denominator: 1,
    source_id: SOURCE_ID,
  };
  const dividend: CashDividend = {
    kind: "cash_dividend",
    listing: aaplListing,
    effective_date: "2026-06-02T00:00:00.000Z",
    cash_amount: 1,
    currency: "USD",
    source_id: SOURCE_ID,
  };

  const adjusted = applyCorporateActions(bars, [dividend, split], "split_and_div_adjusted");
  // Pre-Mar bar: 100 → split halves to 50 → dividend factor 50/51 ≈ 49.0196...
  assert.equal(ROUND(adjusted[0].close), ROUND(50 * (50 / 51)));
  // Mar–May bars (50, 51): only dividend applies. 50 * (50/51), 51 * (50/51).
  assert.equal(ROUND(adjusted[1].close), ROUND(50 * (50 / 51)));
  assert.equal(ROUND(adjusted[2].close), ROUND(51 * (50 / 51)));
  // Ex-day bar unchanged.
  assert.equal(adjusted[3].close, 50);
});

test("applyCorporateActions filters out actions outside the eligible set for the basis", () => {
  // A cash dividend should be skipped when basis is split_adjusted, even if
  // the action list also contains a split that does apply.
  const bars = [bar("2026-01-01", 100), bar("2026-01-02", 99), bar("2026-01-03", 49.5)];
  const dividend: CashDividend = {
    kind: "cash_dividend",
    listing: aaplListing,
    effective_date: "2026-01-02T00:00:00.000Z",
    cash_amount: 1,
    currency: "USD",
    source_id: SOURCE_ID,
  };
  const split: Split = {
    kind: "split",
    listing: aaplListing,
    effective_date: "2026-01-03T00:00:00.000Z",
    numerator: 2,
    denominator: 1,
    source_id: SOURCE_ID,
  };
  const splitOnly = applyCorporateActions(bars, [dividend, split], "split_adjusted");
  // Dividend skipped: pre-split bars only halved.
  assert.equal(splitOnly[0].close, 50);
  assert.equal(splitOnly[1].close, 49.5);
  assert.equal(splitOnly[2].close, 49.5);

  const both = applyCorporateActions(bars, [dividend, split], "split_and_div_adjusted");
  // Both applied (oldest-first: dividend on Jan 2, then split on Jan 3).
  // After dividend: bars[0] → 99 (close on Jan 1 was 100, factor 99/100).
  // After split: pre-Jan-3 bars halved: bars[0] → 49.5, bars[1] → 49.5.
  assert.equal(ROUND(both[0].close), 49.5);
  assert.equal(ROUND(both[1].close), 49.5);
  assert.equal(both[2].close, 49.5);
});

test("applyCorporateActions returns a fresh array; caller can mutate without affecting input", () => {
  const bars = [bar("2026-01-01", 100), bar("2026-01-02", 50)];
  const split: Split = {
    kind: "split",
    listing: aaplListing,
    effective_date: "2026-01-02T00:00:00.000Z",
    numerator: 2,
    denominator: 1,
    source_id: SOURCE_ID,
  };
  const adjusted = applyCorporateActions(bars, [split], "split_adjusted");
  adjusted[0].close = 999; // Should not affect the original input bar.
  assert.equal(bars[0].close, 100);
});

test("cash dividend lookup of prevClose is order-independent (unsorted bars accepted)", () => {
  // Reverse the ascending order so the "latest by index" pre-ex bar is NOT
  // the same as the "latest by ts" pre-ex bar. The factor must come from
  // the bar with the largest ts < effMs ($100, the day before ex), not from
  // the bar that happens to be later in the array ($50, two days before).
  const bars = [
    bar("2026-01-02", 100), // Tuesday close (immediate prior trading day)
    bar("2026-01-01", 50), // Monday close (older)
    bar("2026-01-03", 99), // Wednesday: ex-dividend
  ];
  const dividend: CashDividend = {
    kind: "cash_dividend",
    listing: aaplListing,
    effective_date: "2026-01-03T00:00:00.000Z",
    cash_amount: 1,
    currency: "USD",
    source_id: SOURCE_ID,
  };
  const adjusted = applyCorporateActions(bars, [dividend], "split_and_div_adjusted");
  // Factor uses prevClose=100 (max ts pre-ex), not 50.
  // Tuesday: 100 * 0.99 = 99
  // Monday:  50  * 0.99 = 49.5
  assert.equal(ROUND(adjusted[0].close), 99);
  assert.equal(ROUND(adjusted[1].close), 49.5);
  assert.equal(adjusted[2].close, 99);
});

test("malformed effective_date is a safe no-op (does not silently adjust every bar)", () => {
  const bars = [bar("2026-01-01", 100), bar("2026-01-02", 102)];
  // Bypassing the smart constructor — applyCorporateActions must not assume
  // its inputs were validated.
  const badSplit: Split = {
    kind: "split",
    listing: aaplListing,
    effective_date: "not-an-iso-timestamp",
    numerator: 2,
    denominator: 1,
    source_id: SOURCE_ID,
  };
  const badDividend: CashDividend = {
    kind: "cash_dividend",
    listing: aaplListing,
    effective_date: "not-an-iso-timestamp",
    cash_amount: 1,
    currency: "USD",
    source_id: SOURCE_ID,
  };
  const splitResult = applyCorporateActions(bars, [badSplit], "split_adjusted");
  assert.equal(splitResult[0].close, 100, "split with bad date must not corrupt prices");
  assert.equal(splitResult[1].close, 102);

  const divResult = applyCorporateActions(bars, [badDividend], "split_and_div_adjusted");
  assert.equal(divResult[0].close, 100, "dividend with bad date must not corrupt prices");
  assert.equal(divResult[1].close, 102);
});

test("malformed effective_date does not reorder otherwise valid corporate actions", () => {
  const bars = [
    bar("2026-01-01", 100),
    bar("2026-03-01", 99),
    bar("2026-08-31", 100),
    bar("2026-09-01", 50),
  ];
  const split: Split = {
    kind: "split",
    listing: aaplListing,
    effective_date: "2026-09-01T00:00:00.000Z",
    numerator: 2,
    denominator: 1,
    source_id: SOURCE_ID,
  };
  const badSplit: Split = {
    ...split,
    effective_date: "not-an-iso-timestamp",
  };
  const dividend: CashDividend = {
    kind: "cash_dividend",
    listing: aaplListing,
    effective_date: "2026-03-01T00:00:00.000Z",
    cash_amount: 1,
    currency: "USD",
    source_id: SOURCE_ID,
  };

  const adjusted = applyCorporateActions(
    bars,
    [split, badSplit, dividend],
    "split_and_div_adjusted",
  );
  assert.equal(ROUND(adjusted[0].close), 49.5);
  assert.equal(ROUND(adjusted[1].close), 49.5);
  assert.equal(ROUND(adjusted[2].close), 50);
  assert.equal(adjusted[3].close, 50);
});

test("applyCorporateActions accepts a CorporateAction union member without narrowing at the call site", () => {
  // Type-level: list typed as the union should compile.
  const actions: CorporateAction[] = [
    {
      kind: "split",
      listing: aaplListing,
      effective_date: "2026-01-03T00:00:00.000Z",
      numerator: 2,
      denominator: 1,
      source_id: SOURCE_ID,
    },
    {
      kind: "cash_dividend",
      listing: aaplListing,
      effective_date: "2026-01-04T00:00:00.000Z",
      cash_amount: 1,
      currency: "USD",
      source_id: SOURCE_ID,
    },
  ];
  const result = applyCorporateActions([bar("2026-01-01", 100)], actions, "split_and_div_adjusted");
  assert.equal(result.length, 1);
});
