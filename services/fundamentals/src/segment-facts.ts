// Segment-fact aggregation (spec §6.3.3).
//
// Segment disclosures live in their own envelope, NOT folded into the
// consolidated income/balance/cashflow statement tables. Each envelope
// pins one axis (business or geography), one period, and one basis;
// per-segment facts retain their own source_id and as_of so a consumer
// can always trace a displayed slice back to the disclosure that
// produced it.
//
// Upstream extraction from raw filings is out of scope (P6.1). This
// module accepts already-resolved segment inputs and: cross-checks
// facts against definitions, emits coverage warnings instead of
// fabricating missing slices, and (when a consolidated total is given)
// flags reconciliation gaps.

import type { CoverageLevel, FiscalPeriod, PeriodKind, StatementBasis } from "./statement.ts";
import { freezeIssuerRef, type IssuerSubjectRef, type UUID } from "./subject-ref.ts";
import {
  assertCurrency,
  assertFiniteNumber,
  assertFinitePositive,
  assertInteger,
  assertIso8601Utc,
  assertIsoDate,
  assertMetricKey,
  assertNonEmptyString,
  assertOneOf,
  assertUuid,
} from "./validators.ts";

export type SegmentAxis = "business" | "geography";

export const SEGMENT_AXES: ReadonlyArray<SegmentAxis> = ["business", "geography"];

const SEGMENT_PERIOD_KINDS: ReadonlyArray<PeriodKind> = ["fiscal_q", "fiscal_y", "ttm"];

const FY_PERIOD_KINDS: ReadonlySet<PeriodKind> = new Set(["fiscal_y", "ttm"]);

// Native-unit values come from the same scale-normalized layer, so
// reconciliation is essentially exact for clean inputs; the epsilon
// covers ordinary float rounding when many large numbers are summed.
const RECONCILIATION_TOLERANCE_RATIO = 1e-6;

export type SegmentDefinitionInput = {
  segment_id: string;
  segment_name: string;
  parent_segment_id?: string;
  description?: string;
  definition_as_of: string;
};

export type SegmentDefinition = {
  segment_id: string;
  segment_name: string;
  parent_segment_id?: string;
  description?: string;
  definition_as_of: string;
};

export type SegmentFactInput = {
  segment_id: string;
  metric_key: string;
  metric_id: UUID;
  value_num: number | null;
  unit: string;
  currency?: string;
  scale: number;
  coverage_level: CoverageLevel;
  source_id: UUID;
  as_of: string;
};

export type SegmentFact = {
  segment_id: string;
  metric_key: string;
  metric_id: UUID;
  // Already in native units (input value_num × scale). Kept null when the
  // disclosure is missing the line so callers don't display a fabricated 0.
  value_num: number | null;
  unit: string;
  currency?: string;
  coverage_level: CoverageLevel;
  source_id: UUID;
  as_of: string;
};

export type ConsolidatedTotalInput = {
  metric_key: string;
  metric_id: UUID;
  // value_num × scale is the native-unit total. Mirrors SegmentFactInput
  // so callers don't have to remember which input is pre-scaled.
  value_num: number;
  scale: number;
  unit: string;
  currency?: string;
  source_id: UUID;
  as_of: string;
};

export type SegmentCoverageWarningCode =
  | "fact_without_definition"
  | "definition_without_fact"
  | "duplicate_segment_metric"
  | "currency_mismatch"
  | "null_segment_value"
  | "coverage_incomplete"
  | "reconciliation_gap"
  | "stale_segment_definition"
  | "unknown_parent_segment";

export type SegmentCoverageWarning = {
  code: SegmentCoverageWarningCode;
  message: string;
  segment_id?: string;
  metric_key?: string;
};

export type SegmentFreshnessPolicy = {
  as_of: string;
  max_segment_definition_age_ms?: number;
};

export type BuildSegmentFactsInput = {
  subject: IssuerSubjectRef;
  axis: SegmentAxis;
  basis: StatementBasis;
  period_kind: PeriodKind;
  period_start: string;
  period_end: string;
  fiscal_year: number;
  fiscal_period: FiscalPeriod;
  reporting_currency: string;
  as_of: string;
  segment_definitions: ReadonlyArray<SegmentDefinitionInput>;
  facts: ReadonlyArray<SegmentFactInput>;
  consolidated_totals?: ReadonlyArray<ConsolidatedTotalInput>;
  freshness_policy?: SegmentFreshnessPolicy;
};

