// Approved financial operations (catalog v1). Each takes typed operands with
// explicit financial context and returns either a value with exact rational
// lineage or a named gap. Incompatibility is never normalized away. Binding
// contradictions (wrong subject/metric, value x scale != native) are integrity
// failures and throw; graph execution decides their blast radius.

import type {
  BoundFinancialInputV1,
  ChangeNode,
  FinancialUnit,
  GapDisposition,
  LocalId,
  MarginNode,
  RatioNode,
  ReasonCode,
  ReportedMetricNode,
  SubjectSlot,
  TrailingSumNode,
  ValuePayload,
  VersionTag,
} from "./contracts.ts";
import { MARGIN_NUMERATORS, resolveMetricDefinition, resolveRatioDefinition, type MetricValueKind } from "./definitions.ts";
import { sameBasis, sameDimensions, unitIncompatibility, type DimensionalScope, type FinancialBasis } from "./dimensions.ts";
import {
  canonicalDecimalString,
  compareExactDecimals,
  multiplyFinancialDecimals,
  parseDerivedDecimalText,
  parseFinancialDecimal,
  type ExactDecimal,
} from "./exact-decimal.ts";
import { classifyDuration, comparePeriodEnds, dayNumber, periodsContiguous, periodsIdentical, periodsOverlap, type PeriodIdentity } from "./periods.ts";
import {
  addRationals,
  divideRationals,
  rationalFromDecimal,
  rationalSign,
  rationalToValue,
  subtractRationals,
  type ExactRational,
} from "./rational.ts";

export type OperandContext = {
  subject_slot: LocalId;
  metric_key: string;
  definition_version: VersionTag;
  value_kind: MetricValueKind | "derived";
  additive: boolean;
  period: PeriodIdentity;
  prior_period: PeriodIdentity | null;
  dimensions: DimensionalScope;
  basis: FinancialBasis;
};

export type FinancialOperand = {
  node_id: LocalId;
  unit: FinancialUnit;
  /** Published representation; rounded by the numeric policy when `exact` is false. */
  value: ExactDecimal;
  exact: boolean;
  /** Exact lineage for predicates; null only when it could not be kept within limits. */
  rational: ExactRational | null;
  context: OperandContext;
};

export type OperationGap = { ok: false; disposition: GapDisposition; reason_code: ReasonCode; explanation: string };
export type OperandOutcome = { ok: true; operand: FinancialOperand; payload: ValuePayload } | OperationGap;

export class FinancialIntegrityError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "FinancialIntegrityError";
    this.code = code;
  }
}

const REASON_DISPOSITIONS: Partial<Record<ReasonCode, GapDisposition>> = {
  missing_input: "missing",
  stale_input: "missing",
  publication_time_unknown: "missing",
  precision_unverified: "missing",
  zero_denominator: "undefined",
  non_positive_base: "not_applicable",
  non_positive_denominator: "not_applicable",
  non_additive_metric: "not_applicable",
  unsupported_operation: "unsupported",
  unsupported_metric: "unsupported",
  unsupported_period: "unsupported",
  numeric_limit_exceeded: "unsupported",
  precision_indeterminate: "unsupported",
  blocked_by_dependency: "blocked_dependency",
  provider_error: "execution_error",
  database_error: "execution_error",
};

/** Maps a reason to its disposition; unlisted reasons are incompatibilities. */
export function dispositionFor(reason: ReasonCode): GapDisposition {
  return REASON_DISPOSITIONS[reason] ?? "incompatible";
}

export function operationGap(reason: ReasonCode, explanation: string): OperationGap {
  return { ok: false, disposition: dispositionFor(reason), reason_code: reason, explanation };
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

  const value = requireDecimal(input.numeric.value, "value");
  const scale = requireDecimal(input.numeric.scale, "scale");
  const native = requireDecimal(input.numeric.native_value, "native_value");
  const token = parseFinancialDecimal(input.numeric.raw_token);
  if (!token.ok || compareExactDecimals(token.value, value) !== 0) {
    throw new FinancialIntegrityError("token_value_mismatch", `source token for ${node.node_id} does not equal the bound value`);
  }
  if (scale.coefficient <= 0n) throw new FinancialIntegrityError("invalid_scale", `scale for ${node.node_id} must be positive`);
  const scaled = multiplyFinancialDecimals(value, scale);
  if (!scaled.ok) return operationGap("numeric_limit_exceeded", "The scaled value exceeds supported numeric limits.");
  if (compareExactDecimals(scaled.value, native) !== 0) {
    throw new FinancialIntegrityError("scale_mismatch", `native value for ${node.node_id} is not value x scale`);
  }
  const rational = rationalFromDecimal(native);
  if (rational === null) return operationGap("numeric_limit_exceeded", "The value exceeds supported numeric limits.");

  return success(node.node_id, input.unit, rational, {
    subject_slot: expected.slot.slot_id,
    metric_key: definition.metric_key,
    definition_version: definition.definition_version,
    value_kind: definition.value_kind,
    additive: definition.additive,
    period: { ...input.period },
    prior_period: null,
    dimensions: { scope: input.dimensions.scope, members: input.dimensions.members.map((member) => ({ ...member })) },
    basis: { ...input.basis },
  });
}

