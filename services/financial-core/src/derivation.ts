import type { DerivationProofV1 } from "./contracts.ts";
import { parseFinancialDecimal, type ExactDecimal } from "./exact-decimal.ts";
import { addRationals, rationalFromDecimal, rationalToValue, subtractRationals, type ExactRational } from "./rational.ts";

/** Σ sign × term token, exactly; null without terms, for a token that is not a source decimal, or past the numeric limits. */
export function derivationValue(proof: DerivationProofV1): ExactDecimal | null {
  if (proof.terms.length === 0) return null;
  let sum: ExactRational | null = rationalFromDecimal({ coefficient: 0n, scale: 0 });
  for (const term of proof.terms) {
    const token = parseFinancialDecimal(term.raw_token);
    const value = token.ok ? rationalFromDecimal(token.value) : null;
    if (sum === null || value === null) return null;
    sum = term.sign === "+" ? addRationals(sum, value) : term.sign === "-" ? subtractRationals(sum, value) : null;
  }
  const represented = sum === null ? null : rationalToValue(sum);
  return represented?.exact ? represented.value : null;
}
