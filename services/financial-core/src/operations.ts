// Approved financial operations (catalog v1). Each takes typed operands and
// returns either an exact value or a named gap. An operand's value is always an
// exact rational; the published decimal (possibly policy-rounded) is derived
// only when building the payload. Incompatibility is never normalized away.
// Binding contradictions (wrong subject/metric, value x scale != native) are
// integrity failures and throw; graph evaluation decides their blast radius.

import {
  BOUND_PRICE_INPUT_SCHEMA_VERSION,
  type BoundFactInputV1,
  type BoundFinancialInputV1,
  type BoundPriceInputV1,
  type ChangeNode,
  type FinancialUnit,
  type FreeCashFlowNode,
  type GapDisposition,
  type IsoDate,
  type IsoDateTime,
  type LocalId,
  type MarginNode,
  type MarketCapNode,
  type OperationKind,
  type PeRatioNode,
  type PeriodSelector,
  type PredicatePayload,
  type RankingPayload,
  type RatioNode,
  type ReasonCode,
  type ReportedMetricNode,
  type ReportingBasis,
  type SpreadNode,
  type SubjectSlot,
  type TrailingSumNode,
  type UUID,
  type ValuePayload,
  type VersionTag,
} from "./contracts.ts";
import { MARGIN_NUMERATORS, resolveMetricDefinition, resolveRatioDefinition, type MetricDefinition, type MetricValueKind } from "./definitions.ts";
import { derivationIssue } from "./derivation.ts";
import { measurementIncompatibility, unitIncompatibility, type Measurement, type MeasurementReason } from "./dimensions.ts";
import { canonicalDecimalString, parseDerivedDecimalText, parseFinancialDecimal } from "./exact-decimal.ts";
import { classifyDuration, comparePeriodEnds, dayNumber, periodDays, periodsContiguous, periodsIdentical, periodsOverlap, type PeriodIdentity } from "./periods.ts";
import { localDateOf } from "./public-time.ts";
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
import { checkSplitAdjustment } from "./split-adjustment.ts";

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
  /** The listing and reference date a reported value was restated to; null when it was not restated, and for every derived value. */
  restated_to: Readonly<{ listing_id: UUID; reference_date: IsoDate }> | null;
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
  context_unverified: "missing",
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
  split_listing_unresolved: "missing",
  split_history_missing: "missing",
  split_history_stale: "missing",
  restatement_unverified: "missing",
  source_class_not_allowed: "unsupported",
};

export function operationGap(reason: ReasonCode, explanation: string): OperationGap {
  return { ok: false, disposition: REASON_DISPOSITIONS[reason], reason_code: reason, explanation };
}

const DURATION_KINDS: ReadonlySet<MetricValueKind> = new Set(["flow", "per_share", "share_count_average"]);

type BindingExpectation = { slot: SubjectSlot; definition_version: VersionTag; knowledge_cutoff: IsoDateTime; reporting_basis: ReportingBasis };

export function operandFromBoundInput(input: BoundFinancialInputV1, node: ReportedMetricNode, expected: BindingExpectation): OperandOutcome {
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
  // A share price binds only from a price observation, and a fact never binds to it.
  if ((input.schema_version === BOUND_PRICE_INPUT_SCHEMA_VERSION) !== (definition.value_kind === "price")) {
    throw new FinancialIntegrityError("binding_variant_mismatch", `input bound to ${node.node_id} is not the kind of evidence its metric binds`);
  }
  return input.schema_version === BOUND_PRICE_INPUT_SCHEMA_VERSION
    ? priceOperand(input, node, definition, expected)
    : factOperand(input, node, definition, expected);
}

