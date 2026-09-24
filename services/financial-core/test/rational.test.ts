import assert from "node:assert/strict";
import test from "node:test";
import { canonicalDecimalString, parseFinancialDecimal } from "../src/exact-decimal.ts";
import {
  addRationals,
  compareRationals,
  divideRationals,
  multiplyRationals,
  rationalFromDecimal,
  rationalSign,
  rationalToValue,
  subtractRationals,
  type ExactRational,
} from "../src/rational.ts";
import { addRational, compareRational, divideRational, equalRational, multiplyRational, rational, type Rational } from "./rational-oracle.ts";

function r(token: string): ExactRational {
  const parsed = parseFinancialDecimal(token);
  const value = parsed.ok ? rationalFromDecimal(parsed.value) : null;
  assert.ok(value, token);
  return value!;
}

function oracleOf(value: ExactRational | null): Rational {
  assert.ok(value, "expected a value within numeric limits");
  return divideRational(rational(canonicalDecimalString(value!.numerator)), rational(canonicalDecimalString(value!.denominator)));
}

const negate = (token: string) => (token.startsWith("-") ? token.slice(1) : `-${token}`);

test("addition and subtraction are exact and agree with the oracle", () => {
  const pairs: Array<[string, string]> = [
    ["0.1", "0.2"],
    ["9007199254740993", "1"],
    ["-9007199254740993", "9007199254740993"],
    ["0.1000000000000000000001", "-0.1"],
    ["1e1000", "1e-1000"],
    ["383285", "-0.000001"],
    ["-1.5", "-2.25"],
  ];
  for (const [a, b] of pairs) {
    assert.ok(equalRational(oracleOf(addRationals(r(a), r(b))), addRational(rational(a), rational(b))), `${a} + ${b}`);
    assert.ok(equalRational(oracleOf(subtractRationals(r(a), r(b))), addRational(rational(a), rational(negate(b)))), `${a} - ${b}`);
  }
  const zero = subtractRationals(r("0.5"), r("0.5"))!;
  assert.equal(rationalSign(zero), 0);
  assert.equal(canonicalDecimalString(rationalToValue(zero)!.value), "0");
});

test("value x scale multiplies exactly and within numeric limits", () => {
  const cases: Array<[string, string, string]> = [
    ["383285", "1000000", "383285000000"],
    ["1.5", "1000", "1500"],
    ["0.1000000000000000000001", "1000", "100.0000000000000000001"],
    ["-2.5", "0.001", "-0.0025"],
  ];
  for (const [value, scale, expected] of cases) {
    const product = multiplyRationals(r(value), r(scale));
    assert.ok(equalRational(oracleOf(product), rational(expected)), `${value} x ${scale}`);
    assert.ok(equalRational(rational(expected), multiplyRational(rational(value), rational(scale))));
  }
  assert.equal(multiplyRationals(r("1e-600"), r("1e-600")), null);
  assert.equal(multiplyRationals(r("1e600"), r("1e600")), null);
});

test("division keeps exact lineage and rejects a zero divisor", () => {
  assert.ok(equalRational(oracleOf(divideRationals(r("1"), r("3"))), { n: 1n, d: 3n }));
  assert.ok(equalRational(oracleOf(divideRationals(r("-1"), r("-4"))), rational("0.25")));
  assert.equal(divideRationals(r("1"), r("0")), null);
  assert.equal(divideRationals(r("1"), r("-0")), null);
});

test("comparisons are decided by exact values, not a rounded display", () => {
  const third = divideRationals(r("1"), r("3"))!;
  const displayed = rationalToValue(third)!;
  assert.equal(displayed.exact, false);
  assert.equal(canonicalDecimalString(displayed.value), `0.${"3".repeat(50)}`);
  assert.equal(compareRationals(third, r(`0.${"3".repeat(50)}`)), 1);
  assert.equal(compareRationals(third, r(`0.${"3".repeat(80)}`)), 1);
  assert.equal(compareRationals(third, r(`0.${"3".repeat(49)}4`)), -1);

  const twoThirds = divideRationals(r("2"), r("3"))!;
  assert.equal(compareRationals(twoThirds, r(`0.${"6".repeat(49)}7`)), -1);
  assert.equal(compareRationals(divideRationals(r("1"), r("8"))!, r("0.125")), 0);
  assert.equal(compareRationals(divideRationals(r("1"), r("-4"))!, r("0")), -1);
  assert.equal(compareRationals(divideRationals(r("-3"), r("-2"))!, r("1.4")), 1);
});

test("quotient comparisons agree with the oracle across a deterministic grid", () => {
  const values = ["-7.5", "-1", "-0.001", "0", "0.001", "0.3333", "1", "2.5", "9007199254740993", "0.1000000000000000000001"];
  for (const n of values) {
    for (const d of values) {
      if (rational(d).n === 0n) continue;
      for (const t of values) {
        const expected = compareRational(divideRational(rational(n), rational(d)), rational(t));
        assert.equal(compareRationals(divideRationals(r(n), r(d))!, r(t)), expected, `${n}/${d} vs ${t}`);
      }
    }
  }
});
