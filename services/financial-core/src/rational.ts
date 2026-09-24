// Exact arithmetic for financial operations. Every operand's value is a reduced
// integer fraction with a positive denominator, so sums, differences, products,
// quotients, thresholds, and rankings are all exact. Decimal text is only a
// representation: parsed at the input edge (exact-decimal.ts) and rendered at
// the output edge (rationalToValue, via the numeric policy). Results beyond the
// numeric limits return null, and callers surface numeric_limit_exceeded.

import { withinFinancialBounds, type ExactDecimal } from "./exact-decimal.ts";
import { divideRounded, NUMERIC_POLICY } from "./numeric-policy.ts";

export type ExactRational = Readonly<{ numerator: ExactDecimal; denominator: ExactDecimal }>;

export type RationalValue = {
  value: ExactDecimal;
  exact: boolean;
  rounding: { policy_version: string; significant_digits: number; mode: "half_even" } | null;
};

export function rationalFromDecimal(value: ExactDecimal): ExactRational | null {
  if (!withinFinancialBounds(value)) return null;
  const [numerator, denominator] = toFraction(value);
  return fromFraction(numerator, denominator);
}

export function addRationals(left: ExactRational, right: ExactRational): ExactRational | null {
  const [ln, ld] = fraction(left);
  const [rn, rd] = fraction(right);
  return fromFraction(ln * rd + rn * ld, ld * rd);
}

export function subtractRationals(left: ExactRational, right: ExactRational): ExactRational | null {
  const [ln, ld] = fraction(left);
  const [rn, rd] = fraction(right);
  return fromFraction(ln * rd - rn * ld, ld * rd);
}

export function multiplyRationals(left: ExactRational, right: ExactRational): ExactRational | null {
  const [ln, ld] = fraction(left);
  const [rn, rd] = fraction(right);
  return fromFraction(ln * rn, ld * rd);
}

/** Null when the divisor is zero or the result exceeds numeric limits. */
export function divideRationals(left: ExactRational, right: ExactRational): ExactRational | null {
  const [ln, ld] = fraction(left);
  const [rn, rd] = fraction(right);
  if (rn === 0n) return null;
  return fromFraction(ln * rd, ld * rn);
}

export function rationalSign(value: ExactRational): -1 | 0 | 1 {
  const coefficient = value.numerator.coefficient;
  return coefficient === 0n ? 0 : coefficient > 0n ? 1 : -1;
}

/** Exact cross-product comparison; denominators are positive by construction. */
export function compareRationals(left: ExactRational, right: ExactRational): -1 | 0 | 1 {
  const [ln, ld] = fraction(left);
  const [rn, rd] = fraction(right);
  const difference = ln * rd - rn * ld;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

/** Published representation: exact when the fraction terminates within policy digits. */
export function rationalToValue(value: ExactRational): RationalValue | null {
  const [, denominator] = fraction(value);
  if (denominator === 1n) return { value: value.numerator, exact: true, rounding: null };
  const quotient = divideRounded(value.numerator, value.denominator);
  if (!quotient.ok) return null;
  return quotient.exact
    ? { value: quotient.value, exact: true, rounding: null }
    : {
        value: quotient.value,
        exact: false,
        rounding: {
          policy_version: NUMERIC_POLICY.version,
          significant_digits: NUMERIC_POLICY.division_significant_digits,
          mode: "half_even",
        },
      };
}

function fraction(value: ExactRational): [bigint, bigint] {
  const [nn, nd] = toFraction(value.numerator);
  const [dn, dd] = toFraction(value.denominator);
  return [nn * dd, nd * dn];
}

function toFraction(value: ExactDecimal): [bigint, bigint] {
  return value.scale >= 0
    ? [value.coefficient, 10n ** BigInt(value.scale)]
    : [value.coefficient * 10n ** BigInt(-value.scale), 1n];
}

function fromFraction(numerator: bigint, denominator: bigint): ExactRational | null {
  if (denominator === 0n) return null;
  let n = numerator;
  let d = denominator;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const divisor = gcd(n < 0n ? -n : n, d);
  if (divisor > 1n) {
    n /= divisor;
    d /= divisor;
  }
  if (n === 0n) d = 1n;
  const result = { numerator: integerDecimal(n), denominator: integerDecimal(d) };
  return withinFinancialBounds(result.numerator) && withinFinancialBounds(result.denominator) ? Object.freeze(result) : null;
}

function integerDecimal(value: bigint): ExactDecimal {
  if (value === 0n) return Object.freeze({ coefficient: 0n, scale: 0 });
  let coefficient = value;
  let scale = 0;
  while (coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return Object.freeze({ coefficient, scale });
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left;
  let b = right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}
