// Deterministic public-information input selection for one reported-metric
// slot (design §6.2). Pure: candidates arrive already authorized; nothing here
// reads the clock, the database, or a model.
//
// 1. Keep candidates for the exact metric and requested fiscal period.
// 2. Eligibility, per candidate, in order: publicly available by the cutoff
//    (conservative, source-version-bound proof), proven precision, explicit
//    financial context, contract-expressible unit.
// 3. "Latest" resolves among eligible periods at the cutoff.
// 4. An eligible extraction correction replaces the fact it corrects.
// 5. as_reported takes the original disclosure; as_restated takes the latest
//    economic restatement public by the cutoff, else the original.
// 6. Equal values tie-break by fact id; differing values are a conflict —
//    identifier order never chooses financial truth.
// 7. Freshness is measured to the cutoff.
//
// A selection is a proven input: the chosen candidate with its proofs and
// context narrowed to non-null, and its numerics parsed exactly once.

import {
  canonicalDecimalString,
  compareRationals,
  conservativeAvailability,
  freshnessAt,
  multiplyRationals,
  parseDerivedDecimalText,
  publicAtCutoff,
  rationalFromDecimal,
  rationalToValue,
  type DecimalString,
  type ExactRational,
  type FinancialUnit,
  type IsoDateTime,
  type ProvenPrecisionClass,
  type PeriodSelector,
  type ReasonCode,
  type ReportedMetricNode,
  type ReportingBasis,
} from "../../financial-core/src/index.ts";
import type { InputCandidate } from "./ports.ts";

export const SELECTION_POLICY_VERSION = "public-information-selection.v1";

export type SelectionPolicy = {
  knowledge_cutoff: IsoDateTime;
  reporting_basis: ReportingBasis;
  max_age_days: number | null;
};

export type SelectedPublication = {
  attestation_id: string;
  /** Conservative upper bound actually relied on (end of source-local day for date proofs). */
  available_no_later_than: IsoDateTime;
  timing_precision: "instant" | "date" | "observed_public";
  source_timezone: string;
};

/** A candidate whose unit, context, and precision proof are all established. */
export type ProvenCandidate = Omit<InputCandidate, "unit" | "context" | "precision"> & Readonly<{
  unit: FinancialUnit;
  context: NonNullable<InputCandidate["context"]>;
  precision: Readonly<{
    precision_attestation_id: string;
    precision_class: ProvenPrecisionClass;
    raw_token: string;
    token_proof_hash: string;
    source_locator: string | null;
  }>;
}>;

/** Canonical stored value and scale, and their exact product (the native value). */
export type ExactNumeric = Readonly<{ value: DecimalString; scale: DecimalString; native_value: DecimalString; native: ExactRational }>;

export type SelectedInput = Readonly<{ candidate: ProvenCandidate; publication: SelectedPublication; numeric: ExactNumeric }>;

export type SlotSelection = { status: "selected"; input: SelectedInput } | { status: "gap"; reason_code: ReasonCode };

type Eligible = { candidate: ProvenCandidate; publication: SelectedPublication; numeric: ExactNumeric | null };

// When nothing is eligible, report the reason closest to eligibility.
const EXCLUSION_PRIORITY: ReadonlyArray<ReasonCode> = ["precision_unverified", "context_unverified", "incompatible_unit", "publication_time_unknown"];

export function selectInput(
  node: ReportedMetricNode,
  candidates: ReadonlyArray<InputCandidate>,
  policy: SelectionPolicy,
  page: { truncated: boolean } = { truncated: false },
): SlotSelection {
  if (page.truncated) return gap("scope_limit_exceeded");
  const requested = candidates.filter((candidate) => candidate.metric_key === node.metric_key && inRequestedPeriod(candidate, node.period));

  const eligible: Eligible[] = [];
  const exclusions = new Set<ReasonCode>();
  for (const candidate of requested) {
    const verdict = eligibility(candidate, policy.knowledge_cutoff);
    if ("eligible" in verdict) eligible.push(verdict.eligible);
    else if (verdict.reason !== null) exclusions.add(verdict.reason);
  }
  if (eligible.length === 0) return gap(EXCLUSION_PRIORITY.find((reason) => exclusions.has(reason)) ?? "missing_input");

  const inPeriod = node.period.kind === "latest" ? latestPeriod(eligible, node.period.offset) : eligible;
  if (inPeriod.length === 0) return gap("missing_input");

  const disclosures = chooseDisclosure(withoutCorrected(inPeriod), requested, policy.reporting_basis);
  if (disclosures.length === 0) return gap("missing_input");

  const parsed = disclosures.flatMap(({ numeric, ...rest }) => (numeric === null ? [] : [{ ...rest, numeric }]));
  if (parsed.length !== disclosures.length) return gap("precision_unverified");
  if (parsed.some((entry) => compareRationals(entry.numeric.native, parsed[0]!.numeric.native) !== 0)) return gap("conflicting_evidence");
  const chosen = parsed.sort((left, right) => left.candidate.fact_id.localeCompare(right.candidate.fact_id))[0]!;

  if (freshnessAt(chosen.candidate.period.end, policy.knowledge_cutoff, policy.max_age_days) === "stale") return gap("stale_input");
  return { status: "selected", input: chosen };
}

