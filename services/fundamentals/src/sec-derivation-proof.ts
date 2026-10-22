import { DERIVATION_PROOF_VERSION, type DerivationProofV1 } from "../../financial-core/src/contracts.ts";
import { resolveMetricDefinition } from "../../financial-core/src/definitions.ts";
import { derivationIssue, derivationValue, type DerivationIssue } from "../../financial-core/src/derivation.ts";
import { canonicalDecimalString } from "../../financial-core/src/exact-decimal.ts";
import {
  isDiscreteQuarterDuration,
  secTokenLocator,
  secTokenProofHash,
  sourceIdForAccession,
  type SecConceptValue,
  type SecDerivation,
  type SecSourceToken,
  type SecValueLocation,
} from "./sec-edgar.ts";

export type SecDerivedLine =
  | Readonly<{ status: "unproven"; sum: string; issue: DerivationIssue }>
  | Readonly<{ status: "proven"; sum: string; proof: DerivationProofV1; at: SecValueLocation; locator: string }>;

// Null when the line is not a catalogued flow, which nothing reads as derived,
// or cannot be summed exactly (an input without its token). A refused proof
// leaves the line unproven: it never fails the filing.
export function secDerivedLine(
  cik: number,
  fact: Readonly<{ source_id: string; period_start: string | null; period_end: string; fiscal_year: number }>,
  metricKey: string,
  derivation: SecDerivation,
): SecDerivedLine | null {
  const value_kind = resolveMetricDefinition(metricKey)?.value_kind ?? null;
  if (value_kind !== "flow") return null;
  const proof = secDerivationProof(cik, derivation);
  const exact = proof && derivationValue(proof);
  if (!proof || !exact) return null;
  const sum = canonicalDecimalString(exact);
  const period = { start: fact.period_start, end: fact.period_end, fiscal_year: fact.fiscal_year };
  const issue = derivationIssue(proof, { value_kind, source_id: fact.source_id, value_text: sum, period });
  if (issue !== null) return { status: "unproven", sum, issue };
  const own = proof.terms[0]!.source;
  const at: SecValueLocation = { concept: derivation.concept, unit: derivation.unit, accn: own.accession, form: own.form, filed: own.filed, start: fact.period_start, end: fact.period_end };
  const locator = `sec_edgar:derivation:CIK${String(cik).padStart(10, "0")}#${at.concept}|${at.unit}|${at.accn}|${at.start ?? ""}..${at.end}`;
  return { status: "proven", sum, proof, at, locator };
}

function secDerivationProof(cik: number, { concept, unit, minuend, subtrahends }: SecDerivation): DerivationProofV1 | null {
  const terms: DerivationProofV1["terms"] = [];
  for (const [sign, value] of [["+", minuend] as const, ...subtrahends.map((value) => ["-", value] as const)]) {
    if (value.val_token === undefined || value.start === undefined) return null;
    const token: SecSourceToken = { token: value.val_token, concept, unit, accn: value.accn, form: value.form, filed: value.filed, start: value.start, end: value.end };
    terms.push({
      sign,
      span: value.fp === "FY" ? "fiscal_year" : isDiscreteQuarterDuration(value) ? "quarter" : "year_to_date",
      fiscal_year: value.fy,
      fiscal_period: derivedFromPeriod(value),
      start: value.start,
      end: value.end,
      raw_token: value.val_token,
      token_proof_hash: secTokenProofHash(cik, token),
      source: { source_id: sourceIdForAccession(value.accn), accession: value.accn, form: value.form, filed: value.filed, locator: secTokenLocator(cik, token) },
    });
  }
  return { version: DERIVATION_PROOF_VERSION, concept, unit, terms };
}

// The selectors derive only from a fiscal year and its first three quarters.
function derivedFromPeriod({ fp, accn }: SecConceptValue): DerivationProofV1["terms"][number]["fiscal_period"] {
  if (fp === "FY" || fp === "Q1" || fp === "Q2" || fp === "Q3") return fp;
  throw new Error(`sec_edgar derivation input ${accn} has fiscal period ${fp}`);
}