export function absoluteChange(node: ChangeNode, current: FinancialOperand, prior: FinancialOperand): OperandOutcome {
  const incompatible = changeIncompatibility(current, prior);
  if (incompatible) return incompatible;
  const difference = subtractRationals(exactOf(current), exactOf(prior));
  if (difference === null) return operationGap("numeric_limit_exceeded", "The change exceeds supported numeric limits.");
  return success(node.node_id, current.unit, difference, derivedContext(current, `${current.context.metric_key}:absolute_change`, prior.context.period));
}

export function percentChangePositiveBase(node: ChangeNode, current: FinancialOperand, prior: FinancialOperand): OperandOutcome {
  const incompatible = changeIncompatibility(current, prior);
  if (incompatible) return incompatible;
  const base = exactOf(prior);
  if (rationalSign(base) <= 0) return operationGap("non_positive_base", "Percent change requires a positive prior value.");
  const difference = subtractRationals(exactOf(current), base);
  const growth = difference === null ? null : divideRationals(difference, base);
  if (growth === null) return operationGap("numeric_limit_exceeded", "The change exceeds supported numeric limits.");
  return success(node.node_id, { kind: "ratio" }, growth, derivedContext(current, `${current.context.metric_key}:percent_change`, prior.context.period));
}

export function margin(node: MarginNode, numerator: FinancialOperand, revenue: FinancialOperand): OperandOutcome {
  if (numerator.context.metric_key !== MARGIN_NUMERATORS[node.operation] || revenue.context.metric_key !== "revenue") {
    return operationGap("incompatible_definition", "Margins use only their approved numerator over revenue.");
  }
  const incompatible = contextIncompatibility(numerator, revenue, { sameSubject: true, sameMetric: false, period: "identical" });
  if (incompatible) return incompatible;
  return quotient(node.node_id, node.operation, numerator, revenue);
}

export function ratio(node: RatioNode, numerator: FinancialOperand, denominator: FinancialOperand): OperandOutcome {
  const definition = resolveRatioDefinition(node.ratio_key);
  if (definition === null) return operationGap("unsupported_operation", "The ratio is not an approved metric pair.");
  if (numerator.context.metric_key !== definition.numerator || denominator.context.metric_key !== definition.denominator) {
    return operationGap("incompatible_definition", "The operands do not match the approved ratio definition.");
  }
  const incompatible = contextIncompatibility(numerator, denominator, { sameSubject: true, sameMetric: false, period: "identical" });
  if (incompatible) return incompatible;
  const wantsInstant = definition.timing === "same_instant";
  if ((numerator.context.period.kind === "instant") !== wantsInstant) {
    return operationGap("incompatible_period", "The ratio requires a different period timing.");
  }
  return quotient(node.node_id, definition.ratio_key, numerator, denominator);
}

export function trailingSum(node: TrailingSumNode, quarters: ReadonlyArray<FinancialOperand>): OperandOutcome {
  if (quarters.some((quarter) => quarter.context.value_kind !== "flow" || !quarter.context.additive)) {
    return operationGap("non_additive_metric", "Only additive flow metrics can be summed across quarters.");
  }
  if (quarters.length !== 4) return operationGap("incomplete_quarter_set", "A trailing sum requires four consecutive quarters.");
  const [first] = quarters;
  for (const quarter of quarters.slice(1)) {
    const incompatible = contextIncompatibility(first!, quarter, { sameSubject: true, sameMetric: true, period: "none" });
    if (incompatible) return incompatible;
  }
  if (quarters.some((quarter) => classifyDuration(quarter.context.period) !== "quarter")) {
    return operationGap("unsupported_period", "Only single fiscal quarters can be summed; year-to-date subtraction is not supported.");
  }
  if (new Set(quarters.map((quarter) => quarter.context.period.calendar_version)).size !== 1) {
    return operationGap("incompatible_period", "Quarters must share one fiscal calendar version.");
  }
  const ordered = [...quarters].sort((left, right) => dayNumber(left.context.period.start!) - dayNumber(right.context.period.start!));
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!.context.period;
    const next = ordered[index]!.context.period;
    if (periodsOverlap(previous, next)) return operationGap("overlapping_periods", "The quarters overlap.");
    if (!periodsContiguous(previous, next)) return operationGap("incomplete_quarter_set", "The quarters are not consecutive.");
  }
  let total: ExactRational | null = exactOf(ordered[0]!);
  for (const quarter of ordered.slice(1)) total = total === null ? null : addRationals(total, exactOf(quarter));
  if (total === null) return operationGap("numeric_limit_exceeded", "The sum exceeds supported numeric limits.");
  const last = ordered[ordered.length - 1]!.context.period;
  return success(node.node_id, first!.unit, total, {
    ...first!.context,
    additive: false,
    period: {
      kind: "duration",
      start: ordered[0]!.context.period.start,
      end: last.end,
      fiscal_year: last.fiscal_year,
      fiscal_period: "TTM",
      calendar_version: last.calendar_version,
    },
    prior_period: null,
  });
}

