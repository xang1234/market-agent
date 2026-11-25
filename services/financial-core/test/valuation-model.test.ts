// ADR 0006's valuation model and its reverse solve, checked against the ADR's
// own synthetic example and against each named outcome this module owns.

import assert from "node:assert/strict";
import test from "node:test";
import {
  callStance,
  fixed,
  roundRational,
  compareRationals,
  consensusRow,
  hurdlePrice,
  parseFinancialDecimal,
  rationalFromDecimal,
  requiredGrowth,
  todaysMultiple,
  valuePerShare,
  type ExactRational,
  type StanceMoveResult,
  type StanceResult,
  type ValuationAssumptions,
  type ValuationInputs,
} from "../src/index.ts";

function q(text: string): ExactRational {
  const parsed = parseFinancialDecimal(text);
  assert.ok(parsed.ok, text);
  return rationalFromDecimal(parsed.value)!;
}

// F0 = 100, S0 = 10, N = 50, r = 10%, d = 0, X = 15 (USD m and m shares).
const SYNTHETIC: ValuationInputs = {
  call_date: "2026-11-10",
  listing_timezone: "America/New_York",
  period_end: "2026-09-26",
  price_date: "2026-11-09",
  currency: { reporting: "USD", price: "USD" },
  free_cash_flow: q("100"),
  shares: q("10"),
  net_cash: q("50"),
  price: q("200"),
  required_return: q("0.1"),
};
const ASSUMED: ValuationAssumptions = { share_change: q("0"), exit_multiple: q("15") };

const at = (overrides: Partial<ValuationInputs>): ValuationInputs => ({ ...SYNTHETIC, ...overrides });
const text = (result: { kind: string; text: string }) => [result.kind, result.text];

test("V(g) reproduces ADR 0006's worked example, and V(10%) is exactly 205", () => {
  assert.deepEqual(
    ["-0.5", "0", "0.05", "0.1", "1"].map((g) => text(valuePerShare(SYNTHETIC, ASSUMED, q(g)))),
    [["value", "16.08"], ["value", "136.05"], ["value", "167.45"], ["value", "205.00"], ["value", "3,404.74"]],
  );
  const exact = valuePerShare(SYNTHETIC, ASSUMED, q("0.1"));
  assert.ok(exact.kind === "value");
  assert.deepEqual(exact.value, q("205"));
  // Growth and share change enter only as (1 + g) / (1 + d): 10% growth diluted 10% a year is V(0%) undiluted.
  assert.deepEqual(text(valuePerShare(SYNTHETIC, { ...ASSUMED, share_change: q("0.1") }, q("0.1"))), ["value", "136.05"]);
});

test("V strictly increases in g across the domain", () => {
  const values = ["-0.5", "-0.25", "-0.01", "0", "0.01", "0.3", "0.99", "1"].map((g) => {
    const result = valuePerShare(SYNTHETIC, ASSUMED, q(g));
    assert.ok(result.kind === "value");
    return result.value;
  });
  assert.deepEqual(values.slice(1).map((value, index) => compareRationals(value, values[index]!)), [1, 1, 1, 1, 1, 1, 1]);
});

test("required growth is 9.4% at P = 200 and -7.2% at P = 100, each in 14 bisection steps", () => {
  const solved = ["200", "100"].map((price) => {
    const result = requiredGrowth(at({ price: q(price) }), ASSUMED);
    assert.ok(result.kind === "value");
    return [result.text, result.steps, result.growth];
  });
  // The midpoint of the final bracket: [1537/16384, 3077/32768] and [-1181/16384, -2359/32768].
  assert.deepEqual(solved, [["9.4%", 14, q("0.093856811523437500")], ["-7.2%", 14, q("-0.0720367431640625")]]);
});

test("a price below V(-50%) is below the domain, and one above V(100%) is above it", () => {
  assert.deepEqual(
    [requiredGrowth(at({ price: q("10") }), ASSUMED), requiredGrowth(at({ price: q("3404.75") }), ASSUMED)].map((result) => [result.kind, "outcome" in result ? result.outcome : null, result.text]),
    [
      ["outcome", "below_domain", "The price requires free cash flow per share to shrink faster than 50% a year."],
      ["outcome", "above_domain", "The price requires free cash flow per share to grow faster than 100% a year."],
    ],
  );
});

