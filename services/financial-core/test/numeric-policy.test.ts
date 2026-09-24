import assert from "node:assert/strict";
import test from "node:test";
import Decimal from "decimal.js";
import { canonicalDecimalString, parseFinancialDecimal, type ExactDecimal } from "../src/exact-decimal.ts";
import { comparePredicateValue, divideRounded, NUMERIC_POLICY, roundHalfEvenSignificant } from "../src/numeric-policy.ts";
import { compareRational, divideRational, rational } from "./rational-oracle.ts";

function d(token: string): ExactDecimal {
  const result = parseFinancialDecimal(token);
  assert.ok(result.ok, token);
  return (result as { value: ExactDecimal }).value;
}

test("the numeric policy is versioned and declares its defaults", () => {
  assert.deepEqual(NUMERIC_POLICY, {
    version: "numeric-policy.v1",
    division_significant_digits: 50,
    rounding: "half_even",
    max_source_token_length: 256,
    max_abs_exponent: 1000,
    max_coefficient_digits: 4096,
  });
  assert.ok(Object.isFrozen(NUMERIC_POLICY));
});

test("division uses a private 50-digit half-even constructor and never mutates decimal.js globals", () => {
  const before = { precision: Decimal.precision, rounding: Decimal.rounding };
  const third = divideRounded(d("1"), d("3"));
  assert.deepEqual(
    third.ok && { value: canonicalDecimalString(third.value), exact: third.exact },
    { value: `0.${"3".repeat(50)}`, exact: false },
  );
  const twoThirds = divideRounded(d("2"), d("3"));
  assert.equal(twoThirds.ok && canonicalDecimalString(twoThirds.value), `0.${"6".repeat(49)}7`);
  assert.deepEqual({ precision: Decimal.precision, rounding: Decimal.rounding }, before);
});

test("terminating divisions are exact; repeating divisions are labelled rounded", () => {
  const cases: Array<[string, string]> = [["1", "8"], ["383285", "1000000"], ["-7", "2"], ["1", "1024"], ["22", "7"], ["1", "-3"]];
  for (const [n, den] of cases) {
    const result = divideRounded(d(n), d(den));
    assert.ok(result.ok, `${n}/${den}`);
    if (!result.ok) continue;
    const exactQuotient = divideRational(rational(n), rational(den));
    const representation = rational(canonicalDecimalString(result.value));
    assert.equal(result.exact, compareRational(representation, exactQuotient) === 0, `${n}/${den}`);
  }
  const eighth = divideRounded(d("1"), d("8"));
  assert.equal(eighth.ok && eighth.exact && canonicalDecimalString(eighth.value), "0.125");
});

test("division by zero is a named failure, never Infinity or zero", () => {
  assert.deepEqual(divideRounded(d("1"), d("0")), { ok: false, reason: "zero_denominator" });
  assert.deepEqual(divideRounded(d("0"), d("-0")), { ok: false, reason: "zero_denominator" });
});

test("display rounding is half-even and separate from predicates", () => {
  assert.equal(roundHalfEvenSignificant(d("0.125"), 2), "0.12");
  assert.equal(roundHalfEvenSignificant(d("0.135"), 2), "0.14");
  assert.equal(roundHalfEvenSignificant(d("-2.5"), 1), "-2");
  assert.equal(roundHalfEvenSignificant(d("9007199254740993"), 3), "9010000000000000");
  assert.equal(roundHalfEvenSignificant(d("0"), 3), "0");
  assert.throws(() => roundHalfEvenSignificant(d("1"), 0), RangeError);
});

test("predicates on rounded values return precision_indeterminate instead of guessing", () => {
  const third = divideRounded(d("1"), d("3"));
  assert.ok(third.ok);
  if (!third.ok) return;
  assert.equal(comparePredicateValue({ value: third.value, exact: false }, d(`0.${"3".repeat(50)}`)), "precision_indeterminate");
  assert.equal(comparePredicateValue({ value: third.value, exact: false }, d("0.3")), "precision_indeterminate");
  assert.equal(comparePredicateValue({ value: d("0.125"), exact: true }, d("0.12")), 1);
  assert.equal(comparePredicateValue({ value: d("0.125"), exact: true }, d("0.125")), 0);
  assert.equal(comparePredicateValue({ value: d("-0.125"), exact: true }, d("0")), -1);
});
