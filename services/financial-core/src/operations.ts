// Approved financial operations (catalog v1). Each takes typed operands and
// returns either an exact value or a named gap. An operand's value is always an
// exact rational; the published decimal (possibly policy-rounded) is derived
// only when building the payload. Incompatibility is never normalized away.
// Binding contradictions (wrong subject/metric, value x scale != native) are
// integrity failures and throw; graph evaluation decides their blast radius.

import type {
  BoundFinancialInputV1,
  ChangeNode,
  GapDisposition,
  LocalId,
  MarginNode,
  OperationKind,
  PredicatePayload,
  RankingPayload,
  RatioNode,
  ReasonCode,
  ReportedMetricNode,
  SubjectSlot,
  TrailingSumNode,
  ValuePayload,
  VersionTag,
} from "./contracts.ts";
import { MARGIN_NUMERATORS, resolveMetricDefinition, resolveRatioDefinition, type MetricValueKind } from "./definitions.ts";
import { measurementIncompatibility, type Measurement, type MeasurementReason } from "./dimensions.ts";
import { canonicalDecimalString, parseDerivedDecimalText, parseFinancialDecimal } from "./exact-decimal.ts";
import { classifyDuration, comparePeriodEnds, dayNumber, periodsContiguous, periodsIdentical, periodsOverlap, type PeriodIdentity } from "./periods.ts";
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
} from "./rational.ts";

/**
 * What a value measures: an approved catalog definition plus the approved
 * operations applied to it, in order. Two operands are comparable only when
 * their measures are identical.
 */
export type MeasureIdentity = {
  metric_key: string;
  definition_version: VersionTag;
  derivations: ReadonlyArray<{ operation: OperationKind; operation_version: VersionTag }>;
};

export type FinancialOperand = {
  node_id: LocalId;
  value: ExactRational;
  subject_slot: LocalId;
  measure: MeasureIdentity;
  value_kind: MetricValueKind | "derived";
  period: PeriodIdentity;
  measurement: Measurement;
};

export type OperationGap = { ok: false; disposition: GapDisposition; reason_code: ReasonCode; explanation: string };
export type OperandOutcome = { ok: true; operand: FinancialOperand; payload: ValuePayload } | OperationGap;
export type PredicateOutcome = { ok: true; operand: null; payload: PredicatePayload | RankingPayload } | OperationGap;
export type OperationOutcome = OperandOutcome | PredicateOutcome;

export class FinancialIntegrityError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "FinancialIntegrityError";
    this.code = code;
  }
}

const REASON_DISPOSITIONS: Readonly<Record<ReasonCode, GapDisposition>> = {
  missing_input: "missing",
  stale_input: "missing",
  publication_time_unknown: "missing",
  precision_unverified: "missing",
  conflicting_evidence: "incompatible",
  reconciliation_required: "incompatible",
  incompatible_period: "incompatible",
  incompatible_unit: "incompatible",
  incompatible_currency: "incompatible",
  incompatible_scope: "incompatible",
  incompatible_basis: "incompatible",
  incompatible_definition: "incompatible",
  non_positive_base: "not_applicable",
  zero_denominator: "undefined",
  non_positive_denominator: "not_applicable",
  non_additive_metric: "not_applicable",
  incomplete_quarter_set: "incompatible",
  overlapping_periods: "incompatible",
  unsupported_operation: "unsupported",
  unsupported_metric: "unsupported",
  unsupported_period: "unsupported",
  blocked_by_dependency: "blocked_dependency",
  incomplete_cohort: "incompatible",
  scope_limit_exceeded: "unsupported",
  numeric_limit_exceeded: "unsupported",
  precision_indeterminate: "unsupported",
  provider_error: "execution_error",
  database_error: "execution_error",
  integrity_failure: "execution_error",
  replay_version_unavailable: "unsupported",
};

export function operationGap(reason: ReasonCode, explanation: string): OperationGap {
  return { ok: false, disposition: REASON_DISPOSITIONS[reason], reason_code: reason, explanation };
}

const DURATION_KINDS: ReadonlySet<MetricValueKind> = new Set(["flow", "per_share", "share_count_average"]);