test("the hurdle price is min(V / margin, B / (1 - loss limit)): 164.00 for V(10%) and B = V(0%)", () => {
  const base = valuePerShare(SYNTHETIC, ASSUMED, q("0.1"));
  const bear = valuePerShare(SYNTHETIC, ASSUMED, q("0"));
  assert.ok(base.kind === "value" && bear.kind === "value");
  const settings = { margin_of_safety: q("1.25"), bear_loss_limit: q("0.25") };
  const hurdle = hurdlePrice(base.value, bear.value, settings);
  assert.ok(hurdle.kind === "value");
  assert.deepEqual([hurdle.text, hurdle.value], ["164.00", q("164")]);
  // With a tighter margin the bear test binds: B / 0.75 = 136.0526... / 0.75.
  assert.equal(hurdlePrice(base.value, bear.value, { ...settings, margin_of_safety: q("1") }).text, "181.39");
});

test("no positive hurdle price when V or B is not positive, and settings outside ADR 0005's ranges are rejected", () => {
  const settings = { margin_of_safety: q("1.25"), bear_loss_limit: q("0.25") };
  assert.deepEqual(
    [
      hurdlePrice(q("205"), q("0"), settings),
      hurdlePrice(q("-1"), q("100"), settings),
      hurdlePrice(q("205"), q("100"), { ...settings, margin_of_safety: q("0.99") }),
      hurdlePrice(q("205"), q("100"), { ...settings, bear_loss_limit: q("1") }),
      hurdlePrice(q("205"), q("100"), { ...settings, bear_loss_limit: q("0") }),
    ].map(text),
    [
      ["outcome", "Base or bear value per share is zero or negative, so there is no positive hurdle price."],
      ["outcome", "Base or bear value per share is zero or negative, so there is no positive hurdle price."],
      ["outcome", "A hurdle setting is outside its range: margin of safety at least 1, bear-loss limit above 0 and below 1, near band above 0."],
      ["outcome", "A hurdle setting is outside its range: margin of safety at least 1, bear-loss limit above 0 and below 1, near band above 0."],
      ["outcome", "A hurdle setting is outside its range: margin of safety at least 1, bear-loss limit above 0 and below 1, near band above 0."],
    ],
  );
});

test("today's multiple is (P·S0 - N) / F0, and none forms when net cash is at least the market cap", () => {
  assert.deepEqual(text(todaysMultiple(SYNTHETIC)), ["value", "19.50x"]);
  const none = todaysMultiple(at({ price: q("5") }));
  assert.deepEqual(
    [none.kind, "reason_code" in none ? none.reason_code : null, none.text],
    ["outcome", "non_positive_base", "Net cash is at least the market cap, so there is no positive multiple today and required growth at today's multiple is not computed."],
  );
});

test("each input outcome declines V, today's multiple and required growth alike, with its reason code", () => {
  const cases: ReadonlyArray<[Partial<ValuationInputs>, string, string | null]> = [
    [{ currency: { reporting: "EUR", price: "USD" } }, "incompatible_currency", "incompatible_currency"],
    [{ currency: { reporting: "USD", price: "CAD" } }, "incompatible_currency", "incompatible_currency"],
    [{ free_cash_flow: q("0") }, "non_positive_free_cash_flow", "non_positive_base"],
    [{ free_cash_flow: q("-1") }, "non_positive_free_cash_flow", "non_positive_base"],
    // 2025-08-10 + 15 months is 2026-11-10: the Call date itself is still in time, the day after is not.
    [{ period_end: "2025-08-09" }, "stale_filing", "stale_input"],
    [{ shares: q("0") }, "shares_missing", "missing_input"],
    [{ price_date: "2026-11-11" }, "price_missing", "missing_input"],
    // Tue 2026-11-10 is six sessions after Mon 2026-11-02.
    [{ price_date: "2026-11-02" }, "stale_price", "stale_input"],
    [{ required_return: q("0") }, "required_return_out_of_range", null],
  ];
  for (const [overrides, outcome, reasonCode] of cases) {
    const inputs = at(overrides);
    const results = [valuePerShare(inputs, ASSUMED, q("0.1")), todaysMultiple(inputs), requiredGrowth(inputs, ASSUMED)];
    assert.deepEqual(
      results.map((result) => [result.kind, "outcome" in result ? result.outcome : null, "reason_code" in result ? result.reason_code : undefined]),
      [["outcome", outcome, reasonCode], ["outcome", outcome, reasonCode], ["outcome", outcome, reasonCode]],
      outcome,
    );
  }
});