export type ContextRequirements = {
  sameSubject: boolean;
  sameMetric: boolean;
  /** identical: full period identity; same_dates: kind/start/end; none: not compared. */
  period: "identical" | "same_dates" | "none";
};

/** Named incompatibility between two operands, checked in a fixed order. */
export function contextIncompatibility(left: FinancialOperand, right: FinancialOperand, requirements: ContextRequirements): OperationGap | null {
  if (requirements.sameSubject ? left.context.subject_slot !== right.context.subject_slot : left.context.subject_slot === right.context.subject_slot) {
    return operationGap("incompatible_scope", requirements.sameSubject ? "The operands belong to different subjects." : "A cohort cannot include the same subject twice.");
  }
  if (
    requirements.sameMetric &&
    (left.context.metric_key !== right.context.metric_key || left.context.definition_version !== right.context.definition_version)
  ) {
    return operationGap("incompatible_definition", "The operands use different metric definitions.");
  }
  const unit = unitIncompatibility(left.unit, right.unit);
  if (unit) return operationGap(unit, unit === "incompatible_currency" ? "The operands use different currencies." : "The operands use different units.");
  if (!sameDimensions(left.context.dimensions, right.context.dimensions)) {
    return operationGap("incompatible_scope", "The operands cover different dimensional scopes.");
  }
  if (!sameBasis(left.context.basis, right.context.basis)) {
    return operationGap("incompatible_basis", "The operands use different reporting, adjustment, or share bases.");
  }
  const periodMismatch =
    requirements.period === "identical"
      ? !periodsIdentical(left.context.period, right.context.period)
      : requirements.period === "same_dates"
        ? left.context.period.kind !== right.context.period.kind ||
          left.context.period.start !== right.context.period.start ||
          left.context.period.end !== right.context.period.end
        : false;
  if (periodMismatch) return operationGap("incompatible_period", "The operands cover different periods.");
  return null;
}

export function exactOf(operand: FinancialOperand): ExactRational {
  if (operand.rational === null) throw new FinancialIntegrityError("missing_lineage", `operand ${operand.node_id} has no exact lineage`);
  return operand.rational;
}

function changeIncompatibility(current: FinancialOperand, prior: FinancialOperand): OperationGap | null {
  const incompatible = contextIncompatibility(current, prior, { sameSubject: true, sameMetric: true, period: "none" });
  if (incompatible) return incompatible;
  const currentShape = classifyDuration(current.context.period);
  if (currentShape === "other" || currentShape !== classifyDuration(prior.context.period)) {
    return operationGap("incompatible_period", "Changes require periods of the same kind and length.");
  }
  if (comparePeriodEnds(prior.context.period, current.context.period) >= 0) {
    return operationGap("incompatible_period", "The prior period must end before the current period.");
  }
  return null;
}

function quotient(nodeId: LocalId, metricKey: string, numerator: FinancialOperand, denominator: FinancialOperand): OperandOutcome {
  const base = exactOf(denominator);
  const sign = rationalSign(base);
  if (sign === 0) return operationGap("zero_denominator", "The denominator is zero.");
  if (sign < 0) return operationGap("non_positive_denominator", "The denominator must be positive.");
  const value = divideRationals(exactOf(numerator), base);
  if (value === null) return operationGap("numeric_limit_exceeded", "The ratio exceeds supported numeric limits.");
  return success(nodeId, { kind: "ratio" }, value, derivedContext(numerator, metricKey, null));
}

function derivedContext(source: FinancialOperand, metricKey: string, priorPeriod: PeriodIdentity | null): OperandContext {
  return {
    ...source.context,
    metric_key: metricKey,
    definition_version: `${metricKey}.v1`,
    value_kind: "derived",
    additive: false,
    prior_period: priorPeriod,
  };
}

function success(nodeId: LocalId, unit: FinancialUnit, rational: ExactRational, context: OperandContext): OperandOutcome {
  const represented = rationalToValue(rational);
  if (represented === null) return operationGap("numeric_limit_exceeded", "The value exceeds supported numeric limits.");
  const operand: FinancialOperand = {
    node_id: nodeId,
    unit,
    value: represented.value,
    exact: represented.exact,
    rational,
    context,
  };
  return {
    ok: true,
    operand,
    payload: {
      kind: "value",
      value: canonicalDecimalString(represented.value),
      unit,
      exact: represented.exact,
      rounding: represented.rounding,
    },
  };
}

function requireDecimal(text: string, field: string): ExactDecimal {
  const parsed = parseDerivedDecimalText(text);
  if (!parsed.ok) throw new FinancialIntegrityError("invalid_numeric", `bound ${field} is not a supported decimal`);
  return parsed.value;
}