function factOperand(input: BoundFactInputV1, node: ReportedMetricNode, definition: MetricDefinition, expected: BindingExpectation): OperandOutcome {
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
  if ((input.derivation !== undefined) !== (input.precision_status === "derived_from_source_tokens")) {
    throw new FinancialIntegrityError("derivation_value_mismatch", `the precision status of ${node.node_id} does not name its derivation`);
  }
  if (input.derivation !== undefined) {
    const issue = derivationIssue(input.derivation, {
      value_kind: definition.value_kind,
      source_id: input.source.source_id,
      token_proof_hash: input.numeric.token_proof_hash,
      value_text: input.numeric.value,
      period: input.period,
    });
    if (issue !== null) throw new FinancialIntegrityError("derivation_value_mismatch", `the derivation of ${node.node_id} does not prove its bound value: ${issue}`);
  }
  if (rationalSign(scale) <= 0) throw new FinancialIntegrityError("invalid_scale", `scale for ${node.node_id} must be positive`);
  const scaled = multiplyRationals(value, scale);
  if (scaled === null) return operationGap("numeric_limit_exceeded", "The scaled value exceeds supported numeric limits.");
  if (!sameRational(scaled, native)) {
    throw new FinancialIntegrityError("scale_mismatch", `native value for ${node.node_id} is not value x scale`);
  }
  const adjustment = input.split_adjustment;
  if ((adjustment !== undefined) !== (input.basis.adjustment === "split_adjusted")) {
    throw new FinancialIntegrityError("split_basis_mismatch", `input bound to ${node.node_id} has a split-adjusted basis without its adjustment, or the reverse`);
  }
  const restated = adjustment === undefined ? null : checkSplitAdjustment(adjustment, native, definition.value_kind, expected.knowledge_cutoff);
  if (restated !== null && !restated.ok) {
    throw new FinancialIntegrityError(restated.code, `split adjustment of ${node.node_id} does not restate its value to its listing's reference date`);
  }

  return success({
    node_id: node.node_id,
    value: restated?.value ?? native,
    subject_slot: expected.slot.slot_id,
    measure: { metric_key: definition.metric_key, definition_version: definition.definition_version, derivations: [] },
    value_kind: definition.value_kind,
    period: { ...input.period },
    measurement: {
      unit: input.unit,
      dimensions: { scope: input.dimensions.scope, members: input.dimensions.members.map((member) => ({ ...member })) },
      basis: { ...input.basis },
    },
    restated_to: adjustment === undefined ? null : { listing_id: adjustment.listing_id, reference_date: adjustment.reference_date },
  });
}

/**
 * A price is the provider's token exactly, on the split basis of its trade
 * date in the listing's time zone, restated to the plan's reference date.
 */