test("an exit multiple or share change outside its range declines V and required growth, but not today's multiple", () => {
  const cases: ReadonlyArray<[Partial<ValuationAssumptions>, string, string]> = [
    [{ exit_multiple: q("0") }, "exit_multiple_out_of_range", "The exit multiple must be above 0."],
    [{ exit_multiple: q("-15") }, "exit_multiple_out_of_range", "The exit multiple must be above 0."],
    [{ share_change: q("-1") }, "share_change_out_of_range", "The annual share change must be above -100%."],
  ];
  for (const [overrides, outcome, said] of cases) {
    const assumed = { ...ASSUMED, ...overrides };
    assert.deepEqual(
      [valuePerShare(SYNTHETIC, assumed, q("0.1")), requiredGrowth(SYNTHETIC, assumed)].map((result) => [result.kind, "outcome" in result ? result.outcome : null, result.text]),
      [["outcome", outcome, said], ["outcome", outcome, said]],
    );
  }
  assert.deepEqual(text(todaysMultiple(SYNTHETIC)), ["value", "19.50x"]);
  // Just inside: d = -99.99% still values.
  assert.equal(valuePerShare(SYNTHETIC, { ...ASSUMED, share_change: q("-0.9999") }, q("0.1")).kind, "value");
});

test("the staleness limits hold at their edges: 15 months to the day, 5 sessions", () => {
  assert.equal(valuePerShare(at({ period_end: "2025-08-10" }), ASSUMED, q("0.1")).kind, "value");
  // A month-end start clamps: 2025-08-31 + 15 months is 2026-11-30.
  assert.equal(valuePerShare(at({ period_end: "2025-08-31", call_date: "2026-11-30", price_date: "2026-11-30" }), ASSUMED, q("0.1")).kind, "value");
  assert.equal(valuePerShare(at({ period_end: "2025-08-31", call_date: "2026-12-01", price_date: "2026-12-01" }), ASSUMED, q("0.1")).kind, "outcome");
  // Fri 2026-11-06 to Fri 2026-11-13 is five sessions; the weekend between is not counted.
  assert.equal(valuePerShare(at({ price_date: "2026-11-06", call_date: "2026-11-13" }), ASSUMED, q("0.1")).kind, "value");
  assert.equal(valuePerShare(at({ price_date: "2026-11-06", call_date: "2026-11-16" }), ASSUMED, q("0.1")).kind, "outcome");
});

test("a market holiday is not a trading day: Christmas and New Year's Day leave 2026-12-24 five sessions before 2027-01-04 (#611)", () => {
  const priced = (price_date: string) => valuePerShare(at({ price_date, call_date: "2027-01-04" }), ASSUMED, q("0.1"));
  assert.deepEqual(["2026-12-24", "2026-12-23"].map((date) => {
    const result = priced(date);
    return "outcome" in result ? result.outcome : result.kind;
  }), ["value", "stale_price"]);
});