export type SegmentFactsEnvelope = {
  subject: IssuerSubjectRef;
  family: "segment_facts";
  axis: SegmentAxis;
  basis: StatementBasis;
  period_kind: PeriodKind;
  period_start: string;
  period_end: string;
  fiscal_year: number;
  fiscal_period: FiscalPeriod;
  reporting_currency: string;
  as_of: string;
  segment_definitions: ReadonlyArray<SegmentDefinition>;
  facts: ReadonlyArray<SegmentFact>;
  coverage_warnings: ReadonlyArray<SegmentCoverageWarning>;
};

export function buildSegmentFacts(
  input: BuildSegmentFactsInput,
): SegmentFactsEnvelope {
  assertEnvelope(input);

  const definitions: SegmentDefinition[] = [];
  const definitionIds = new Set<string>();
  for (let i = 0; i < input.segment_definitions.length; i++) {
    const label = `segmentFacts.segment_definitions[${i}]`;
    const def = assertSegmentDefinition(input.segment_definitions[i], label);
    if (definitionIds.has(def.segment_id)) {
      throw new Error(`${label}.segment_id: duplicate segment_id "${def.segment_id}"`);
    }
    definitionIds.add(def.segment_id);
    definitions.push(def);
  }

  const facts: SegmentFact[] = [];
  const warnings: SegmentCoverageWarning[] = [];
  const seenSegmentMetric = new Set<string>();
  const factSegmentIds = new Set<string>();

  for (const def of definitions) {
    if (def.parent_segment_id && !definitionIds.has(def.parent_segment_id)) {
      warnings.push({
        code: "unknown_parent_segment",
        segment_id: def.segment_id,
        message: `segment "${def.segment_id}" references unknown parent_segment_id "${def.parent_segment_id}".`,
      });
    }
  }

  for (let i = 0; i < input.facts.length; i++) {
    const factInput = assertFactInput(input.facts[i], `segmentFacts.facts[${i}]`);
    factSegmentIds.add(factInput.segment_id);

    const dedupKey = `${factInput.segment_id}::${factInput.metric_key}`;
    if (seenSegmentMetric.has(dedupKey)) {
      // Both copies are kept in facts so consumers see the conflict instead
      // of us silently picking a winner — the warning forces them to choose.
      warnings.push({
        code: "duplicate_segment_metric",
        segment_id: factInput.segment_id,
        metric_key: factInput.metric_key,
        message: `segment "${factInput.segment_id}" has multiple facts for metric_key "${factInput.metric_key}"; all copies retained in facts.`,
      });
    } else {
      seenSegmentMetric.add(dedupKey);
    }

    if (!definitionIds.has(factInput.segment_id)) {
      warnings.push({
        code: "fact_without_definition",
        segment_id: factInput.segment_id,
        metric_key: factInput.metric_key,
        message: `fact references segment_id "${factInput.segment_id}" with no matching segment definition.`,
      });
    }

    if (
      factInput.currency !== undefined &&
      factInput.currency !== input.reporting_currency
    ) {
      warnings.push({
        code: "currency_mismatch",
        segment_id: factInput.segment_id,
        metric_key: factInput.metric_key,
        message: `segment "${factInput.segment_id}" metric "${factInput.metric_key}" currency ${factInput.currency} does not match envelope reporting_currency ${input.reporting_currency}.`,
      });
    }

    if (factInput.value_num === null) {
      warnings.push({
        code: "null_segment_value",
        segment_id: factInput.segment_id,
        metric_key: factInput.metric_key,
        message: `segment "${factInput.segment_id}" metric "${factInput.metric_key}" has null value_num.`,
      });
    }

    if (factInput.coverage_level !== "full") {
      warnings.push({
        code: "coverage_incomplete",
        segment_id: factInput.segment_id,
        metric_key: factInput.metric_key,
        message: `segment "${factInput.segment_id}" metric "${factInput.metric_key}" coverage is ${factInput.coverage_level}.`,
      });
    }

    facts.push(freezeFact(factInput));
  }

  for (const def of definitions) {
    if (!factSegmentIds.has(def.segment_id)) {
      warnings.push({
        code: "definition_without_fact",
        segment_id: def.segment_id,
        message: `segment "${def.segment_id}" is defined but has no fact in this envelope.`,
      });
    }
  }

  if (input.freshness_policy) {
    assertFreshnessPolicy(input.freshness_policy, "segmentFacts.freshness_policy");
    const policy = input.freshness_policy;
    if (policy.max_segment_definition_age_ms !== undefined) {
      const max = policy.max_segment_definition_age_ms;
      const policyMs = Date.parse(policy.as_of);
      // definition_as_of is a calendar date (no time component). Treat it
      // as end-of-day UTC so a same-day policy reference doesn't wrongly
      // mark a definition as up to ~24h stale.
      for (const def of definitions) {
        const ageMs = policyMs - Date.parse(def.definition_as_of + "T23:59:59.999Z");
        if (ageMs > max) {
          warnings.push({
            code: "stale_segment_definition",
            segment_id: def.segment_id,
            message: `segment "${def.segment_id}" definition_as_of ${def.definition_as_of} is older than freshness policy by ${ageMs - max}ms.`,
          });
        }
      }
    }
  }

  if (input.consolidated_totals) {
    const topLevelIds = new Set(
      definitions.filter((d) => d.parent_segment_id === undefined).map((d) => d.segment_id),
    );
    for (let i = 0; i < input.consolidated_totals.length; i++) {
      const total = assertConsolidatedTotal(
        input.consolidated_totals[i],
        `segmentFacts.consolidated_totals[${i}]`,
      );
      const reconciliationWarning = reconcile(facts, topLevelIds, total, input.reporting_currency);
      if (reconciliationWarning) warnings.push(reconciliationWarning);
    }
  }

  return Object.freeze({
    subject: freezeIssuerRef(input.subject, "segmentFacts.subject"),
    family: "segment_facts",
    axis: input.axis,
    basis: input.basis,
    period_kind: input.period_kind,
    period_start: input.period_start,
    period_end: input.period_end,
    fiscal_year: input.fiscal_year,
    fiscal_period: input.fiscal_period,
    reporting_currency: input.reporting_currency,
    as_of: input.as_of,
    segment_definitions: Object.freeze(definitions.map(freezeDefinition)),
    facts: Object.freeze(facts),
    coverage_warnings: Object.freeze(warnings.map((w) => Object.freeze({ ...w }))),
  });
}