function inRequestedPeriod(candidate: InputCandidate, selector: PeriodSelector): boolean {
  if (selector.kind === "fiscal_period") {
    return candidate.period.fiscal_year === selector.fiscal_year && candidate.period.fiscal_period === selector.fiscal_period;
  }
  return selector.period_type === "annual" ? candidate.period.fiscal_period === "FY" : candidate.period.fiscal_period !== "FY";
}

function eligibility(candidate: InputCandidate, cutoff: IsoDateTime): { eligible: Eligible } | { reason: ReasonCode | null } {
  const publication = earliestPublicProof(candidate, cutoff);
  if (publication === "not_yet_public") return { reason: null };
  if (publication === "unknown") return { reason: "publication_time_unknown" };
  const { precision, context, unit } = candidate;
  if (precision === null || precision.precision_class === "legacy_unverified" || precision.raw_token === null || precision.token_proof_hash === null) {
    return { reason: "precision_unverified" };
  }
  if (context === null) return { reason: "context_unverified" };
  if (unit === null) return { reason: "incompatible_unit" };
  const proven: ProvenCandidate = {
    ...candidate,
    unit,
    context,
    precision: { ...precision, precision_class: precision.precision_class, raw_token: precision.raw_token, token_proof_hash: precision.token_proof_hash },
  };
  return { eligible: { candidate: proven, publication, numeric: exactNumeric(candidate) } };
}

/** The proof with the earliest conservative bound at or before the cutoff. */
function earliestPublicProof(candidate: InputCandidate, cutoff: IsoDateTime): SelectedPublication | "not_yet_public" | "unknown" {
  let best: SelectedPublication | null = null;
  let anyKnown = false;
  for (const proof of candidate.publication) {
    const availability = conservativeAvailability(proof.timing);
    if (!availability.known) continue;
    anyKnown = true;
    if (publicAtCutoff(proof.timing, cutoff) !== "eligible") continue;
    if (best === null || Date.parse(availability.upper_bound) < Date.parse(best.available_no_later_than)) {
      best = {
        attestation_id: proof.attestation_id,
        available_no_later_than: availability.upper_bound,
        timing_precision: proof.timing.timing_precision,
        source_timezone: proof.timing.source_timezone,
      };
    }
  }
  if (best !== null) return best;
  return anyKnown ? "not_yet_public" : "unknown";
}

/** Eligible candidates in the offset-th most recent period (by exact period end). */
function latestPeriod(eligible: ReadonlyArray<Eligible>, offset: number): Eligible[] {
  const periodKey = (entry: Eligible) => `${entry.candidate.period.end}|${entry.candidate.period.fiscal_period}|${entry.candidate.period.fiscal_year}`;
  const keys = [...new Set(eligible.map(periodKey))].sort((left, right) => right.localeCompare(left));
  const target = keys[offset];
  return target === undefined ? [] : eligible.filter((entry) => periodKey(entry) === target);
}

function withoutCorrected(entries: ReadonlyArray<Eligible>): Eligible[] {
  const corrected = new Set(
    entries
      .filter((entry) => entry.candidate.context?.disclosure_relation === "extraction_correction" && entry.candidate.supersedes !== null)
      .map((entry) => entry.candidate.supersedes!),
  );
  return entries.filter((entry) => !corrected.has(entry.candidate.fact_id));
}

/**
 * Disclosure level of a candidate: economic restatements are "restated";
 * originals are "original"; an extraction correction inherits the level of
 * the fact it corrects (an invisible target is treated as an original).
 */
function disclosureLevel(candidate: InputCandidate, all: ReadonlyArray<InputCandidate>, seen = new Set<string>()): "original" | "restated" {
  const relation = candidate.context?.disclosure_relation ?? "original";
  if (relation === "economic_restatement") return "restated";
  if (relation === "original" || candidate.supersedes === null || seen.has(candidate.fact_id)) return "original";
  const target = all.find((other) => other.fact_id === candidate.supersedes);
  return target ? disclosureLevel(target, all, new Set([...seen, candidate.fact_id])) : "original";
}

function chooseDisclosure(entries: ReadonlyArray<Eligible>, all: ReadonlyArray<InputCandidate>, basis: ReportingBasis): Eligible[] {
  const originals = entries.filter((entry) => disclosureLevel(entry.candidate, all) === "original");
  if (basis === "as_reported") return originals;
  const restated = entries.filter((entry) => disclosureLevel(entry.candidate, all) === "restated");
  if (restated.length === 0) return originals;
  const latestBound = Math.max(...restated.map((entry) => Date.parse(entry.publication.available_no_later_than)));
  return restated.filter((entry) => Date.parse(entry.publication.available_no_later_than) === latestBound);
}

/** Parses the stored value and scale once; null when either is outside the numeric limits. */
function exactNumeric(candidate: InputCandidate): ExactNumeric | null {
  const value = parseDerivedDecimalText(candidate.value_text);
  const scale = parseDerivedDecimalText(candidate.scale_text);
  if (!value.ok || !scale.ok) return null;
  const valueRational = rationalFromDecimal(value.value);
  const scaleRational = rationalFromDecimal(scale.value);
  const native = valueRational && scaleRational ? multiplyRationals(valueRational, scaleRational) : null;
  const represented = native === null ? null : rationalToValue(native);
  if (native === null || represented === null || !represented.exact) return null;
  return {
    value: canonicalDecimalString(value.value),
    scale: canonicalDecimalString(scale.value),
    native_value: canonicalDecimalString(represented.value),
    native,
  };
}

function gap(reason: ReasonCode): SlotSelection {
  return { status: "gap", reason_code: reason };
}
