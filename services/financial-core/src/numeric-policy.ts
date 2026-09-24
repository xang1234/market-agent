// numeric-policy.v1: division and display rounding through a private decimal.js
// constructor (50 significant digits, half-even). This is a versioned design
// default, not a universal financial standard. The global Decimal constructor
// is never configured; predicates never compare display-rounded values.

import Decimal from "decimal.js";
import {
  canonicalDecimalString,
  compareExactDecimals,
  FINANCIAL_DECIMAL_LIMITS,
  parseDerivedDecimalText,
  withinFinancialBounds,
  type ExactDecimal,
} from "./exact-decimal.ts";

export const NUMERIC_POLICY = Object.freeze({
  version: "numeric-policy.v1",
  division_significant_digits: 50,
  rounding: "half_even",
  ...FINANCIAL_DECIMAL_LIMITS,
} as const);

// Exponent bounds far beyond the financial limits so decimal.js itself never
// switches to exponent notation or underflows; the financial limits are
// enforced separately on inputs and results.
const PolicyDecimal = Decimal.clone({
  precision: NUMERIC_POLICY.division_significant_digits,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -9e15,
  toExpPos: 9e15,
  minE: -9e15,
  maxE: 9e15,
});

export type DivisionResult =
  | {
      ok: true;
      value: ExactDecimal;
      /** True only when the quotient terminates within the policy's digits. */
      exact: boolean;
      rounding: { policy_version: string; significant_digits: number; mode: "half_even" };
    }
  | { ok: false; reason: "zero_denominator" | "numeric_limit_exceeded" };

export function divideRounded(numerator: ExactDecimal, denominator: ExactDecimal): DivisionResult {
  if (!withinFinancialBounds(numerator) || !withinFinancialBounds(denominator)) {
    return { ok: false, reason: "numeric_limit_exceeded" };
  }
  if (denominator.coefficient === 0n) return { ok: false, reason: "zero_denominator" };
  const quotient = new PolicyDecimal(canonicalDecimalString(numerator)).div(canonicalDecimalString(denominator));
  const parsed = parseDerivedDecimalText(quotient.toFixed());
  if (!parsed.ok) return { ok: false, reason: "numeric_limit_exceeded" };
  // Exactness is established independently of decimal.js: q * d == n.
  const backProduct = {
    coefficient: parsed.value.coefficient * denominator.coefficient,
    scale: parsed.value.scale + denominator.scale,
  };
  return {
    ok: true,
    value: parsed.value,
    exact: compareExactDecimals(backProduct, numerator) === 0,
    rounding: {
      policy_version: NUMERIC_POLICY.version,
      significant_digits: NUMERIC_POLICY.division_significant_digits,
      mode: "half_even",
    },
  };
}

/** Display rounding only. Never feed the result into a predicate or calculation. */
export function roundHalfEvenSignificant(value: ExactDecimal, significantDigits: number): string {
  if (!Number.isInteger(significantDigits) || significantDigits < 1 || significantDigits > 1000) {
    throw new RangeError("significantDigits must be an integer from 1 to 1000");
  }
  const rounded = new PolicyDecimal(canonicalDecimalString(value))
    .toSignificantDigits(significantDigits, Decimal.ROUND_HALF_EVEN)
    .toFixed();
  const parsed = parseDerivedDecimalText(rounded);
  if (!parsed.ok) throw new RangeError("numeric_limit_exceeded");
  return canonicalDecimalString(parsed.value);
}

/**
 * Compares an exact value with a threshold. A rounded representation cannot
 * decide a predicate; callers holding exact operands use the cross-product
 * comparisons in exact-decimal.ts instead.
 */
export function comparePredicateValue(
  input: { value: ExactDecimal; exact: boolean },
  threshold: ExactDecimal,
): -1 | 0 | 1 | "precision_indeterminate" {
  if (!input.exact) return "precision_indeterminate";
  return compareExactDecimals(input.value, threshold);
}