test("a value past the exact-arithmetic limits is numeric_limit_exceeded, never a throw", () => {
  // (1 + 10^-1000)^5 needs a denominator of 10^5000, past the 4096-digit limit.
  const tiny = { coefficient: 1n, scale: 1000 };
  const assumed = { ...ASSUMED, share_change: rationalFromDecimal(tiny)! };
  assert.deepEqual(
    [valuePerShare(SYNTHETIC, assumed, q("0.1")), requiredGrowth(SYNTHETIC, assumed)].map((result) => [result.kind, "outcome" in result ? result.outcome : null, result.text]),
    [
      ["outcome", "numeric_limit_exceeded", "The calculation exceeds the exact-arithmetic limits, so no number is shown."],
      ["outcome", "numeric_limit_exceeded", "The calculation exceeds the exact-arithmetic limits, so no number is shown."],
    ],
  );
});

test("consensus is the newest capture on or before the Call date, at most 7 days old", () => {
  const captures = [
    { captured_on: "2026-11-02", eps_growth_next_5y: "8.1" },
    { captured_on: "2026-11-09", eps_growth_next_5y: "8.18" },
    { captured_on: "2026-11-11", eps_growth_next_5y: "9.5" },
  ];
  assert.deepEqual(text(consensusRow(captures, "2026-11-10")), ["value", "attributed consensus: Finviz EPS growth, next 5 years, captured 2026-11-09: 8.18%"]);
  assert.deepEqual(text(consensusRow(captures.slice(0, 1), "2026-11-09")), ["value", "attributed consensus: Finviz EPS growth, next 5 years, captured 2026-11-02: 8.1%"]);
  assert.deepEqual(text(consensusRow(captures.slice(0, 1), "2026-11-10")), ["outcome", "no consensus within 7 days"]);
  assert.deepEqual(text(consensusRow([{ captured_on: "2026-11-09", eps_growth_next_5y: null }], "2026-11-10")), ["outcome", "no consensus within 7 days"]);
  assert.deepEqual(text(consensusRow(captures.slice(2), "2026-11-10")), ["outcome", "no consensus within 7 days"]);
});

test("growth at or below -100% declines V instead of valuing a negative cash flow", () => {
  assert.deepEqual(
    ["-1", "-2"].map((g) => {
      const result = valuePerShare(SYNTHETIC, ASSUMED, q(g));
      return [result.kind, "outcome" in result ? result.outcome : null, result.text];
    }),
    [
      ["outcome", "growth_out_of_range", "Annual growth must be above -100%."],
      ["outcome", "growth_out_of_range", "Annual growth must be above -100%."],
    ],
  );
});

test("when several inputs fail, the first in ADR 0006's table is the one shown", () => {
  const result = valuePerShare(at({ shares: q("0"), free_cash_flow: q("0"), currency: { reporting: "EUR", price: "USD" } }), ASSUMED, q("0.1"));
  assert.deepEqual([result.kind, "outcome" in result ? result.outcome : null], ["outcome", "non_positive_free_cash_flow"]);
});

// ADR 0006's hurdle example: base g 10% (V = 205.00), bear g 0% (B = 136.05), so H = min(164.00, 181.39) = 164.00.
const BASE = { growth: q("0.1"), share_change: q("0"), exit_multiple: q("15") };
const BEAR = { growth: q("0"), share_change: q("0"), exit_multiple: q("15") };
const HURDLE = { margin_of_safety: q("1.25"), bear_loss_limit: q("0.25"), near_band: q("0.1") };
const stance = (price: string, overrides: Partial<Parameters<typeof callStance>[3]> = {}, bear = BEAR, inputs: Partial<ValuationInputs> = {}) =>
  callStance(at({ price: q(price), ...inputs }), BASE, bear, { ...HURDLE, ...overrides });
const said = (result: StanceResult) => result.kind === "stated" ? [result.rule, result.text, fixed2(result.hurdle)] : [result.rule];
const fixed2 = (value: ExactRational) => fixed(roundRational(value, 2), 2);
const named = (moves: StanceMoveResult["move"][]) => moves.map((move) => `${move.input} ${move.direction}`);
const untested = (result: Extract<StanceResult, { moves: unknown }>) => named(result.moves.filter((entry) => entry.result === null).map((entry) => entry.move));
const flips = (result: Extract<StanceResult, { moves: unknown }>, rule: number) => named(result.moves.filter((entry) => entry.result !== null && entry.result.rule !== rule).map((entry) => entry.move));