export function operandFromBoundInput(
  input: BoundFinancialInputV1,
  node: ReportedMetricNode,
  expected: { slot: SubjectSlot; definition_version: VersionTag },
): OperandOutcome {
  if (
    node.subject_slot !== expected.slot.slot_id ||
    input.subject_ref.kind !== expected.slot.subject_ref.kind ||
    input.subject_ref.id.toLowerCase() !== expected.slot.subject_ref.id.toLowerCase()
  ) {
    throw new FinancialIntegrityError("binding_subject_mismatch", `input bound to ${node.node_id} belongs to another subject`);
  }
  if (input.metric.metric_key !== node.metric_key) {
    throw new FinancialIntegrityError("binding_metric_mismatch", `input bound to ${node.node_id} is a different metric`);
  }
  const definition = resolveMetricDefinition(node.metric_key);
  if (definition === null) return operationGap("unsupported_metric", "The metric is not in the approved catalog.");
  if (input.metric.definition_version !== expected.definition_version || expected.definition_version !== definition.definition_version) {
    return operationGap("incompatible_definition", "The input uses a different metric definition version.");
  }
  if (input.unit.kind !== definition.unit_kind) return operationGap("incompatible_unit", "The input unit does not match the metric definition.");
  const wantsDuration = DURATION_KINDS.has(definition.value_kind);
  if ((input.period.kind === "duration") !== wantsDuration || (wantsDuration && input.period.start === null)) {
    return operationGap("incompatible_period", "The input period shape does not match the metric definition.");
  }
  if (definition.share_basis !== input.basis.share_basis) {
    return operationGap("incompatible_basis", "The input share basis does not match the metric definition.");
  }

  const value = boundRational(input.numeric.value, "value");
  const scale = boundRational(input.numeric.scale, "scale");
  const native = boundRational(input.numeric.native_value, "native_value");
  const token = parseFinancialDecimal(input.numeric.raw_token);
  const tokenValue = token.ok ? rationalFromDecimal(token.value) : null;
  if (tokenValue === null || !sameRational(tokenValue, value)) {
    throw new FinancialIntegrityError("token_value_mismatch", `source token for ${node.node_id} does not equal the bound value`);
  }
  if (rationalSign(scale) <= 0) throw new FinancialIntegrityError("invalid_scale", `scale for ${node.node_id} must be positive`);
  const scaled = multiplyRationals(value, scale);
  if (scaled === null) return operationGap("numeric_limit_exceeded", "The scaled value exceeds supported numeric limits.");
  if (!sameRational(scaled, native)) {
    throw new FinancialIntegrityError("scale_mismatch", `native value for ${node.node_id} is not value x scale`);
  }

  return success({
    node_id: node.node_id,
    value: native,
    subject_slot: expected.slot.slot_id,
    measure: { metric_key: definition.metric_key, definition_version: definition.definition_version, derivations: [] },
    value_kind: definition.value_kind,
    period: { ...input.period },
    measurement: {
      unit: input.unit,
      dimensions: { scope: input.dimensions.scope, members: input.dimensions.members.map((member) => ({ ...member })) },
      basis: { ...input.basis },
    },
  });
}

export function absoluteChange(node: ChangeNode, current: FinancialOperand, prior: FinancialOperand): OperandOutcome {
  const incompatible = changeIncompatibility(current, prior);
  if (incompatible) return incompatible;
  const difference = subtractRationals(current.value, prior.value);
  if (difference === null) return operationGap("numeric_limit_exceeded", "The change exceeds supported numeric limits.");
  return success(derived(node, current, difference, current.measurement));
}

export function percentChangePositiveBase(node: ChangeNode, current: FinancialOperand, prior: FinancialOperand): OperandOutcome {
  const incompatible = changeIncompatibility(current, prior);
  if (incompatible) return incompatible;
  if (rationalSign(prior.value) <= 0) return operationGap("non_positive_base", "Percent change requires a positive prior value.");
  const difference = subtractRationals(current.value, prior.value);
  const growth = difference === null ? null : divideRationals(difference, prior.value);
  if (growth === null) return operationGap("numeric_limit_exceeded", "The change exceeds supported numeric limits.");
  return success(derived(node, current, growth, { ...current.measurement, unit: { kind: "ratio" } }));
}

