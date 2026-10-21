// Deterministic public-information input selection for one reported-metric
// slot. Pure: candidates arrive already authorized; nothing here reads the
// clock, the database, or a model.
//
// 1. Keep candidates for the exact metric and requested fiscal period.
// 2. Eligibility, per candidate, in order: publicly available by the cutoff
//    (conservative, source-version-bound proof), proven precision, explicit
//    financial context, contract-expressible unit.
// 3. "Latest" names one period per subject in a plan: the offset-th newest
//    period in which any of the subject's latest nodes of that period type has
//    an eligible candidate. A node without a candidate there is a gap; an
//    older period is never substituted.
// 4. An eligible extraction correction replaces the fact it corrects.
// 5. as_reported takes the original disclosure; as_restated takes, among the
//    economic restatements public by the cutoff, the one filed last, else the
//    original. An unverified restatement public by the cutoff is a gap for
//    as_restated: it may restate the original or only recast it for a split.
//    Publication proof only gates eligibility: an SEC proof is when a download
//    saw the filing, so an older 10-K ingested later proves later.
// 6. Equal values tie-break by fact id; differing values are a conflict —
//    identifier order never chooses financial truth.
// 7. Freshness is measured to the cutoff.
// 8. An as-filed value binds restated to its listing's reference date, the
//    cutoff dated in the listing's time zone, from the listing's split
//    history, or is a gap when that history is unknown.
// 9. An instant share count is a filing's count as of its own date, not a
//    statement period's figure (#444). It is current only while it is the
//    latest filing's: a node takes the newest filing filed by the cutoff,
//    whatever its form, apart from the plan's statement periods, and any
//    other count it names is stale, as is one dated more than
//    SHARE_COUNT_MAX_AGE_DAYS before the cutoff. A count that covers part of
//    the registrant's shares, one of several its filing lists, has an
//    incompatible scope.
// 10. A split near an instant share count's date leaves its basis unknown,
//    so it is a gap: one within SHARE_COUNT_SPLIT_WINDOW_DAYS of that date,
//    or after it and on or before the filing date.
//
// A selection is a proven input: the chosen candidate with its proofs and
// context narrowed to non-null, and its numerics parsed exactly once.

import {
  canonicalDecimalString,
  compareRationals,
  conservativeAvailability,
  dayNumber,
  freshnessAt,
  multiplyRationals,
  parseDerivedDecimalText,
  publicAtCutoff,
  rationalFromDecimal,
  rationalToValue,
  resolveMetricDefinition,
  restateToReference,
  splitHistoryCovers,
  splitReferenceDate,
  type DecimalString,
  type ExactRational,
  type FinancialUnit,
  type IsoDate,
  type IsoDateTime,
  type LocalId,
  type MetricKey,
  type ProvenPrecisionClass,
  type PeriodSelector,
  type ReasonCode,
  type RecordedSplit,
  type ReportedMetricNode,
  type ReportingBasis,
  type SplitAdjustmentV2,
} from "../../financial-core/src/index.ts";
import type { InputCandidate, SplitHistory } from "./ports.ts";

export const SELECTION_POLICY_VERSION = "public-information-selection.v4";

/** A large accelerated filer's filings are due about 112 days apart at most, so an older count is likely superseded. */
export const SHARE_COUNT_MAX_AGE_DAYS = 130;

/** A split's shares are distributed days before its ex-date, the date a listing's splits carry, so a count this near one may be on either basis. */
export const SHARE_COUNT_SPLIT_WINDOW_DAYS = 7;

/** Whether the metric is an instant share count, dated by its own date (rule 9). */
export function isShareCount(metricKey: MetricKey): boolean {
  return resolveMetricDefinition(metricKey)?.value_kind === "share_count";
}

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

/** One reported period, as `end|fiscal_period|fiscal_year`; a descending sort is newest first. */
export type PeriodKey = string & { readonly __brand: "PeriodKey" };

/** A shared latest period, null when there is none, or the gap of a group whose period cannot be known. */
export type LatestPeriod = PeriodKey | null | Readonly<{ unresolved: ReasonCode }>;

// `incomplete` marks a slot whose page was truncated or not read: it may hold a
// newer period than the others, so its group's latest period cannot be known.
type LatestSlot = Readonly<{ node: ReportedMetricNode; candidates: ReadonlyArray<InputCandidate>; incomplete?: ReasonCode }>;

