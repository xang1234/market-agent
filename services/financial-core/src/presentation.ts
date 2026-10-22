// The certified presentation of a financial unit: every label, formatted
// number, predicate sentence, table ordering, and coverage statement a
// `financial_answer` block may show, generated deterministically from the plan
// and its committed results. There is no free-text field: a model cannot add
// "highest", "doubled", or "all" — such statements exist only as evaluated
// predicate or ranking results. Only the snapshot verifier calls this, on the
// results it just recomputed, so a block can never show a label, unit, period,
// or denominator other than the verified one; the renderer only prints it.
//
// Numbers are formatted from canonical decimals with exact arithmetic
// (half-even to display precision); the full canonical value is always
// carried alongside for tooltips and accessible text.

import { hashCanonical } from "./canonical.ts";
import type {
  ChangeNode,
  Comparison,
  CoverageState,
  DecimalString,
  FinancialPlanV1,
  FinancialUnit,
  GapDisposition,
  LocalId,
  OperationNode,
  PeriodSelector,
  ReasonCode,
  Sha256Hex,
} from "./contracts.ts";
import { FISCAL_PERIODS, operationDependencies } from "./contracts.ts";
import { coverageState } from "./coverage.ts";
import { resolveMetricDefinition, resolveRatioDefinition } from "./definitions.ts";
import { canonicalDecimalString, compareExactDecimals, parseDerivedDecimalText, type ExactDecimal } from "./exact-decimal.ts";
import { dependencyClosure } from "./graph.ts";

export const FINANCIAL_PRESENTATION_VERSION = "financial-presentation.v2";
/** Answers certified before v2 keep this version: still accepted and rendered, never generated. */
export const FINANCIAL_PRESENTATION_V1 = "financial-presentation.v1";

export type PresentationLabel = Readonly<
  | { kind: "subject"; text: string; slot_id: LocalId }
  | { kind: "measure"; text: string }
  | { kind: "period"; text: string }
>;

export type PresentedPayload = Readonly<
  | { kind: "value"; text: string; full_text: string; value: DecimalString; unit: FinancialUnit; exact: boolean }
  | { kind: "predicate"; text: string; outcome: boolean }
  | { kind: "ranking"; text: string; complete: boolean; order: ReadonlyArray<Readonly<{ subject_label_id: string; rank: number }>>; leader_label_ids: ReadonlyArray<string> | null }
  | { kind: "gap"; text: string; reason_code: ReasonCode }
>;

export type PresentedResult = Readonly<{
  result_id: string;
  output_id: LocalId;
  disposition: "verified" | GapDisposition;
  /** Null when the result spans subjects (a ranking). */
  subject_label_id: string | null;
  measure_label_id: string;
  period_label_id: string;
  presented: PresentedPayload;
  result_hash: Sha256Hex;
}>;

export type Presentation = Readonly<
  | { kind: "scalar" | "predicate" | "gap"; result_id: string }
  | {
      kind: "table";
      caption: string;
      /** A column's period is null when its companies read it at different periods; each cell's result then names its own. */
      columns: ReadonlyArray<Readonly<{ column_id: string; measure_label_id: string; period_label_id: string | null }>>;
      rows: ReadonlyArray<Readonly<{ subject_label_id: string; cells: ReadonlyArray<string | null> }>>;
      /** Per column: row indexes in ascending exact-value order, rows without a value last. */
      ascending: Readonly<Record<string, ReadonlyArray<number>>>;
    }
  | { kind: "series"; subject_label_id: string; measure_label_id: string; points: ReadonlyArray<Readonly<{ period_label_id: string; result_id: string }>> }
>;

export type FinancialAnswerContent = Readonly<{
  presentation_version: string;
  template_version: string;
  run_id: string;
  unit_id: LocalId;
  knowledge_cutoff: string;
  coverage: Readonly<{ state: CoverageState; requested: number; verified: number }>;
  labels: Readonly<Record<string, PresentationLabel>>;
  results: ReadonlyArray<PresentedResult>;
  presentations: ReadonlyArray<Presentation>;
}>;

/** A committed result as persisted; drafts present with their public disposition. */
export type CommittedResult = Readonly<{
  result_id: string;
  output_id: LocalId;
  node_id: LocalId;
  disposition: "computed" | "verified" | GapDisposition;
  payload: unknown;
  result_hash: Sha256Hex;
}>;