// `topLevelIds` excludes child segments — child slices already roll up
// into their parent and would double-count if summed alongside it.
function reconcile(
  facts: ReadonlyArray<SegmentFact>,
  topLevelIds: ReadonlySet<string>,
  total: ConsolidatedTotalInput,
  reportingCurrency: string,
): SegmentCoverageWarning | null {
  if (total.currency !== undefined && total.currency !== reportingCurrency) {
    return {
      code: "currency_mismatch",
      metric_key: total.metric_key,
      message: `consolidated_total metric "${total.metric_key}" currency ${total.currency} does not match envelope reporting_currency ${reportingCurrency}.`,
    };
  }

  let sum = 0;
  let counted = 0;
  let nullEncountered = false;
  for (const fact of facts) {
    if (fact.metric_key !== total.metric_key) continue;
    if (!topLevelIds.has(fact.segment_id)) continue;
    if (fact.value_num === null) {
      nullEncountered = true;
      continue;
    }
    sum += fact.value_num;
    counted += 1;
  }

  const totalNative = total.value_num * total.scale;

  if (counted === 0 && !nullEncountered) {
    return {
      code: "reconciliation_gap",
      metric_key: total.metric_key,
      message: `metric "${total.metric_key}" has no top-level segment facts to reconcile against consolidated total ${totalNative}.`,
    };
  }

  if (nullEncountered) {
    return {
      code: "reconciliation_gap",
      metric_key: total.metric_key,
      message: `cannot reconcile metric "${total.metric_key}": one or more top-level segments have null value_num.`,
    };
  }

  const denom = Math.max(Math.abs(totalNative), 1);
  if (Math.abs(sum - totalNative) / denom > RECONCILIATION_TOLERANCE_RATIO) {
    return {
      code: "reconciliation_gap",
      metric_key: total.metric_key,
      message: `metric "${total.metric_key}" sum of top-level segments (${sum}) does not match consolidated total (${totalNative}).`,
    };
  }
  return null;
}

function freezeFact(input: SegmentFactInput): SegmentFact {
  const out: SegmentFact = {
    segment_id: input.segment_id,
    metric_key: input.metric_key,
    metric_id: input.metric_id,
    value_num: input.value_num === null ? null : input.value_num * input.scale,
    unit: input.unit,
    coverage_level: input.coverage_level,
    source_id: input.source_id,
    as_of: input.as_of,
  };
  if (input.currency !== undefined) out.currency = input.currency;
  return Object.freeze(out);
}

function freezeDefinition(def: SegmentDefinition): SegmentDefinition {
  const out: SegmentDefinition = {
    segment_id: def.segment_id,
    segment_name: def.segment_name,
    definition_as_of: def.definition_as_of,
  };
  if (def.parent_segment_id !== undefined) out.parent_segment_id = def.parent_segment_id;
  if (def.description !== undefined) out.description = def.description;
  return Object.freeze(out);
}