export function margin(node: MarginNode, numerator: FinancialOperand, revenue: FinancialOperand): OperandOutcome {
  if (numerator.measure.metric_key !== MARGIN_NUMERATORS[node.operation] || revenue.measure.metric_key !== "revenue") {
    return operationGap("incompatible_definition", "Margins use only their approved numerator over revenue.");
  }
  const incompatible = subjectMismatch(numerator, revenue) ?? measurementMismatch(numerator, revenue) ?? periodMismatch(numerator, revenue);
  if (incompatible) return incompatible;
  return quotient(node.node_id, { metric_key: node.operation, definition_version: node.operation_version, derivations: [] }, numerator, revenue);
}

export function ratio(node: RatioNode, numerator: FinancialOperand, denominator: FinancialOperand): OperandOutcome {
  const definition = resolveRatioDefinition(node.ratio_key);
  if (definition === null) return operationGap("unsupported_operation", "The ratio is not an approved metric pair.");
  if (numerator.measure.metric_key !== definition.numerator || denominator.measure.metric_key !== definition.denominator) {
    return operationGap("incompatible_definition", "The operands do not match the approved ratio definition.");
  }
  const incompatible = subjectMismatch(numerator, denominator) ?? measurementMismatch(numerator, denominator) ?? periodMismatch(numerator, denominator);
  if (incompatible) return incompatible;
  if ((numerator.period.kind === "instant") !== (definition.timing === "same_instant")) {
    return operationGap("incompatible_period", "The ratio requires a different period timing.");
  }
  return quotient(node.node_id, { metric_key: definition.ratio_key, definition_version: definition.definition_version, derivations: [] }, numerator, denominator);
}

/** Four consecutive, non-overlapping single quarters of one reported flow metric. */
export function trailingSum(node: TrailingSumNode, quarters: ReadonlyArray<FinancialOperand>): OperandOutcome {
  if (quarters.some((quarter) => quarter.value_kind !== "flow")) {
    return operationGap("non_additive_metric", "Only additive flow metrics can be summed across quarters.");
  }
  if (quarters.length !== 4) return operationGap("incomplete_quarter_set", "A trailing sum requires four consecutive quarters.");
  const [first] = quarters as [FinancialOperand, ...FinancialOperand[]];
  for (const quarter of quarters.slice(1)) {
    const incompatible = subjectMismatch(first, quarter) ?? measureMismatch(first, quarter) ?? measurementMismatch(first, quarter);
    if (incompatible) return incompatible;
  }
  if (quarters.some((quarter) => classifyDuration(quarter.period) !== "quarter")) {
    return operationGap("unsupported_period", "Only single fiscal quarters can be summed; year-to-date subtraction is not supported.");
  }
  if (new Set(quarters.map((quarter) => quarter.period.calendar_version)).size !== 1) {
    return operationGap("incompatible_period", "Quarters must share one fiscal calendar version.");
  }
  const ordered = [...quarters].sort((left, right) => dayNumber(left.period.start!) - dayNumber(right.period.start!));
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!.period;
    const next = ordered[index]!.period;
    if (periodsOverlap(previous, next)) return operationGap("overlapping_periods", "The quarters overlap.");
    if (!periodsContiguous(previous, next)) return operationGap("incomplete_quarter_set", "The quarters are not consecutive.");
  }
  let total: ExactRational | null = ordered[0]!.value;
  for (const quarter of ordered.slice(1)) total = total === null ? null : addRationals(total, quarter.value);
  if (total === null) return operationGap("numeric_limit_exceeded", "The sum exceeds supported numeric limits.");
  const last = ordered[ordered.length - 1]!.period;
  return success({
    ...derived(node, first, total, first.measurement),
    period: {
      kind: "duration",
      start: ordered[0]!.period.start,
      end: last.end,
      fiscal_year: last.fiscal_year,
      fiscal_period: "TTM",
      calendar_version: last.calendar_version,
    },
  });
}

// --- compatibility checks, composed per operation with `??` ---------------

export function subjectMismatch(left: FinancialOperand, right: FinancialOperand): OperationGap | null {
  return left.subject_slot === right.subject_slot ? null : operationGap("incompatible_scope", "The operands belong to different subjects.");
}