export function presentFinancialUnit(input: {
  plan: FinancialPlanV1;
  run_id: string;
  unit_id: LocalId;
  results: ReadonlyArray<CommittedResult>;
  /** Server-resolved display names by subject slot. */
  subject_names: Readonly<Record<LocalId, string>>;
}): FinancialAnswerContent {
  const { plan } = input;
  const nodes = new Map(plan.operations.map((node) => [node.node_id, node]));
  const byOutput = new Map(input.results.map((result) => [result.output_id, result]));
  const labels = new LabelTable();
  for (const member of plan.subjects.members) {
    const name = input.subject_names[member.slot_id];
    if (name === undefined) throw new RangeError(`no display name for subject slot ${member.slot_id}`);
    labels.subject(member.slot_id, name);
  }

  const results: PresentedResult[] = plan.outputs.filter((output) => output.unit_id === input.unit_id).map((output) => {
    const result = byOutput.get(output.output_id);
    if (!result) throw new RangeError(`no committed result for output ${output.output_id}`);
    const node = nodes.get(output.node_id)!;
    const slot = subjectSlot(plan, node);
    return {
      result_id: result.result_id,
      output_id: output.output_id,
      disposition: result.disposition === "computed" ? "verified" : result.disposition,
      subject_label_id: slot === null ? null : subjectLabelId(slot),
      measure_label_id: labels.intern("measure", measureKey(plan, node), measureText(plan, node)),
      period_label_id: labels.intern("period", JSON.stringify([periodSelectors(plan, node), measuresInstant(plan, node)]), periodText(plan, node)),
      presented: presentPayload(plan, node, result.payload, labels.entries),
      result_hash: result.result_hash,
    };
  });

  const verified = results.filter((result) => result.disposition === "verified").length;
  return {
    presentation_version: FINANCIAL_PRESENTATION_VERSION,
    template_version: plan.presentation_template_version,
    run_id: input.run_id,
    unit_id: input.unit_id,
    knowledge_cutoff: plan.time.knowledge_cutoff,
    coverage: { state: coverageState(verified, results.length), requested: results.length, verified },
    labels: labels.entries,
    results,
    presentations: layout(plan, results, labels.entries),
  };
}

export function presentationHash(content: FinancialAnswerContent): Sha256Hex {
  return hashCanonical("presentation", content);
}

const subjectLabelId = (slot: LocalId) => `subject:${slot}`;

/**
 * Labels keyed by what they denote: one id per distinct measure (by its
 * structural definition) and per distinct period selection, so equal
 * measures share a label and layout groups by identity, never by text.
 */
class LabelTable {
  readonly entries: Record<string, PresentationLabel> = {};
  private readonly interned = new Map<string, string>();
  private readonly counts = { measure: 0, period: 0 };

  subject(slot: LocalId, name: string): void {
    this.entries[subjectLabelId(slot)] = { kind: "subject", text: name, slot_id: slot };
  }

  intern(kind: "measure" | "period", key: string, text: string): string {
    const existing = this.interned.get(`${kind}|${key}`);
    if (existing) return existing;
    const id = `${kind}:${kind[0]}${this.counts[kind]++}`;
    this.interned.set(`${kind}|${key}`, id);
    this.entries[id] = { kind, text };
    return id;
  }
}

// ---------------------------------------------------------------------------
// Layout: several subjects -> one table; one subject with a measure over
// several periods -> a series; everything else -> scalars. Predicates,
// rankings, and gaps outside a table or series stand alone.