/**
 * The period each latest node resolves to, shared per subject and period type:
 * the offset-th newest period with an eligible candidate in any of the slots.
 * Null when there is no such period; unresolved when any slot of the group is
 * incomplete. An instant share count resolves alone (rule 9).
 */
export function sharedLatestPeriods(slots: ReadonlyArray<LatestSlot>, policy: SelectionPolicy): ReadonlyMap<LocalId, LatestPeriod> {
  const groupOf = (node: ReportedMetricNode, periodType: string) => JSON.stringify([node.subject_slot, periodType]);
  const keysByGroup = new Map<string, Set<PeriodKey>>();
  const incompleteGroups = new Map<string, ReasonCode>();
  const shared = slots.filter(({ node }) => node.period.kind === "latest" && !isShareCount(node.metric_key));
  for (const { node, candidates, incomplete } of shared) {
    if (node.period.kind !== "latest") continue;
    const group = groupOf(node, node.period.period_type);
    if (incomplete !== undefined && !incompleteGroups.has(group)) incompleteGroups.set(group, incomplete);
    const keys = keysByGroup.get(group) ?? new Set();
    for (const candidate of requestedCandidates(node, candidates)) {
      if ("eligible" in eligibility(candidate, policy.knowledge_cutoff)) keys.add(periodKey(candidate));
    }
    keysByGroup.set(group, keys);
  }
  const resolved = new Map<LocalId, LatestPeriod>();
  for (const { node } of shared) {
    if (node.period.kind !== "latest") continue;
    const group = groupOf(node, node.period.period_type);
    const incomplete = incompleteGroups.get(group);
    if (incomplete !== undefined) {
      resolved.set(node.node_id, { unresolved: incomplete });
      continue;
    }
    const newestFirst = [...keysByGroup.get(group)!].sort((left, right) => right.localeCompare(left));
    resolved.set(node.node_id, newestFirst[node.period.offset] ?? null);
  }
  return resolved;
}

/**
 * Selects one slot's input. A latest node selects within `latestPeriod`, the
 * plan's shared period from `sharedLatestPeriods`; without it the node is
 * resolved alone.
 */
export function selectInput(
  node: ReportedMetricNode,
  candidates: ReadonlyArray<InputCandidate>,
  policy: SelectionPolicy,
  page: { truncated: boolean } = { truncated: false },
  latestPeriod?: LatestPeriod,
): SlotSelection {
  if (page.truncated) return gap("scope_limit_exceeded");
  // A fact has a fiscal period; only a price is selected as of the cutoff.
  if (node.period.kind === "at_cutoff") return gap("unsupported_period");
  if (isShareCount(node.metric_key)) return selectShareCount(node, candidates, policy);
  const requested = requestedCandidates(node, candidates);
  const shared = node.period.kind !== "latest" ? null
    : latestPeriod !== undefined ? latestPeriod
    : sharedLatestPeriods([{ node, candidates }], policy).get(node.node_id)!;
  if (shared !== null && typeof shared === "object") return gap(shared.unresolved);
  const period = shared;
  const inPeriod = period === null ? requested : requested.filter((candidate) => periodKey(candidate) === period);

  const eligible = eligibleAmong(inPeriod, policy.knowledge_cutoff);
  if (typeof eligible === "string") return gap(eligible);
  if (node.period.kind === "latest" && period === null) return gap("missing_input");
  return chooseAmong(eligible, requested, policy);
}

/**
 * An instant share count (rule 9): the count of the newest filing filed by
 * the cutoff, when the node's period names that filing. Its filing date is
 * the candidate's reported_at. A filing's count that is not public by the
 * cutoff leaves nothing to bind: an older filing's is superseded.
 */
function selectShareCount(node: ReportedMetricNode, candidates: ReadonlyArray<InputCandidate>, policy: SelectionPolicy): SlotSelection {
  const cutoff = Date.parse(policy.knowledge_cutoff);
  const filed = candidates.filter((candidate) =>
    candidate.metric_key === node.metric_key && candidate.reported_at !== null && Date.parse(candidate.reported_at) <= cutoff);
  const requested = filed.filter((candidate) => node.period.kind === "latest" || inRequestedPeriod(candidate, node.period));
  const latestFiled = Math.max(...filed.map((candidate) => Date.parse(candidate.reported_at!)));
  const latest = requested.filter((candidate) =>
    Date.parse(candidate.reported_at!) === latestFiled && (node.period.kind !== "latest" || node.period.offset === 0));
  if (latest.length === 0) return gap(requested.length > 0 ? "stale_input" : "missing_input");
  if (latest.some((candidate) => candidate.coverage_level !== "full")) return gap("incompatible_scope");
  const eligible = eligibleAmong(latest, policy.knowledge_cutoff);
  if (typeof eligible === "string") return gap(eligible);
  const selection = chooseAmong(eligible, candidates, policy);
  if (selection.status === "selected" && freshnessAt(selection.input.candidate.period.end, policy.knowledge_cutoff, SHARE_COUNT_MAX_AGE_DAYS) === "stale") {
    return gap("stale_input");
  }
  return selection;
}

