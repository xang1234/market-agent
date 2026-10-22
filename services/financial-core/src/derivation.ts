import { hashCanonical } from "./canonical.ts";
import type { DerivationProofV1, IsoDate } from "./contracts.ts";
import type { MetricValueKind } from "./definitions.ts";
import { compareExactDecimals, parseDerivedDecimalText, parseFinancialDecimal, type ExactDecimal } from "./exact-decimal.ts";
import { dayNumber } from "./periods.ts";
import { addRationals, rationalFromDecimal, rationalToValue, subtractRationals, type ExactRational } from "./rational.ts";
import { validateDerivationProof } from "./validate.ts";

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

export type DerivationIssue =
  | "not_a_flow"
  | "invalid_derivation"
  | "proof_hash_mismatch"
  | "own_term_sign"
  | "own_term_source"
  | "own_term_end"
  | "periods_not_contiguous"
  | "fiscal_year_mismatch"
  | "value_mismatch"
  | "own_term_not_last_filed";

export type DerivedFact = Readonly<{
  /** The metric's, from its definition; null for a metric outside the catalog. */
  value_kind: MetricValueKind | null;
  source_id: string;
  /** The hash recorded beside the proof, which must bind it. */
  token_proof_hash: string | null;
  value_text: string | null;
  period: Readonly<{ start: IsoDate | null; end: IsoDate; fiscal_year: number }>;
}>;

/**
 * Whether a derivation proves a fact (#481), the one check the writer, engine
 * eligibility and binding share. Only a flow sums over periods. The fact is
 * its own filing's term, which ends on the fact's end, less the terms that
 * tile the rest of that term exactly, all of the fact's fiscal year. Every
 * other term was filed strictly before the own term, so the value is public
 * exactly when its last input is.
 */
export function derivationIssue(proof: unknown, fact: DerivedFact): DerivationIssue | null {
  if (fact.value_kind !== "flow") return "not_a_flow";
  const checked = validateDerivationProof(proof);
  if (!checked.ok) return "invalid_derivation";
  if (hashCanonical("derivation", checked.value) !== fact.token_proof_hash) return "proof_hash_mismatch";
  const [own, ...others] = checked.value.terms;
  if (own!.sign !== "+" || others.some((term) => term.sign !== "-")) return "own_term_sign";
  if (own!.source.source_id.toLowerCase() !== fact.source_id.toLowerCase()) return "own_term_source";
  if (own!.end !== fact.period.end) return "own_term_end";
  if (fact.period.start === null || !tilesBefore(own!.start, fact.period.start, others)) return "periods_not_contiguous";
  if (checked.value.terms.some((term) => term.fiscal_year !== fact.period.fiscal_year)) return "fiscal_year_mismatch";
  const sum = derivationValue(checked.value);
  if (sum === null) return "invalid_derivation";
  const value = fact.value_text === null ? null : parseDerivedDecimalText(fact.value_text);
  if (value === null || !value.ok || compareExactDecimals(sum, value.value) !== 0) return "value_mismatch";
  if (others.some((term) => !(term.source.filed < own!.source.filed))) return "own_term_not_last_filed";
  return null;
}

// The terms cover [from, until) with no gap or overlap.
function tilesBefore(from: IsoDate, until: IsoDate, terms: DerivationProofV1["terms"]): boolean {
  let next = dayNumber(from);
  for (const term of [...terms].sort((a, b) => dayNumber(a.start) - dayNumber(b.start))) {
    if (dayNumber(term.start) !== next || dayNumber(term.end) < next) return false;
    next = dayNumber(term.end) + 1;
  }
  return next === dayNumber(until);
}