test("a price at or under H clears your hurdle, one within the near band is near it, and one above falls short", () => {
  assert.deepEqual(said(stance("140")), [4, "Clears your hurdle.", "164.00"]);
  // A one-point move shifts H by more than a 10% band, so near is stable only under a wider band.
  assert.deepEqual(said(stance("200", { near_band: q("0.5") })), [5, "Near your hurdle.", "164.00"]);
  assert.deepEqual(said(stance("300")), [6, "Falls short of your hurdle.", "164.00"]);
  const stated = stance("140");
  assert.ok(stated.kind === "stated");
  assert.deepEqual([fixed2(stated.base), fixed2(stated.bear), untested(stated), flips(stated, 4)], ["205.00", "136.05", [], []]);
  // Each move's tests come back: growth one point up in both cases raises H.
  const up = stated.moves.find((entry) => entry.move.input === "growth" && entry.move.direction === "up")!.result;
  assert.ok(up !== null && !("kind" in up));
  assert.deepEqual([up.rule, compareRationals(up.hurdle, stated.hurdle)], [4, 1]);
});

test("rule 2: a bear value at or below zero leaves no positive hurdle price", () => {
  // Net debt of 2,000 is -200 a share, more than the bear case's cash flows are worth.
  const result = stance("140", {}, BEAR, { net_cash: q("-2000") });
  assert.equal(result.kind === "declined" && result.rule, 2);
  assert.ok(result.kind === "declined" && result.rule === 2 && compareRationals(result.bear, q("0")) <= 0);
});

test("rule 3: a price at H declines, naming each move that flips it; a move out of range is untested, not a flip", () => {
  const result = stance("164");
  assert.ok(result.kind === "declined" && result.rule === 3);
  assert.deepEqual(flips(result, result.tests.rule), ["share_change up", "required_return up", "growth down", "exit_multiple down"]);
  assert.deepEqual(untested(result), []);
  // A bear growth of -99.5% cannot move down a point, nor a required return of 0.5%.
  const edge = callStance(at({ price: q("1"), required_return: q("0.005") }), BASE, { ...BEAR, growth: q("-0.995") }, HURDLE);
  assert.ok(edge.kind === "stated");
  assert.deepEqual(untested(edge), ["growth down", "required_return down"]);
});

test("rule 0: a bear growth at the -100% floor leaves B without a value", () => {
  const result = stance("140", {}, { ...BEAR, growth: q("-1") });
  assert.deepEqual(result.kind === "declined" && result.rule === 0 && result.outcome.outcome, "growth_out_of_range");
});

test("rule 0: a near band at or below zero is a hurdle setting out of range, not a stance", () => {
  for (const band of ["0", "-0.5"]) {
    const result = stance("300", { near_band: q(band) });
    assert.deepEqual(result.kind === "declined" && result.rule === 0 && result.outcome.outcome, "hurdle_setting_out_of_range", band);
    // Rule 0 comes ahead of rule 2: net debt that leaves no positive hurdle price does not hide the setting.
    const indebted = stance("140", { near_band: q(band) }, BEAR, { net_cash: q("-2000") });
    assert.deepEqual(indebted.kind === "declined" && indebted.rule === 0 && indebted.outcome.outcome, "hurdle_setting_out_of_range", band);
  }
});

test("a stability move past the numeric limits is untested, not a crash", () => {
  // An exit multiple of 10^1001 - 1 computes, but one more 1x does not fit the exact-decimal limits.
  const huge = rationalFromDecimal({ coefficient: 10n ** 1001n - 1n, scale: 0 })!;
  const result = callStance(at({ price: q("100") }), { ...BASE, exit_multiple: huge }, { ...BEAR, exit_multiple: huge }, HURDLE);
  assert.ok(result.kind === "stated", JSON.stringify(result.kind));
  assert.deepEqual(untested(result), ["exit_multiple up"]);
});