/** The candidates eligible at the cutoff, or, when none is, the reason closest to eligibility. */
function eligibleAmong(candidates: ReadonlyArray<InputCandidate>, cutoff: IsoDateTime): Eligible[] | ReasonCode {
  const eligible: Eligible[] = [];
  const exclusions = new Set<ReasonCode>();
  for (const candidate of candidates) {
    const verdict = eligibility(candidate, cutoff);
    if ("eligible" in verdict) eligible.push(verdict.eligible);
    else if (verdict.reason !== null) exclusions.add(verdict.reason);
  }
  return eligible.length > 0 ? eligible : EXCLUSION_PRIORITY.find((reason) => exclusions.has(reason)) ?? "missing_input";
}

/** Rules 4 to 7 over a slot's eligible candidates; `requested` resolves what a correction corrects. */
function chooseAmong(eligible: ReadonlyArray<Eligible>, requested: ReadonlyArray<InputCandidate>, policy: SelectionPolicy): SlotSelection {
  const current = withoutCorrected(eligible);
  if (policy.reporting_basis === "as_restated" && current.some((entry) => disclosureLevel(entry.candidate, requested) === "unverified")) {
    return gap("restatement_unverified");
  }
  const disclosures = chooseDisclosure(current, requested, policy.reporting_basis);
  if (disclosures.length === 0) return gap("missing_input");

  const parsed = disclosures.flatMap(({ numeric, ...rest }) => (numeric === null ? [] : [{ ...rest, numeric }]));
  if (parsed.length !== disclosures.length) return gap("precision_unverified");
  if (parsed.some((entry) => compareRationals(entry.numeric.native, parsed[0]!.numeric.native) !== 0)) return gap("conflicting_evidence");
  const chosen = parsed.sort((left, right) => left.candidate.fact_id.localeCompare(right.candidate.fact_id))[0]!;

  if (freshnessAt(chosen.candidate.period.end, policy.knowledge_cutoff, policy.max_age_days) === "stale") return gap("stale_input");
  return { status: "selected", input: chosen };
}

function requestedCandidates(node: ReportedMetricNode, candidates: ReadonlyArray<InputCandidate>): InputCandidate[] {
  return candidates.filter((candidate) => candidate.metric_key === node.metric_key && inRequestedPeriod(candidate, node.period));
}

function periodKey({ period }: InputCandidate): PeriodKey {
  return `${period.end}|${period.fiscal_period}|${period.fiscal_year}` as PeriodKey;
}

function inRequestedPeriod(candidate: InputCandidate, selector: PeriodSelector): boolean {
  if (selector.kind === "fiscal_period") {
    return candidate.period.fiscal_year === selector.fiscal_year && candidate.period.fiscal_period === selector.fiscal_period;
  }
  if (selector.kind === "at_cutoff") return false;
  return selector.period_type === "annual" ? candidate.period.fiscal_period === "FY" : candidate.period.fiscal_period !== "FY";
}

export type BoundBasis =
  | Readonly<{ status: "unadjusted" }>
  | Readonly<{ status: "restated"; split_adjustment: SplitAdjustmentV2 }>
  | Readonly<{ status: "gap"; reason_code: ReasonCode }>;