function priceOperand(input: BoundPriceInputV1, node: ReportedMetricNode, definition: MetricDefinition, expected: BindingExpectation): OperandOutcome {
  const value = boundRational(input.numeric.value, "value");
  const token = parseFinancialDecimal(input.numeric.raw_token);
  const tokenValue = token.ok ? rationalFromDecimal(token.value) : null;
  if (tokenValue === null || !sameRational(tokenValue, value)) {
    throw new FinancialIntegrityError("token_value_mismatch", `source token for ${node.node_id} does not equal the bound value`);
  }
  const observedAt = Date.parse(input.observed_at);
  if (!(observedAt <= Date.parse(input.known_at) && Date.parse(input.known_at) <= Date.parse(expected.knowledge_cutoff))) {
    throw new FinancialIntegrityError("price_not_known_at_cutoff", `price bound to ${node.node_id} was not known between its trade and the knowledge cutoff`);
  }
  const adjustment = input.split_adjustment;
  const restated = checkSplitAdjustment(adjustment, value, definition.value_kind, expected.knowledge_cutoff);
  if (!restated.ok) {
    throw new FinancialIntegrityError(restated.code, `split adjustment of ${node.node_id} does not restate its value to its listing's reference date`);
  }
  if (adjustment.listing_id !== input.listing_id || adjustment.as_filed_on !== localDateOf(observedAt, adjustment.listing_timezone)) {
    throw new FinancialIntegrityError("split_anchor_mismatch", `split adjustment of ${node.node_id} is not anchored at its trade date on its listing`);
  }
  return success({
    node_id: node.node_id,
    value: restated.value,
    subject_slot: expected.slot.slot_id,
    measure: { metric_key: definition.metric_key, definition_version: definition.definition_version, derivations: [] },
    value_kind: definition.value_kind,
    period: { kind: "instant", start: null, end: adjustment.as_filed_on, fiscal_year: null, fiscal_period: null, calendar_version: null },
    measurement: {
      unit: input.unit,
      dimensions: { scope: "consolidated", members: [] },
      basis: { reporting: expected.reporting_basis, adjustment: "split_adjusted", share_basis: "not_applicable" },
    },
    restated_to: { listing_id: adjustment.listing_id, reference_date: adjustment.reference_date },
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

/** Annual operating cash flow less PP&E cash capex, both as reported; capex is never sign-flipped. */
export function freeCashFlow(node: FreeCashFlowNode, operatingCashFlow: FinancialOperand, capex: FinancialOperand): OperandOutcome {
  if (operatingCashFlow.measure.metric_key !== "operating_cash_flow" || capex.measure.metric_key !== "capex") {
    return operationGap("incompatible_definition", "Free cash flow uses only operating cash flow less capex.");
  }
  // A trailing sum or change keeps its metric key and can span a year; only reported values qualify.
  if (operatingCashFlow.value_kind === "derived" || capex.value_kind === "derived") {
    return operationGap("incompatible_definition", "Free cash flow v1 subtracts reported values, never derived ones.");
  }
  const incompatible = subjectMismatch(operatingCashFlow, capex) ?? measurementMismatch(operatingCashFlow, capex) ?? periodMismatch(operatingCashFlow, capex);
  if (incompatible) return incompatible;
  if (operatingCashFlow.period.fiscal_period !== "FY" || classifyDuration(operatingCashFlow.period) !== "annual") return operationGap("unsupported_period", "Free cash flow v1 is defined for a fiscal year only.");
  if (rationalSign(capex.value) < 0) {
    return operationGap("incompatible_definition", "Capex v1 is a nonnegative PP&E cash payment; a negative reported value is not one.");
  }
  const value = subtractRationals(operatingCashFlow.value, capex.value);
  if (value === null) return operationGap("numeric_limit_exceeded", "Free cash flow exceeds supported numeric limits.");
  return success({
    node_id: node.node_id,
    value,
    subject_slot: operatingCashFlow.subject_slot,
    measure: { metric_key: node.operation, definition_version: node.operation_version, derivations: [] },
    value_kind: "derived",
    period: operatingCashFlow.period,
    measurement: operatingCashFlow.measurement,
    restated_to: null,
  });
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

/**
 * A share price times shares outstanding (#444). The price is on the split
 * basis of its trade date and the cover count on that of its cover date, so
 * both must be restated to one reference date. In the price's currency.
 */
export function marketCap(node: MarketCapNode, price: FinancialOperand, shares: FinancialOperand): OperandOutcome {
  if (!isReported(price, "share_price", "price") || !isReported(shares, "shares_outstanding", "share_count")) {
    return operationGap("incompatible_definition", "Market cap multiplies a share price by shares outstanding.");
  }
  const unit = price.measurement.unit;
  if (unit.kind !== "currency_per_share" || shares.measurement.unit.kind !== "shares") {
    return operationGap("incompatible_unit", "Market cap needs a price per share and a count of shares.");
  }
  const incompatible = subjectMismatch(price, shares) ?? referenceMismatch(node, price, shares);
  if (incompatible) return incompatible;
  if (rationalSign(shares.value) <= 0) return operationGap("non_positive_base", "Market cap requires a positive share count.");
  const value = multiplyRationals(price.value, shares.value);
  if (value === null) return operationGap("numeric_limit_exceeded", "Market cap exceeds supported numeric limits.");
  return success(valuation(node, price, value, { kind: "currency", currency: unit.currency }));
}

/**
 * A share price over diluted EPS of the latest fiscal year known at the
 * cutoff (#444), both restated to one reference date. Selection decides which
 * year is latest, so the earnings node must select it. Dimensionless.
 */
export function peRatio(node: PeRatioNode, price: FinancialOperand, earnings: FinancialOperand, earningsPeriod: PeriodSelector | null): OperandOutcome {
  if (!isReported(price, "share_price", "price") || !isReported(earnings, "eps_diluted", "per_share")) {
    return operationGap("incompatible_definition", "P/E divides a share price by diluted EPS.");
  }
  const latestYear = earningsPeriod?.kind === "latest" && earningsPeriod.period_type === "annual" && earningsPeriod.offset === 0;
  if (!latestYear || earnings.period.fiscal_period !== "FY" || classifyDuration(earnings.period) !== "annual") {
    return operationGap("unsupported_period", "P/E v1 divides by the latest fiscal year's diluted EPS.");
  }
  const incompatible = subjectMismatch(price, earnings) ?? referenceMismatch(node, price, earnings) ?? unitMismatch(price, earnings);
  if (incompatible) return incompatible;
  if (rationalSign(earnings.value) <= 0) return operationGap("non_positive_denominator", "P/E requires positive diluted EPS.");
  const value = divideRationals(price.value, earnings.value);
  if (value === null) return operationGap("numeric_limit_exceeded", "P/E exceeds supported numeric limits.");
  return success(valuation(node, price, value, { kind: "ratio" }));
}

/**
 * One subject's value minus another's on one measure and measurement, each in
 * its own fiscal period (#398): a lead across fiscal calendars. A margin or
 * percentage lead is in percentage points. The result is the left subject's.
 */
export function spread(node: SpreadNode, left: FinancialOperand, right: FinancialOperand): OperandOutcome {
  if (left.subject_slot === right.subject_slot) return operationGap("incompatible_scope", "A spread is between two different subjects.");
  const incompatible = measureMismatch(left, right) ?? measurementMismatch(left, right);
  if (incompatible) return incompatible;
  const shape = classifyDuration(left.period);
  if ((shape !== "quarter" && shape !== "annual") || shape !== classifyDuration(right.period)) {
    return operationGap("incompatible_period", "A spread compares a quarter with a quarter or a year with a year.");
  }
  // Each side keeps its own fiscal calendar, so two periods are set side by
  // side only while they mostly cover the same months: ends at most half the
  // shorter period apart, sharing about half their days or more. Any two
  // calendars have periods that close, so a wider gap means one side is a
  // period ahead of the other.
  const apart = Math.abs(dayNumber(left.period.end) - dayNumber(right.period.end));
  if (2 * apart > Math.min(periodDays(left.period)!, periodDays(right.period)!)) {
    return operationGap("incompatible_period", "The two periods end more than half a period apart, so they do not cover the same months.");
  }
  const unit = left.measurement.unit;
  if (unit.kind === "ratio" && !readsAsPercentage(left)) return operationGap("unsupported_operation", "A spread of multiples is not supported.");
  const difference = subtractRationals(left.value, right.value);
  const points = difference !== null && unit.kind === "ratio" ? multiplyRationals(difference, HUNDRED) : difference;
  if (points === null) return operationGap("numeric_limit_exceeded", "The spread exceeds supported numeric limits.");
  const percentage = unit.kind === "ratio" || unit.kind === "percent";
  return success(derived(node, left, points, percentage ? { ...left.measurement, unit: { kind: "percentage_points" } } : left.measurement));
}

const HUNDRED = rationalFromDecimal({ coefficient: 100n, scale: 0 })!;

// A margin or percent change is a ratio read as a percentage; an approved ratio or P/E reads as a multiple.
function readsAsPercentage(operand: FinancialOperand): boolean {
  return Object.hasOwn(MARGIN_NUMERATORS, operand.measure.metric_key) || operand.measure.derivations.some((step) => step.operation === "percent_change_positive_base");
}

function isReported(operand: FinancialOperand, metricKey: string, valueKind: MetricValueKind): boolean {
  return operand.value_kind === valueKind && operand.measure.metric_key === metricKey;
}

/**
 * Both values restated on one listing to one reference date. A value never
 * restated may be on another split basis. One subject resolves to one listing
 * at the cutoff, so two different restatements contradict its bindings.
 */
function referenceMismatch(node: MarketCapNode | PeRatioNode, left: FinancialOperand, right: FinancialOperand): OperationGap | null {
  const [a, b] = [left.restated_to, right.restated_to];
  if (a === null || b === null) return operationGap("incompatible_basis", "Both values must be restated to the reference date of the company's listing.");
  if (a.listing_id !== b.listing_id || a.reference_date !== b.reference_date) {
    throw new FinancialIntegrityError("split_reference_mismatch", `the operands of ${node.node_id} are restated on different listings or dates`);
  }
  return null;
}

/** No currency conversion in v1: a price and a per-share value in different currencies do not divide. */
function unitMismatch(left: FinancialOperand, right: FinancialOperand): OperationGap | null {
  const reason = unitIncompatibility(left.measurement.unit, right.measurement.unit);
  return reason === null ? null : operationGap(reason, MEASUREMENT_EXPLANATIONS[reason]);
}

/** A valuation of the price's subject, dated by the price; splits do not move it. */
function valuation(node: MarketCapNode | PeRatioNode, price: FinancialOperand, value: ExactRational, unit: FinancialUnit): FinancialOperand {
  return {
    node_id: node.node_id,
    value,
    subject_slot: price.subject_slot,
    measure: { metric_key: node.operation, definition_version: node.operation_version, derivations: [] },
    value_kind: "derived",
    period: price.period,
    measurement: { ...price.measurement, unit },
    restated_to: null,
  };
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
    restated_to: null,
  });
}

/** Result of applying `node` to `source`'s measure: the approved operation is appended to its lineage. */
function derived(
  node: ChangeNode | TrailingSumNode | SpreadNode,
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
    restated_to: null,
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