export function measureMismatch(left: FinancialOperand, right: FinancialOperand): OperationGap | null {
  const a = left.measure;
  const b = right.measure;
  const same =
    a.metric_key === b.metric_key &&
    a.definition_version === b.definition_version &&
    a.derivations.length === b.derivations.length &&
    a.derivations.every((step, index) => step.operation === b.derivations[index]!.operation && step.operation_version === b.derivations[index]!.operation_version);
  return same ? null : operationGap("incompatible_definition", "The operands use different metric definitions.");
}

const MEASUREMENT_EXPLANATIONS: Readonly<Record<MeasurementReason, string>> = {
  incompatible_unit: "The operands use different units.",
  incompatible_currency: "The operands use different currencies.",
  incompatible_scope: "The operands cover different dimensional scopes.",
  incompatible_basis: "The operands use different reporting, adjustment, or share bases.",
};

export function measurementMismatch(left: FinancialOperand, right: FinancialOperand): OperationGap | null {
  const reason = measurementIncompatibility(left.measurement, right.measurement);
  return reason === null ? null : operationGap(reason, MEASUREMENT_EXPLANATIONS[reason]);
}

function periodMismatch(left: FinancialOperand, right: FinancialOperand): OperationGap | null {
  return periodsIdentical(left.period, right.period) ? null : operationGap("incompatible_period", "The operands cover different periods.");
}

function changeIncompatibility(current: FinancialOperand, prior: FinancialOperand): OperationGap | null {
  const incompatible = subjectMismatch(current, prior) ?? measureMismatch(current, prior) ?? measurementMismatch(current, prior);
  if (incompatible) return incompatible;
  const currentShape = classifyDuration(current.period);
  if (currentShape === "other" || currentShape !== classifyDuration(prior.period)) {
    return operationGap("incompatible_period", "Changes require periods of the same kind and length.");
  }
  if (comparePeriodEnds(prior.period, current.period) >= 0) {
    return operationGap("incompatible_period", "The prior period must end before the current period.");
  }
  return null;
}

function quotient(nodeId: LocalId, measure: MeasureIdentity, numerator: FinancialOperand, denominator: FinancialOperand): OperandOutcome {
  const sign = rationalSign(denominator.value);
  if (sign === 0) return operationGap("zero_denominator", "The denominator is zero.");
  if (sign < 0) return operationGap("non_positive_denominator", "The denominator must be positive.");
  const value = divideRationals(numerator.value, denominator.value);
  if (value === null) return operationGap("numeric_limit_exceeded", "The ratio exceeds supported numeric limits.");
  return success({
    node_id: nodeId,
    value,
    subject_slot: numerator.subject_slot,
    measure,
    value_kind: "derived",
    period: numerator.period,
    measurement: { ...numerator.measurement, unit: { kind: "ratio" } },
  });
}

/** Result of applying `node` to `source`'s measure: the approved operation is appended to its lineage. */
function derived(
  node: ChangeNode | TrailingSumNode,
  source: FinancialOperand,
  value: ExactRational,
  measurement: Measurement,
): FinancialOperand {
  return {
    node_id: node.node_id,
    value,
    subject_slot: source.subject_slot,
    measure: {
      ...source.measure,
      derivations: [...source.measure.derivations, { operation: node.operation, operation_version: node.operation_version }],
    },
    value_kind: "derived",
    period: source.period,
    measurement,
  };
}

function success(operand: FinancialOperand): OperandOutcome {
  const represented = rationalToValue(operand.value);
  if (represented === null) return operationGap("numeric_limit_exceeded", "The value exceeds supported numeric limits.");
  return {
    ok: true,
    operand,
    payload: {
      kind: "value",
      value: canonicalDecimalString(represented.value),
      unit: operand.measurement.unit,
      exact: represented.exact,
      rounding: represented.rounding,
    },
  };
}

function sameRational(left: ExactRational, right: ExactRational): boolean {
  return compareRationals(left, right) === 0;
}

function boundRational(text: string, field: string): ExactRational {
  const parsed = parseDerivedDecimalText(text);
  const rational = parsed.ok ? rationalFromDecimal(parsed.value) : null;
  if (rational === null) throw new FinancialIntegrityError("invalid_numeric", `bound ${field} is not a supported decimal`);
  return rational;
}