function assertEnvelope(input: BuildSegmentFactsInput): void {
  freezeIssuerRef(input.subject, "segmentFacts.subject");
  assertOneOf(input.axis, SEGMENT_AXES, "segmentFacts.axis");
  assertOneOf(input.basis, ["as_reported", "as_restated"], "segmentFacts.basis");
  assertOneOf(input.period_kind, SEGMENT_PERIOD_KINDS, "segmentFacts.period_kind");
  assertIsoDate(input.period_end, "segmentFacts.period_end");
  assertIsoDate(input.period_start, "segmentFacts.period_start");
  if (input.period_start >= input.period_end) {
    throw new Error(
      `segmentFacts.period_start: ${input.period_start} must be strictly before period_end ${input.period_end}`,
    );
  }
  assertInteger(input.fiscal_year, "segmentFacts.fiscal_year");
  assertOneOf(input.fiscal_period, ["FY", "Q1", "Q2", "Q3", "Q4"], "segmentFacts.fiscal_period");
  if (input.period_kind === "fiscal_q" && input.fiscal_period === "FY") {
    throw new Error(
      `segmentFacts.fiscal_period: period_kind="fiscal_q" requires Q1..Q4; received "FY"`,
    );
  }
  if (FY_PERIOD_KINDS.has(input.period_kind) && input.fiscal_period !== "FY") {
    throw new Error(
      `segmentFacts.fiscal_period: period_kind="${input.period_kind}" requires "FY"; received "${input.fiscal_period}"`,
    );
  }
  assertCurrency(input.reporting_currency, "segmentFacts.reporting_currency");
  assertIso8601Utc(input.as_of, "segmentFacts.as_of");
  if (!Array.isArray(input.segment_definitions)) {
    throw new Error("segmentFacts.segment_definitions: must be an array");
  }
  if (!Array.isArray(input.facts)) {
    throw new Error("segmentFacts.facts: must be an array");
  }
}

function assertSegmentDefinition(
  d: SegmentDefinitionInput,
  label: string,
): SegmentDefinition {
  assertNonEmptyString(d.segment_id, `${label}.segment_id`);
  assertNonEmptyString(d.segment_name, `${label}.segment_name`);
  if (d.parent_segment_id !== undefined) {
    assertNonEmptyString(d.parent_segment_id, `${label}.parent_segment_id`);
  }
  if (d.description !== undefined && typeof d.description !== "string") {
    throw new Error(`${label}.description: must be a string when present`);
  }
  assertIsoDate(d.definition_as_of, `${label}.definition_as_of`);
  return d;
}

function assertFactInput(
  f: SegmentFactInput,
  label: string,
): SegmentFactInput {
  assertNonEmptyString(f.segment_id, `${label}.segment_id`);
  assertMetricKey(f.metric_key, `${label}.metric_key`);
  assertUuid(f.metric_id, `${label}.metric_id`);
  if (f.value_num !== null) {
    assertFiniteNumber(f.value_num, `${label}.value_num`);
  }
  assertNonEmptyString(f.unit, `${label}.unit`);
  if (f.currency !== undefined) {
    assertCurrency(f.currency, `${label}.currency`);
  }
  assertFinitePositive(f.scale, `${label}.scale`);
  assertOneOf(
    f.coverage_level,
    ["full", "partial", "sparse", "unavailable"],
    `${label}.coverage_level`,
  );
  if (f.value_num === null && f.coverage_level === "full") {
    throw new Error(
      `${label}: value_num=null requires coverage_level != "full" (got "full")`,
    );
  }
  assertUuid(f.source_id, `${label}.source_id`);
  assertIso8601Utc(f.as_of, `${label}.as_of`);
  return f;
}

function assertConsolidatedTotal(
  t: ConsolidatedTotalInput,
  label: string,
): ConsolidatedTotalInput {
  assertMetricKey(t.metric_key, `${label}.metric_key`);
  assertUuid(t.metric_id, `${label}.metric_id`);
  assertFiniteNumber(t.value_num, `${label}.value_num`);
  assertFinitePositive(t.scale, `${label}.scale`);
  assertNonEmptyString(t.unit, `${label}.unit`);
  if (t.currency !== undefined) {
    assertCurrency(t.currency, `${label}.currency`);
  }
  assertUuid(t.source_id, `${label}.source_id`);
  assertIso8601Utc(t.as_of, `${label}.as_of`);
  return t;
}

function assertFreshnessPolicy(
  policy: SegmentFreshnessPolicy,
  label: string,
): void {
  assertIso8601Utc(policy.as_of, `${label}.as_of`);
  if (policy.max_segment_definition_age_ms !== undefined) {
    assertFiniteNumber(policy.max_segment_definition_age_ms, `${label}.max_segment_definition_age_ms`);
    if (policy.max_segment_definition_age_ms <= 0) {
      throw new Error(
        `${label}.max_segment_definition_age_ms: must be positive; received ${policy.max_segment_definition_age_ms}`,
      );
    }
  }
}
