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
import { operationDependencies } from "./contracts.ts";
import { coverageState } from "./coverage.ts";
import { resolveMetricDefinition, resolveRatioDefinition } from "./definitions.ts";
import { canonicalDecimalString, compareExactDecimals, parseDerivedDecimalText, type ExactDecimal } from "./exact-decimal.ts";
import { dependencyClosure } from "./graph.ts";

export const FINANCIAL_PRESENTATION_VERSION = "financial-presentation.v1";

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
      columns: ReadonlyArray<Readonly<{ column_id: string; measure_label_id: string; period_label_id: string }>>;
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
      period_label_id: labels.intern("period", JSON.stringify(periodSelectors(plan, node)), periodText(plan, node)),
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
    const columnOf = (result: PresentedResult) => `${result.measure_label_id}|${result.period_label_id}`;
    const columns = new Map<string, { measure_label_id: string; period_label_id: string }>();
    for (const result of values) {
      if (!columns.has(columnOf(result))) columns.set(columnOf(result), { measure_label_id: result.measure_label_id, period_label_id: result.period_label_id });
    }
    const rows = plan.subjects.members.map((member) => subjectLabelId(member.slot_id)).filter((id) => subjects.has(id)).map((subjectId) => ({
      subject_label_id: subjectId,
      cells: [...columns.keys()].map((key) => values.find((result) => result.subject_label_id === subjectId && columnOf(result) === key)?.result_id ?? null),
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
      caption: `${[...new Set([...columns.values()].map((column) => labels[column.measure_label_id]!.text))].join(", ")} by company`,
      columns: [...columns.values()].map((column, index) => ({ column_id: `c${index}`, ...column })),
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

// ---------------------------------------------------------------------------
// Payload text.

function presentPayload(plan: FinancialPlanV1, node: OperationNode, payload: unknown, labels: Readonly<Record<string, PresentationLabel>>): PresentedPayload {
  const record = payload as { kind: string } & Record<string, unknown>;
  switch (record.kind) {
    case "value": {
      const unit = record.unit as FinancialUnit;
      const value = parseValue(record.value as string);
      return { kind: "value", ...formatValue(value, unit), value: record.value as string, unit, exact: record.exact as boolean };
    }
    case "predicate": {
      const outcome = record.outcome as boolean;
      const threshold = node.operation === "threshold" ? plan.thresholds.find((entry) => entry.threshold_id === node.threshold_id) : undefined;
      const subject = node.operation === "threshold" ? node.subject : node.node_id;
      const subjectNode = plan.operations.find((entry) => entry.node_id === subject)!;
      const bound = threshold ? formatValue(parseValue(threshold.value), threshold.unit).text : "the threshold";
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
    case "ratio":
      return resolveRatioDefinition(node.ratio_key)?.label ?? node.ratio_key;
    case "absolute_change":
      return `Change in ${of(node.current)}`;
    case "percent_change_positive_base":
      return `Percent change in ${of(node.current)}`;
    case "trailing_sum":
      return `${of(node.quarters[0]!)}, trailing four quarters`;
    case "threshold":
      return `${of(node.subject)} threshold check`;
    case "peer_compare":
      return `${of(node.members[0]!)} ranking`;
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
      return node.operation;
    case "absolute_change":
    case "percent_change_positive_base":
      return `${node.operation}(${of(node.current)})`;
    case "trailing_sum":
      return `trailing_sum(${of(node.quarters[0]!)})`;
    case "threshold":
      return `threshold(${of(node.subject)})`;
    case "peer_compare":
      return `peer_compare(${of(node.members[0]!)})`;
  }
}

/** The distinct periods a node reads, in operand order (current before prior). */
function periodSelectors(plan: FinancialPlanV1, node: OperationNode): PeriodSelector[] {
  const all = (entry: OperationNode): PeriodSelector[] => entry.operation === "reported_metric"
    ? [entry.period]
    : operationDependencies(entry).flatMap((id) => all(plan.operations.find((candidate) => candidate.node_id === id)!));
  const distinct = new Map<string, PeriodSelector>();
  for (const selector of all(node)) if (!distinct.has(JSON.stringify(selector))) distinct.set(JSON.stringify(selector), selector);
  return [...distinct.values()];
}

function periodText(plan: FinancialPlanV1, node: OperationNode): string {
  return periodSelectors(plan, node).map(selectorText).join(" vs ");
}

function selectorText(selector: PeriodSelector): string {
  if (selector.kind === "fiscal_period") {
    return selector.fiscal_period === "FY" ? `FY${selector.fiscal_year}` : `${selector.fiscal_period} FY${selector.fiscal_year}`;
  }
  const unit = selector.period_type === "annual" ? "fiscal year" : "fiscal quarter";
  return selector.offset === 0 ? `latest ${unit}` : `${unit} ${selector.offset} before latest`;
}
