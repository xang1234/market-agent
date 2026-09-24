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

import {
  compareRationals,
  conservativeAvailability,
  freshnessAt,
  multiplyRationals,
  parseDerivedDecimalText,
  publicAtCutoff,
  rationalFromDecimal,
  type ExactRational,
  type IsoDateTime,
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

export type SlotSelection =
  | { status: "selected"; candidate: InputCandidate; publication: SelectedPublication }
  | { status: "gap"; reason_code: ReasonCode };

type Eligible = { candidate: InputCandidate; publication: SelectedPublication };

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
    if ("publication" in verdict) eligible.push({ candidate, publication: verdict.publication });
    else if (verdict.reason !== null) exclusions.add(verdict.reason);
  }
  if (eligible.length === 0) return gap(EXCLUSION_PRIORITY.find((reason) => exclusions.has(reason)) ?? "missing_input");

  const inPeriod = node.period.kind === "latest" ? latestPeriod(eligible, node.period.offset) : eligible;
  if (inPeriod.length === 0) return gap("missing_input");

  const disclosures = chooseDisclosure(withoutCorrected(inPeriod), requested, policy.reporting_basis);
  if (disclosures.length === 0) return gap("missing_input");

  const values = disclosures.map((entry) => nativeValue(entry.candidate));
  if (values.some((value) => value === null)) return gap("precision_unverified");
  if (values.some((value) => compareRationals(value!, values[0]!) !== 0)) return gap("conflicting_evidence");
  const chosen = [...disclosures].sort((left, right) => left.candidate.fact_id.localeCompare(right.candidate.fact_id))[0]!;

  if (freshnessAt(chosen.candidate.period.end, policy.knowledge_cutoff, policy.max_age_days) === "stale") return gap("stale_input");
  return { status: "selected", candidate: chosen.candidate, publication: chosen.publication };
}

function inRequestedPeriod(candidate: InputCandidate, selector: PeriodSelector): boolean {
  if (selector.kind === "fiscal_period") {
    return candidate.period.fiscal_year === selector.fiscal_year && candidate.period.fiscal_period === selector.fiscal_period;
  }
  return selector.period_type === "annual" ? candidate.period.fiscal_period === "FY" : candidate.period.fiscal_period !== "FY";
}

function eligibility(candidate: InputCandidate, cutoff: IsoDateTime): { publication: SelectedPublication } | { reason: ReasonCode | null } {
  const publication = earliestPublicProof(candidate, cutoff);
  if (publication === "not_yet_public") return { reason: null };
  if (publication === "unknown") return { reason: "publication_time_unknown" };
  const precision = candidate.precision;
  if (precision === null || precision.precision_class === "legacy_unverified" || precision.raw_token === null || precision.token_proof_hash === null) {
    return { reason: "precision_unverified" };
  }
  if (candidate.context === null) return { reason: "context_unverified" };
  if (candidate.unit === null) return { reason: "incompatible_unit" };
  return { publication };
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

function nativeValue(candidate: InputCandidate): ExactRational | null {
  const value = parseDerivedDecimalText(candidate.value_text);
  const scale = parseDerivedDecimalText(candidate.scale_text);
  if (!value.ok || !scale.ok) return null;
  const valueRational = rationalFromDecimal(value.value);
  const scaleRational = rationalFromDecimal(scale.value);
  return valueRational && scaleRational ? multiplyRationals(valueRational, scaleRational) : null;
}

function gap(reason: ReasonCode): SlotSelection {
  return { status: "gap", reason_code: reason };
}