export function boundBasis(selected: SelectedInput, history: SplitHistory | undefined, knowledgeCutoff: IsoDateTime): BoundBasis {
  const { context, metric_key: metricKey } = selected.candidate;
  // A split-adjusted context names no reference date, so no basis to compare it on.
  if (context.adjustment_basis !== "as_filed") {
    return context.adjustment_basis === "unadjusted" ? { status: "unadjusted" } : { status: "gap", reason_code: "context_unverified" };
  }
  if (history === undefined) return { status: "gap", reason_code: "split_history_missing" };
  if (history.status === "gap") return { status: "gap", reason_code: history.reason_code };
  const referenceDate = splitReferenceDate(knowledgeCutoff, history.timezone);
  if (!splitHistoryCovers(history.checked_at, referenceDate, history.timezone)) return { status: "gap", reason_code: "split_history_stale" };
  // A value filed after the reference date would have to be restated backward.
  if (context.as_filed_on > referenceDate) return { status: "gap", reason_code: "incompatible_basis" };
  const definition = resolveMetricDefinition(metricKey);
  if (definition === null) return { status: "gap", reason_code: "unsupported_metric" };
  if (definition.value_kind === "share_count" && splitNearCount(context.as_filed_on, selected.candidate.reported_at, history.splits)) {
    return { status: "gap", reason_code: "incompatible_basis" };
  }
  const restated = restateToReference({
    native: selected.numeric.native,
    value_kind: definition.value_kind,
    as_filed_on: context.as_filed_on,
    reference_date: referenceDate,
    listing_id: history.listing_id,
    listing_timezone: history.timezone,
    splits: history.splits,
  });
  return restated.ok ? { status: "restated", split_adjustment: restated.adjustment } : { status: "gap", reason_code: restated.reason };
}

/**
 * Whether a split leaves the basis of a share count dated `countDate` unknown
 * (rule 10): one within SHARE_COUNT_SPLIT_WINDOW_DAYS of it, or after it and
 * on or before the filing date, which the filing's statements reflect and the
 * count does not. A count with no filing date cannot rule that out.
 */
function splitNearCount(countDate: IsoDate, reportedAt: string | null, splits: ReadonlyArray<RecordedSplit>): boolean {
  if (reportedAt === null) return true;
  const from = dayNumber(countDate) - SHARE_COUNT_SPLIT_WINDOW_DAYS;
  const to = Math.max(dayNumber(countDate) + SHARE_COUNT_SPLIT_WINDOW_DAYS, dayNumber(reportedAt.slice(0, 10)));
  return splits.some((split) => dayNumber(split.execution_date) >= from && dayNumber(split.execution_date) <= to);
}

/** Whether binding could use the candidate at the cutoff: public by then, with proven precision, context, and unit, and an exact value. */
export function bindableAt(candidate: InputCandidate, cutoff: IsoDateTime): boolean {
  const verdict = eligibility(candidate, cutoff);
  return "eligible" in verdict && verdict.eligible.numeric !== null;
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
 * unverified restatements "unverified"; originals are "original"; an
 * extraction correction inherits the level of the fact it corrects (an
 * invisible target is treated as an original).
 */
function disclosureLevel(candidate: InputCandidate, all: ReadonlyArray<InputCandidate>, seen = new Set<string>()): "original" | "restated" | "unverified" {
  const relation = candidate.context?.disclosure_relation ?? "original";
  if (relation === "economic_restatement") return "restated";
  if (relation === "unverified_restatement") return "unverified";
  if (relation === "original" || candidate.supersedes === null || seen.has(candidate.fact_id)) return "original";
  const target = all.find((other) => other.fact_id === candidate.supersedes);
  return target ? disclosureLevel(target, all, new Set([...seen, candidate.fact_id])) : "original";
}

/** An extraction correction is filed when the disclosure it corrects was, as its level is that disclosure's. */
function filedAt(candidate: InputCandidate, all: ReadonlyArray<InputCandidate>, seen = new Set<string>()): string | null {
  if (candidate.context?.disclosure_relation !== "extraction_correction" || candidate.supersedes === null || seen.has(candidate.fact_id)) return candidate.reported_at;
  const target = all.find((other) => other.fact_id === candidate.supersedes);
  return target ? filedAt(target, all, new Set([...seen, candidate.fact_id])) : candidate.reported_at;
}

function chooseDisclosure(entries: ReadonlyArray<Eligible>, all: ReadonlyArray<InputCandidate>, basis: ReportingBasis): Eligible[] {
  const originals = entries.filter((entry) => disclosureLevel(entry.candidate, all) === "original");
  if (basis === "as_reported") return originals;
  const restated = entries.filter((entry) => disclosureLevel(entry.candidate, all) === "restated");
  if (restated.length === 0) return originals;
  const filed = (entry: Eligible) => Date.parse(filedAt(entry.candidate, all) ?? entry.publication.available_no_later_than);
  const latestFiled = Math.max(...restated.map(filed));
  return restated.filter((entry) => filed(entry) === latestFiled);
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