function layout(plan: FinancialPlanV1, results: ReadonlyArray<PresentedResult>, labels: Readonly<Record<string, PresentationLabel>>): Presentation[] {
  const values = results.filter((result) => result.presented.kind === "value" || result.presented.kind === "gap");
  const subjects = new Set(values.flatMap((result) => (result.subject_label_id === null ? [] : [result.subject_label_id])));
  const placed = new Set<string>();
  const presentations: Presentation[] = [];

  if (subjects.size >= 2) {
    const tabled = values.filter((result) => result.subject_label_id !== null);
    const columnOf = tableColumns(plan, tabled);
    const columns = new Map<string, string>();
    for (const result of tabled) {
      const key = columnOf.get(result.result_id)!;
      if (!columns.has(key)) columns.set(key, result.measure_label_id);
    }
    const rows = plan.subjects.members.map((member) => subjectLabelId(member.slot_id)).filter((id) => subjects.has(id)).map((subjectId) => ({
      subject_label_id: subjectId,
      cells: [...columns.keys()].map((key) => tabled.find((result) => result.subject_label_id === subjectId && columnOf.get(result.result_id) === key)?.result_id ?? null),
    }));
    for (const row of rows) for (const cell of row.cells) if (cell) placed.add(cell);
    const byId = new Map(results.map((result) => [result.result_id, result]));
    const ascending: Record<string, number[]> = {};
    [...columns.keys()].forEach((_, index) => {
      ascending[`c${index}`] = rows
        .map((row, rowIndex) => ({ rowIndex, value: exactValue(byId.get(row.cells[index] ?? "")) }))
        .sort((left, right) => (left.value && right.value ? compareExactDecimals(left.value, right.value) : left.value ? -1 : right.value ? 1 : 0) || left.rowIndex - right.rowIndex)
        .map((entry) => entry.rowIndex);
    });
    presentations.push({
      kind: "table",
      caption: `${[...new Set([...columns.values()].map((measure) => labels[measure]!.text))].join(", ")} by company`,
      columns: [...columns.values()].map((measure_label_id, index) => {
        const periods = new Set(rows.flatMap((row) => (row.cells[index] ? [byId.get(row.cells[index])!.period_label_id] : [])));
        return { column_id: `c${index}`, measure_label_id, period_label_id: periods.size === 1 ? [...periods][0]! : null };
      }),
      rows,
      ascending,
    });
  } else {
    const groups = new Map<string, PresentedResult[]>();
    for (const result of values) groups.set(result.measure_label_id, [...(groups.get(result.measure_label_id) ?? []), result]);
    for (const group of groups.values()) {
      const [first] = group;
      if (group.length < 2 || new Set(group.map((result) => result.period_label_id)).size < 2 || first!.subject_label_id === null) continue;
      presentations.push({
        kind: "series",
        subject_label_id: first!.subject_label_id,
        measure_label_id: first!.measure_label_id,
        points: group.map((result) => ({ period_label_id: result.period_label_id, result_id: result.result_id })),
      });
      for (const result of group) placed.add(result.result_id);
    }
  }

  for (const result of results) {
    if (placed.has(result.result_id)) continue;
    const kind = result.presented.kind === "gap" ? "gap" : result.presented.kind === "value" ? "scalar" : "predicate";
    presentations.push({ kind, result_id: result.result_id });
  }
  return presentations;
}

/**
 * Each result's table column: its measure, the granularity of the period its
 * plan requested, and its rank among its company's results of that measure and
 * granularity, newest first. Companies on different fiscal calendars read one
 * line at different periods, so the period is not part of a column; the
 * requested period, never the result, decides the rank, so a gap holds its column.
 */
function tableColumns(plan: FinancialPlanV1, results: ReadonlyArray<PresentedResult>): ReadonlyMap<string, string> {
  const outputNodes = new Map(plan.outputs.map((output) => [output.output_id, output.node_id]));
  const groups = new Map<string, Array<{ result: PresentedResult; column: string; recency: number }>>();
  for (const result of results) {
    const { granularity, recency } = calendarAnchor(anchorSelector(plan, outputNodes.get(result.output_id)!));
    const column = `${result.measure_label_id}|${granularity}`;
    const group = `${result.subject_label_id}|${column}`;
    groups.set(group, [...(groups.get(group) ?? []), { result, column, recency }]);
  }
  const keys = new Map<string, string>();
  for (const group of groups.values()) {
    group.sort((left, right) => right.recency - left.recency).forEach(({ result, column }, rank) => keys.set(result.result_id, `${column}|${rank}`));
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Payload text.

function presentPayload(plan: FinancialPlanV1, node: OperationNode, payload: unknown, labels: Readonly<Record<string, PresentationLabel>>): PresentedPayload {
  const record = payload as { kind: string } & Record<string, unknown>;
  switch (record.kind) {
    case "value": {
      const unit = record.unit as FinancialUnit;
      const text = formatNodeValue(node, parseValue(record.value as string), unit);
      return { kind: "value", ...text, value: record.value as string, unit, exact: record.exact as boolean };
    }
    case "predicate": {
      const outcome = record.outcome as boolean;
      const threshold = node.operation === "threshold" ? plan.thresholds.find((entry) => entry.threshold_id === node.threshold_id) : undefined;
      const subject = node.operation === "threshold" ? node.subject : node.node_id;
      const subjectNode = plan.operations.find((entry) => entry.node_id === subject)!;
      const bound = threshold ? formatNodeValue(subjectNode, parseValue(threshold.value), threshold.unit).text : "the threshold";
      const slot = subjectSlot(plan, subjectNode);
      const who = slot === null ? "" : `${labels[subjectLabelId(slot)]!.text} — `;
      return {
        kind: "predicate",
        outcome,
        text: `${who}${measureText(plan, subjectNode)}, ${periodText(plan, subjectNode)}, ${COMPARISON_TEXT[record.comparison as Comparison]} ${bound}: ${outcome ? "yes" : "no"}`,
      };
    }
    case "ranking": {
      const slotOf = (memberNode: LocalId) => subjectSlot(plan, plan.operations.find((entry) => entry.node_id === memberNode)!);
      const order = (record.ranks as Array<{ node_id: LocalId; rank: number }>).map((entry) => ({ subject_label_id: subjectLabelId(slotOf(entry.node_id)!), rank: entry.rank }));
      const extreme = record.extreme as LocalId[] | null;
      const complete = record.complete as boolean;
      const leaderIds = complete && extreme ? extreme.map((memberNode) => subjectLabelId(slotOf(memberNode)!)) : null;
      const population = record.population as { requested: number; evaluated: number };
      const direction = (record.direction as string) === "highest" ? "Highest" : "Lowest";
      const text = leaderIds
        ? `${direction}: ${leaderIds.map((id) => labels[id]!.text).join(", ")}`
        : `Ranked ${population.evaluated} of ${population.requested} companies; no overall ${direction.toLowerCase()} can be stated for an incomplete group`;
      return { kind: "ranking", text, complete, order, leader_label_ids: leaderIds };
    }
    default: {
      const gap = record as unknown as { reason_code: ReasonCode; explanation: string };
      return { kind: "gap", text: gap.explanation, reason_code: gap.reason_code };
    }
  }
}

const COMPARISON_TEXT: Readonly<Record<Comparison, string>> = { gt: "above", gte: "at or above", lt: "below", lte: "at or below", eq: "equal to" };

// An approved ratio (leverage, cash conversion) and P/E read as multiples; margins and changes stay percentages.
function formatNodeValue(node: OperationNode, value: ExactDecimal, unit: FinancialUnit): { text: string; full_text: string } {
  return (node.operation === "ratio" || node.operation === "pe_ratio") && unit.kind === "ratio"
    ? { text: `${fixed(value, 2)}x`, full_text: `${canonicalDecimalString(value)}x` }
    : formatValue(value, unit);
}

function formatValue(value: ExactDecimal, unit: FinancialUnit): { text: string; full_text: string } {
  switch (unit.kind) {
    case "currency":
      return { text: `${unit.currency} ${fixed(value, 2)}`, full_text: `${unit.currency} ${canonicalDecimalString(value)}` };
    case "currency_per_share":
      return { text: `${unit.currency} ${fixed(value, 2)} per share`, full_text: `${unit.currency} ${canonicalDecimalString(value)} per share` };
    case "ratio": {
      const percent = { coefficient: value.coefficient, scale: value.scale - 2 };
      return { text: `${fixed(percent, 2)}%`, full_text: `${canonicalDecimalString(percent)}%` };
    }
    case "percent":
      return { text: `${fixed(value, 2)}%`, full_text: `${canonicalDecimalString(value)}%` };
    case "percentage_points":
      return { text: `${fixed(value, 2)} pp`, full_text: `${canonicalDecimalString(value)} pp` };
    case "basis_points":
      return { text: `${fixed(value, 0)} bp`, full_text: `${canonicalDecimalString(value)} bp` };
    case "shares":
      return { text: `${fixed(value, 0)} shares`, full_text: `${canonicalDecimalString(value)} shares` };
    case "count":
      return { text: fixed(value, 0), full_text: canonicalDecimalString(value) };
  }
}

/** Half-even rounding to `places` fraction digits, with thousands separators. */
export function fixed(value: ExactDecimal, places: number): string {
  let coefficient: bigint;
  if (value.scale <= places) {
    coefficient = value.coefficient * 10n ** BigInt(places - value.scale);
  } else {
    const divisor = 10n ** BigInt(value.scale - places);
    const negative = value.coefficient < 0n;
    const magnitude = negative ? -value.coefficient : value.coefficient;
    let quotient = magnitude / divisor;
    const twice = 2n * (magnitude % divisor);
    if (twice > divisor || (twice === divisor && quotient % 2n === 1n)) quotient += 1n;
    coefficient = negative ? -quotient : quotient;
  }
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString().padStart(places + 1, "0");
  const whole = digits.slice(0, digits.length - places).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  const fraction = places > 0 ? `.${digits.slice(-places)}` : "";
  const text = `${whole}${fraction}`;
  return negative && /[1-9]/u.test(text) ? `-${text}` : text;
}

function parseValue(text: string): ExactDecimal {
  const parsed = parseDerivedDecimalText(text);
  if (!parsed.ok) throw new RangeError("a committed value is not a canonical decimal");
  return parsed.value;
}

function exactValue(result: PresentedResult | undefined): ExactDecimal | null {
  return result?.presented.kind === "value" ? parseValue(result.presented.value) : null;
}

// ---------------------------------------------------------------------------
// Labels from structure.

function subjectSlot(plan: FinancialPlanV1, node: OperationNode): LocalId | null {
  if (node.operation === "reported_metric") return node.subject_slot;
  if (node.operation === "peer_compare") return null;
  const reported = [...dependencyClosure(plan, [node.node_id])]
    .map((id) => plan.operations.find((entry) => entry.node_id === id)!)
    .filter((entry) => entry.operation === "reported_metric");
  const slots = new Set(reported.map((entry) => (entry.operation === "reported_metric" ? entry.subject_slot : "")));
  return slots.size === 1 ? [...slots][0]! : null;
}

function measureText(plan: FinancialPlanV1, node: OperationNode): string {
  const of = (id: LocalId) => measureText(plan, plan.operations.find((entry) => entry.node_id === id)!);
  switch (node.operation) {
    case "reported_metric":
      return resolveMetricDefinition(node.metric_key)?.label ?? node.metric_key;
    case "gross_margin":
      return "Gross margin (gross profit / revenue)";
    case "operating_margin":
      return "Operating margin (operating income / revenue)";
    case "net_margin":
      return "Net margin (net income / revenue)";
    case "free_cash_flow":
      return "Free cash flow (OCF less PP&E cash capex)";
    case "ratio":
      return resolveRatioDefinition(node.ratio_key)?.label ?? node.ratio_key;
    case "absolute_change":
    case "percent_change_positive_base":
      return changeText(plan, node, of(node.current));
    case "trailing_sum":
      return `${of(node.quarters[0]!)}, trailing four quarters`;
    case "threshold":
      return `${of(node.subject)} threshold check`;
    case "peer_compare":
      return `${of(node.members[0]!)} ranking`;
    case "market_cap":
      return "Market capitalization (share price × shares outstanding)";
    case "pe_ratio":
      return "P/E ratio (share price / latest fiscal year diluted EPS)";
  }
}

/** The structural identity of a measure: equal keys always render the same text. */
function measureKey(plan: FinancialPlanV1, node: OperationNode): string {
  const of = (id: LocalId) => measureKey(plan, plan.operations.find((entry) => entry.node_id === id)!);
  switch (node.operation) {
    case "reported_metric":
      return `metric:${node.metric_key}`;
    case "ratio":
      return `ratio:${node.ratio_key}`;
    case "gross_margin":
    case "operating_margin":
    case "net_margin":
    case "free_cash_flow":
    case "market_cap":
    case "pe_ratio":
      return node.operation;
    case "absolute_change":
    case "percent_change_positive_base": {
      const horizon = changeHorizon(plan, node);
      return `${node.operation}(${of(node.current)})@${horizon ? `${horizon.step}${horizon.n}` : JSON.stringify([anchorSelector(plan, node.current), anchorSelector(plan, node.prior)])}`;
    }
    case "trailing_sum":
      return `trailing_sum(${of(node.quarters[0]!)})`;
    case "threshold":
      return `threshold(${of(node.subject)})`;
    case "peer_compare":
      return `peer_compare(${of(node.members[0]!)})`;
  }
}

function changeText(plan: FinancialPlanV1, node: ChangeNode, measure: string): string {
  const change = `${node.operation === "absolute_change" ? "change" : "percent change"} in ${measure}`;
  const horizon = changeHorizon(plan, node);
  const code = horizon && `${horizon.step}${horizon.n}`;
  if (code === "q1") return `Quarter-over-quarter ${change}`;
  if (code === "q4" || code === "y1") return `Year-over-year ${change}`;
  const text = `${change[0]!.toUpperCase()}${change.slice(1)}`;
  return horizon ? `${text} over ${horizon.n} ${horizon.step === "q" ? "quarters" : "fiscal years"}` : text;
}

const HORIZON_STEPS: Readonly<Record<string, "q" | "y">> = { fiscal_quarter: "q", latest_quarterly: "q", fiscal_year: "y", latest_annual: "y" };

/** How many quarters or fiscal years a change spans; null unless both its periods are on one calendar and the prior is older. */
function changeHorizon(plan: FinancialPlanV1, node: ChangeNode): { step: "q" | "y"; n: number } | null {
  const current = calendarAnchor(anchorSelector(plan, node.current));
  const prior = calendarAnchor(anchorSelector(plan, node.prior));
  const step = HORIZON_STEPS[current.granularity];
  const n = current.recency - prior.recency;
  return step && current.granularity === prior.granularity && n > 0 ? { step, n } : null;
}

/** The period a node is dated by: the first it reads. */
function anchorSelector(plan: FinancialPlanV1, nodeId: LocalId): PeriodSelector {
  return periodSelectors(plan, plan.operations.find((entry) => entry.node_id === nodeId)!)[0]!;
}

/** Where a period sits on its own calendar: within one granularity, higher recency is newer. */
function calendarAnchor(selector: PeriodSelector): { granularity: string; recency: number } {
  switch (selector.kind) {
    case "fiscal_period":
      return selector.fiscal_period === "FY"
        ? { granularity: "fiscal_year", recency: selector.fiscal_year }
        : { granularity: "fiscal_quarter", recency: selector.fiscal_year * 4 + FISCAL_PERIODS.indexOf(selector.fiscal_period) - 1 };
    case "latest":
      return { granularity: `latest_${selector.period_type}`, recency: -selector.offset };
    case "at_cutoff":
      return { granularity: "at_cutoff", recency: 0 };
  }
}

/**
 * The distinct periods a node reads, in operand order (current before prior).
 * A valuation is dated by its price: its other operand is restated to the same reference date.
 */
function periodSelectors(plan: FinancialPlanV1, node: OperationNode): PeriodSelector[] {
  const of = (id: LocalId) => plan.operations.find((candidate) => candidate.node_id === id)!;
  const all = (entry: OperationNode): PeriodSelector[] => entry.operation === "reported_metric" ? [entry.period]
    : entry.operation === "market_cap" || entry.operation === "pe_ratio" ? all(of(entry.price))
    : operationDependencies(entry).flatMap((id) => all(of(id)));
  const distinct = new Map<string, PeriodSelector>();
  for (const selector of all(node)) if (!distinct.has(JSON.stringify(selector))) distinct.set(JSON.stringify(selector), selector);
  return [...distinct.values()];
}

// A balance is a point in time: "end of FY2023", never the year's amount.
function periodText(plan: FinancialPlanV1, node: OperationNode): string {
  const instant = measuresInstant(plan, node);
  return periodSelectors(plan, node).map((selector) => (instant ? `end of ${selectorText(selector)}` : selectorText(selector))).join(" vs ");
}

/** Whether every reported value under the node is a point-in-time measure. */
function measuresInstant(plan: FinancialPlanV1, node: OperationNode): boolean {
  if (node.operation === "reported_metric") {
    const kind = resolveMetricDefinition(node.metric_key)?.value_kind;
    return kind === "balance" || kind === "share_count";
  }
  const dependencies = operationDependencies(node).map((id) => plan.operations.find((entry) => entry.node_id === id)!);
  return dependencies.length > 0 && dependencies.every((dependency) => measuresInstant(plan, dependency));
}

function selectorText(selector: PeriodSelector): string {
  if (selector.kind === "fiscal_period") {
    return selector.fiscal_period === "FY" ? `FY${selector.fiscal_year}` : `${selector.fiscal_period} FY${selector.fiscal_year}`;
  }
  if (selector.kind === "at_cutoff") return "latest known at the cutoff";
  const unit = selector.period_type === "annual" ? "fiscal year" : "fiscal quarter";
  return selector.offset === 0 ? `latest ${unit}` : `${unit} ${selector.offset} before latest`;
}
