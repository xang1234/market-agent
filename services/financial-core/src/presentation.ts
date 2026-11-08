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

import { assumptionHash, hashCanonical } from "./canonical.ts";
import type {
  BoundFactInputV1,
  ChangeNode,
  Comparison,
  CoverageState,
  DecimalString,
  FinancialPlan,
  FinancialUnit,
  GapDisposition,
  LocalId,
  OperationNode,
  PeriodRankNode,
  PeriodSelector,
  PlanAssumption,
  RankingPayload,
  ReasonCode,
  Scenario,
  ScenarioEpsMultipleNode,
  Sha256Hex,
  SpreadNode,
} from "./contracts.ts";
import { FISCAL_PERIODS, operationDependencies, scenarioAssumption, SCENARIOS } from "./contracts.ts";
import { coverageState } from "./coverage.ts";
import { resolveMetricDefinition, resolveRatioDefinition } from "./definitions.ts";
import { canonicalDecimalString, compareExactDecimals, parseDerivedDecimalText, type ExactDecimal } from "./exact-decimal.ts";
import { dependencyClosure } from "./graph.ts";
import { OPERATION_REGISTRY } from "./operation-registry.ts";

export const FINANCIAL_PRESENTATION_VERSION = "financial-presentation.v2";
/** Answers certified before v2 keep this version: still accepted and rendered, never generated. */
export const FINANCIAL_PRESENTATION_V1 = "financial-presentation.v1";
/** Content with a `scenarios` presentation (#201). All other content stays v2, so no v1 plan's presentation hash moves. */
export const FINANCIAL_PRESENTATION_V3 = "financial-presentation.v3";

export const SCENARIO_DISCLOSURE = "A mechanical scenario: reported diluted EPS × a P/E you supplied. Not a price target, forecast, or recommendation.";

export type ScenarioRow = Readonly<{
  scenario: Scenario;
  assumption_id: LocalId;
  /** The multiple exactly as supplied, never rounded: "20x", "17.5x". */
  multiple_text: string;
  attribution_text: string;
  assumption_hash: Sha256Hex;
  result_id: string;
}>;

export type PresentationLabel = Readonly<
  | { kind: "subject"; text: string; slot_id: LocalId }
  | { kind: "measure"; text: string }
  | { kind: "period"; text: string }
>;

export type PresentedPayload = Readonly<
  | { kind: "value"; text: string; full_text: string; value: DecimalString; unit: FinancialUnit; exact: boolean }
  | { kind: "predicate"; text: string; outcome: boolean }
  | {
      kind: "ranking";
      text: string;
      complete: boolean;
      /** A peer ranking orders subjects; a period ranking orders one subject's periods. */
      order: ReadonlyArray<Readonly<{ subject_label_id: string; rank: number } | { period_label_id: string; rank: number }>>;
      leader_label_ids: ReadonlyArray<string> | null;
    }
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
      /** A column's period is null unless every row has a cell there and all read one period; each cell's result then names its own. */
      columns: ReadonlyArray<Readonly<{ column_id: string; measure_label_id: string; period_label_id: string | null }>>;
      rows: ReadonlyArray<Readonly<{ subject_label_id: string; cells: ReadonlyArray<string | null> }>>;
      /** Per column: row indexes in ascending exact-value order, rows without a value last. */
      ascending: Readonly<Record<string, ReadonlyArray<number>>>;
    }
  | { kind: "series"; subject_label_id: string; measure_label_id: string; points: ReadonlyArray<Readonly<{ period_label_id: string; result_id: string }>> }
  | {
      kind: "scenarios";
      /** The EPS every row multiplies, when the unit publishes it. */
      earnings_result_id: string | null;
      /** In bear, base, bull order. */
      rows: ReadonlyArray<ScenarioRow>;
      disclosure: typeof SCENARIO_DISCLOSURE;
    }
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

/** The fiscal period a reported value was bound to; a gap or a share price has none. */
export type BoundPeriod = Readonly<Pick<BoundFactInputV1["period"], "fiscal_year" | "fiscal_period" | "end">>;

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
  plan: FinancialPlan;
  run_id: string;
  unit_id: LocalId;
  results: ReadonlyArray<CommittedResult>;
  /** Server-resolved display names by subject slot. */
  subject_names: Readonly<Record<LocalId, string>>;
  /** Each bound fact's period, by its reported node. */
  periods: ReadonlyMap<LocalId, BoundPeriod>;
}): FinancialAnswerContent {
  const { plan } = input;
  const nodes = new Map(plan.operations.map((node) => [node.node_id, node]));
  const readsOf = periodReader(plan, nodes, input.periods);
  const byOutput = new Map(input.results.map((result) => [result.output_id, result]));
  const labels = new LabelTable();
  for (const member of plan.subjects.members) {
    const name = input.subject_names[member.slot_id];
    if (name === undefined) throw new RangeError(`no display name for subject slot ${member.slot_id}`);
    labels.subject(member.slot_id, name);
  }
  const names = subjectNames(labels.entries);

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
      period_label_id: labels.intern("period", periodKey(plan, node, readsOf), periodText(plan, node, names, readsOf)),
      presented: presentPayload(plan, node, result.payload, labels, readsOf),
      result_hash: result.result_hash,
    };
  });

  const verified = results.filter((result) => result.disposition === "verified").length;
  const presentations = layout(plan, nodes, results, labels.entries);
  return {
    presentation_version: presentations.some((presentation) => presentation.kind === "scenarios") ? FINANCIAL_PRESENTATION_V3 : FINANCIAL_PRESENTATION_VERSION,
    template_version: plan.presentation_template_version,
    run_id: input.run_id,
    unit_id: input.unit_id,
    knowledge_cutoff: plan.time.knowledge_cutoff,
    coverage: { state: coverageState(verified, results.length), requested: results.length, verified },
    labels: labels.entries,
    results,
    presentations,
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
// Layout: scenarios over one EPS -> one scenarios table with that EPS; then
// several subjects -> one table; one subject with a line (a measure at one
// period step and shape) over several periods of one calendar -> a series;
// everything else -> scalars. Predicates, rankings, and gaps outside a table or
// series stand alone.

function layout(plan: FinancialPlan, nodes: ReadonlyMap<LocalId, OperationNode>, results: ReadonlyArray<PresentedResult>, labels: Readonly<Record<string, PresentationLabel>>): Presentation[] {
  const nodeOf = new Map(plan.outputs.map((output) => [output.output_id, nodes.get(output.node_id)!]));
  const lines = new Map(results.flatMap((result) => {
    const node = nodeOf.get(result.output_id)!;
    return OPERATION_REGISTRY[node.operation].produces === "value" ? [[result.result_id, lineOf(plan, node, result.measure_label_id)] as const] : [];
  }));
  const presentations: Presentation[] = scenarioTables(plan, nodeOf, results);
  const placed = new Set(presentations.flatMap((presentation) =>
    presentation.kind === "scenarios" ? [...presentation.rows.map((row) => row.result_id), ...(presentation.earnings_result_id ? [presentation.earnings_result_id] : [])] : []));
  const values = results.filter((result) => lines.has(result.result_id) && !placed.has(result.result_id));
  const subjects = new Set(values.flatMap((result) => (result.subject_label_id === null ? [] : [result.subject_label_id])));

  if (subjects.size >= 2) {
    const tabled = values.filter((result) => result.subject_label_id !== null);
    const columnOf = columnKeyByResult(tabled, lines);
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
        const [period, ...others] = new Set(rows.map((row) => (row.cells[index] ? byId.get(row.cells[index])!.period_label_id : null)));
        return { column_id: `c${index}`, measure_label_id, period_label_id: others.length === 0 && period ? period : null };
      }),
      rows,
      ascending,
    });
  } else {
    const groups = new Map<string, PresentedResult[]>();
    for (const result of values) {
      const { key, anchor } = lines.get(result.result_id)!;
      const series = `${key}|${anchor.calendar}`;
      groups.set(series, [...(groups.get(series) ?? []), result]);
    }
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

/** The assumption a scenario node reads and its P/E as every surface shows it (#201, #224). */
export function scenarioMultiple(plan: FinancialPlan, node: ScenarioEpsMultipleNode): Readonly<{ assumption: PlanAssumption; multiple_text: string }> {
  const assumption = scenarioAssumption(plan, node);
  return { assumption, multiple_text: `${assumption.value}x` };
}

// A gap row stays a row: its result carries the gap's text.
function scenarioTables(plan: FinancialPlan, nodeOf: ReadonlyMap<LocalId, OperationNode>, results: ReadonlyArray<PresentedResult>): Presentation[] {
  const groups = new Map<LocalId, ScenarioRow[]>();
  for (const result of results) {
    const node = nodeOf.get(result.output_id)!;
    if (node.operation !== "scenario_eps_multiple") continue;
    const { assumption, multiple_text } = scenarioMultiple(plan, node);
    const stated = assumption.attribution.ref === plan.origin.ref ? "in this request" : "in an earlier request";
    groups.set(node.earnings, [...(groups.get(node.earnings) ?? []), {
      scenario: assumption.scenario,
      assumption_id: assumption.assumption_id,
      multiple_text,
      attribution_text: `Your assumption ${stated} (${utcMinute(assumption.attribution.captured_at)})`,
      assumption_hash: assumptionHash(assumption),
      result_id: result.result_id,
    }]);
  }
  return [...groups].map(([earnings, rows]) => ({
    kind: "scenarios",
    earnings_result_id: results.find((result) => nodeOf.get(result.output_id)!.node_id === earnings)?.result_id ?? null,
    rows: rows.sort((left, right) => SCENARIOS.indexOf(left.scenario) - SCENARIOS.indexOf(right.scenario)),
    disclosure: SCENARIO_DISCLOSURE,
  }));
}

function utcMinute(timestamp: string): string {
  return `${new Date(timestamp).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

type Line = Readonly<{ key: string; anchor: PeriodAnchor }>;

function lineOf(plan: FinancialPlan, node: OperationNode, measureLabelId: string): Line {
  const selectors = periodSelectors(plan, node);
  const anchor = periodAnchor(selectors[0]!);
  const shape = selectors.map((selector) => {
    const at = periodAnchor(selector);
    return at.calendar === anchor.calendar && at.step === anchor.step ? `${anchor.recency - at.recency}` : JSON.stringify(selector);
  }).sort();
  return { key: JSON.stringify([measureLabelId, anchor.step, shape]), anchor };
}

// A column is a line and a rank, not a period: ranked from the requested period so a gap keeps its column, and a company missing a newer period shifts left.
function columnKeyByResult(results: ReadonlyArray<PresentedResult>, lines: ReadonlyMap<string, Line>): ReadonlyMap<string, string> {
  const groups = new Map<string, Array<{ result_id: string } & Line>>();
  for (const result of results) {
    const line = lines.get(result.result_id)!;
    const group = `${result.subject_label_id}|${line.key}`;
    groups.set(group, [...(groups.get(group) ?? []), { result_id: result.result_id, ...line }]);
  }
  const keys = new Map<string, string>();
  for (const group of groups.values()) {
    group
      .sort((left, right) => right.anchor.recency - left.anchor.recency)
      .forEach(({ result_id, key }, rank) => keys.set(result_id, `${key}|${rank}`));
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Payload text.

function presentPayload(plan: FinancialPlan, node: OperationNode, payload: unknown, table: LabelTable, readsOf: ReadsOf): PresentedPayload {
  const record = payload as { kind: string } & Record<string, unknown>;
  const labels = table.entries;
  switch (record.kind) {
    case "value": {
      const unit = record.unit as FinancialUnit;
      const text = formatNodeValue(plan, node, parseValue(record.value as string), unit);
      return { kind: "value", ...text, value: record.value as string, unit, exact: record.exact as boolean };
    }
    case "predicate": {
      const outcome = record.outcome as boolean;
      const threshold = node.operation === "threshold" ? plan.thresholds.find((entry) => entry.threshold_id === node.threshold_id) : undefined;
      const subject = node.operation === "threshold" ? node.subject : node.node_id;
      const subjectNode = plan.operations.find((entry) => entry.node_id === subject)!;
      const bound = threshold ? formatNodeValue(plan, subjectNode, parseValue(threshold.value), threshold.unit).text : "the threshold";
      const slot = subjectSlot(plan, subjectNode);
      const who = slot === null ? "" : `${labels[subjectLabelId(slot)]!.text} — `;
      return {
        kind: "predicate",
        outcome,
        text: `${who}${measureText(plan, subjectNode)}, ${periodText(plan, subjectNode, subjectNames(labels), readsOf)}, ${COMPARISON_TEXT[record.comparison as Comparison]} ${bound}: ${outcome ? "yes" : "no"}`,
      };
    }
    case "ranking": {
      if (node.operation === "period_rank") return periodRanking(plan, node, record as unknown as RankingPayload, table, readsOf);
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
      const apart = gap.reason_code === "incompatible_period" ? operandPeriods(plan, node, readsOf, subjectNames(labels)) : "";
      return { kind: "gap", text: `${gap.explanation}${apart}`, reason_code: gap.reason_code };
    }
  }
}

function periodRanking(plan: FinancialPlan, node: PeriodRankNode, ranking: RankingPayload, labels: LabelTable, readsOf: ReadsOf): PresentedPayload {
  const names = subjectNames(labels.entries);
  const nodeOf = (id: LocalId) => plan.operations.find((entry) => entry.node_id === id)!;
  const periodOf = (id: LocalId) => labels.intern("period", periodKey(plan, nodeOf(id), readsOf), periodText(plan, nodeOf(id), names, readsOf));
  const leaders = (ranking.extreme ?? []).map(periodOf);
  const { requested, evaluated } = ranking.population;
  const [step, ...others] = new Set(node.members.map((id) => periodAnchor(periodSelectors(plan, nodeOf(id))[0]!).step));
  const periods = others.length === 0 && step !== "cutoff" ? { quarter: "quarters", year: "fiscal years" }[step!] : "periods";
  const measure = `${ranking.direction} ${lowercaseUnlessAcronym(measureText(plan, nodeOf(node.members[0]!)))}`;
  const leading = leaders.length > 1 ? `tie for the ${measure}` : `has the ${measure}`;
  return {
    kind: "ranking",
    text: `${new Intl.ListFormat("en").format(leaders.map((id) => labels.entries[id]!.text))} ${leading} of the ${evaluated === requested ? requested : `${evaluated} of ${requested}`} ${periods} ranked`,
    complete: ranking.complete,
    order: ranking.ranks.map((entry) => ({ period_label_id: periodOf(entry.node_id), rank: entry.rank })),
    leader_label_ids: ranking.complete ? leaders : null,
  };
}

export function lowercaseUnlessAcronym(label: string): string {
  return /\p{Ll}/u.test(label[1] ?? "") ? `${label[0]!.toLowerCase()}${label.slice(1)}` : label;
}

const COMPARISON_TEXT: Readonly<Record<Comparison, string>> = { gt: "above", gte: "at or above", lt: "below", lte: "at or below", eq: "equal to" };

function formatNodeValue(plan: FinancialPlan, node: OperationNode, value: ExactDecimal, unit: FinancialUnit): { text: string; full_text: string } {
  return unit.kind === "ratio" && readsAsMultiple(plan, node)
    ? { text: `${fixed(value, 2)}x`, full_text: `${canonicalDecimalString(value)}x` }
    : formatValue(value, unit);
}

// An approved ratio (leverage, cash conversion) and P/E are multiples, and so is a change in one; margins and percent changes are percentages.
function readsAsMultiple(plan: FinancialPlan, node: OperationNode): boolean {
  return node.operation === "absolute_change"
    ? readsAsMultiple(plan, plan.operations.find((entry) => entry.node_id === node.current)!)
    : node.operation === "ratio" || node.operation === "pe_ratio";
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

function subjectSlot(plan: FinancialPlan, node: OperationNode): LocalId | null {
  if (node.operation === "reported_metric") return node.subject_slot;
  if (node.operation === "peer_compare") return null;
  const reported = [...dependencyClosure(plan, [node.node_id])]
    .map((id) => plan.operations.find((entry) => entry.node_id === id)!)
    .filter((entry) => entry.operation === "reported_metric");
  const slots = new Set(reported.map((entry) => (entry.operation === "reported_metric" ? entry.subject_slot : "")));
  return slots.size === 1 ? [...slots][0]! : null;
}

function measureText(plan: FinancialPlan, node: OperationNode): string {
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
    case "spread":
      return `Difference in ${of(node.left)}`;
    case "period_rank":
      return `${of(node.members[0]!)} ranked across periods`;
    case "scenario_eps_multiple": {
      const assumption = scenarioAssumption(plan, node);
      return `${assumption.scenario[0]!.toUpperCase()}${assumption.scenario.slice(1)} scenario: diluted EPS × your ${assumption.value}x P/E`;
    }
  }
}

/** The structural identity of a measure: equal keys always render the same text. */
function measureKey(plan: FinancialPlan, node: OperationNode): string {
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
    case "percent_change_positive_base":
      return `${node.operation}(${of(node.current)})@${JSON.stringify(changeHorizon(plan, node) ?? changeEnds(plan, node))}`;
    case "trailing_sum":
      return `trailing_sum(${of(node.quarters[0]!)})`;
    case "threshold":
      return `threshold(${of(node.subject)})`;
    case "peer_compare":
      return `peer_compare(${of(node.members[0]!)})`;
    case "spread":
      return `spread(${of(node.left)})`;
    case "period_rank":
      return `period_rank(${of(node.members[0]!)})`;
    case "scenario_eps_multiple":
      return `scenario_eps_multiple(${node.assumption_id})`;
  }
}

function changeText(plan: FinancialPlan, node: ChangeNode, measure: string): string {
  const change = `${node.operation === "absolute_change" ? "change" : "percent change"} in ${measure}`;
  const horizon = changeHorizon(plan, node);
  const quarters = horizon && (horizon.step === "quarter" ? horizon.n : horizon.n * 4);
  if (quarters === 1) return `Quarter-over-quarter ${change}`;
  if (quarters === 4) return `Year-over-year ${change}`;
  const text = `${change[0]!.toUpperCase()}${change.slice(1)}`;
  return horizon ? `${text} over ${horizon.n} ${horizon.step === "quarter" ? "quarters" : "fiscal years"}` : text;
}

function changeHorizon(plan: FinancialPlan, node: ChangeNode): Readonly<{ step: "quarter" | "year"; n: number }> | null {
  const [current, prior] = changeEnds(plan, node).map(periodAnchor);
  const n = current.recency - prior.recency;
  return current.step !== "cutoff" && current.step === prior.step && current.calendar === prior.calendar && n > 0 ? { step: current.step, n } : null;
}

function changeEnds(plan: FinancialPlan, node: ChangeNode): PeriodSelector[] {
  return [node.current, node.prior].map((id) => periodSelectors(plan, plan.operations.find((entry) => entry.node_id === id)!)[0]!);
}

type PeriodAnchor = Readonly<{ step: "quarter" | "year" | "cutoff"; calendar: "fiscal" | "latest" | "cutoff"; recency: number }>;

// Recency orders periods only within one calendar and step; fiscal recency is positive and latest is zero or below.
function periodAnchor(selector: PeriodSelector): PeriodAnchor {
  switch (selector.kind) {
    case "fiscal_period":
      return selector.fiscal_period === "FY"
        ? { step: "year", calendar: "fiscal", recency: selector.fiscal_year }
        : { step: "quarter", calendar: "fiscal", recency: selector.fiscal_year * 4 + FISCAL_PERIODS.indexOf(selector.fiscal_period) - 1 };
    case "latest":
      return { step: selector.period_type === "annual" ? "year" : "quarter", calendar: "latest", recency: -selector.offset };
    case "at_cutoff":
      return { step: "cutoff", calendar: "cutoff", recency: 0 };
  }
}

/**
 * The distinct periods a node reads, in operand order (current before prior) with a trailing
 * sum's quarters newest first; the first one dates the node.
 * A valuation is dated by its price: its other operand is restated to the same reference date.
 */
function periodSelectors(plan: FinancialPlan, node: OperationNode): PeriodSelector[] {
  const of = (id: LocalId) => plan.operations.find((candidate) => candidate.node_id === id)!;
  const all = (entry: OperationNode): PeriodSelector[] => entry.operation === "reported_metric" ? [entry.period]
    : entry.operation === "market_cap" || entry.operation === "pe_ratio" ? all(of(entry.price))
    : entry.operation === "trailing_sum" ? entry.quarters.flatMap((id) => all(of(id))).sort((left, right) => periodAnchor(right).recency - periodAnchor(left).recency)
    : operationDependencies(entry).flatMap((id) => all(of(id)));
  const distinct = new Map<string, PeriodSelector>();
  for (const selector of all(node)) if (!distinct.has(JSON.stringify(selector))) distinct.set(JSON.stringify(selector), selector);
  return [...distinct.values()];
}

type PeriodRead = Readonly<{ selector: PeriodSelector; bound: BoundPeriod | null }>;
/** The distinct periods a node reads, in `periodSelectors` order, each with the one its values there were bound to. */
type ReadsOf = (node: OperationNode) => ReadonlyArray<PeriodRead>;

// A read names the period its values were bound to, by fiscal name and end date, whichever selector asked for it:
// "latest fiscal year" and "FY2025" both name a period that two calendars end months apart. A read has none for
// a gap, a share price, or values bound to different periods. Each node's reads are found once.
function periodReader(plan: FinancialPlan, nodes: ReadonlyMap<LocalId, OperationNode>, periods: ReadonlyMap<LocalId, BoundPeriod>): ReadsOf {
  const reads = new Map<LocalId, ReadonlyArray<PeriodRead>>();
  const readsOf = (node: OperationNode): ReadonlyArray<PeriodRead> => {
    const leaves = [...dependencyClosure(plan, [node.node_id])].flatMap((id) => {
      const leaf = nodes.get(id)!;
      return leaf.operation === "reported_metric" ? [{ selector: JSON.stringify(leaf.period), bound: periods.get(id) ?? null }] : [];
    });
    return periodSelectors(plan, node).map((selector) => {
      const [first, ...others] = leaves.filter((leaf) => leaf.selector === JSON.stringify(selector)).map((leaf) => leaf.bound);
      const agreed = first && others.every((other) => other !== null && other.end === first.end && fiscalName(other) === fiscalName(first));
      return { selector, bound: agreed ? first : null };
    });
  };
  return (node) => reads.get(node.node_id) ?? reads.set(node.node_id, readsOf(node)).get(node.node_id)!;
}

// Operands that are different measures or companies, each reading one period, bound to different ones, are each
// named with theirs. One company's measure at several periods keeps the engine's words, which already say which
// side of a change is current and why a trailing sum's quarters do not sum. A trailing sum operand reads four
// quarters, and naming one as its period would mislead.
function operandPeriods(plan: FinancialPlan, node: OperationNode, readsOf: ReadsOf, names: (slot: LocalId) => string): string {
  const operands = operationDependencies(node).map((id) => plan.operations.find((entry) => entry.node_id === id)!);
  if (new Set(operands.map((operand) => `${subjectSlot(plan, operand)} ${measureKey(plan, operand)}`)).size === 1) return "";
  if (operands.some((operand) => readsOf(operand).length !== 1)) return "";
  const bound = operands.flatMap((operand) => {
    const period = readsOf(operand)[0]!.bound;
    return period ? [{ operand, period }] : [];
  });
  if (new Set(bound.map(({ period }) => `${fiscalName(period)} ${period.end}`)).size < 2) return "";
  const across = subjectSlot(plan, node) === null;
  const owner = (operand: OperationNode, index: number) => {
    const slot = across ? subjectSlot(plan, operand) : null;
    if (slot !== null) return names(slot);
    return index === 0 ? measureText(plan, operand) : lowercaseUnlessAcronym(measureText(plan, operand));
  };
  const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);
  const named = bound.map(({ operand, period }, index) =>
    `${possessive(owner(operand, index))} ${fiscalName(period)} ${measuresInstant(plan, operand) ? "figure is as of" : "ended"} ${period.end}`);
  return ` ${new Intl.ListFormat("en").format(named)}.`;
}

// A balance is a point in time: "FY2023 (as of 2023-12-30)", or "end of FY2023" with no bound period, never the year's amount.
function periodText(plan: FinancialPlan, node: OperationNode, names: (slot: LocalId) => string, readsOf: ReadsOf): string {
  if (node.operation === "spread") return spreadSides(plan, node, (side) => `${names(side.slot)} ${periodText(plan, side.node, names, readsOf)}`).join(" minus ");
  if (node.operation === "period_rank") return windowSpan(plan, node, names, readsOf);
  const instant = measuresInstant(plan, node);
  return readsOf(node).map((read) => readText(read, instant)).join(" vs ");
}

function periodKey(plan: FinancialPlan, node: OperationNode, readsOf: ReadsOf): string {
  if (node.operation === "spread") return JSON.stringify(spreadSides(plan, node, (side) => [side.slot, periodKey(plan, side.node, readsOf)]));
  if (node.operation === "period_rank") return JSON.stringify(["window", readsOf(node).map((read) => JSON.stringify(read)).sort()]);
  return JSON.stringify([readsOf(node), measuresInstant(plan, node)]);
}

function windowSpan(plan: FinancialPlan, node: PeriodRankNode, names: (slot: LocalId) => string, readsOf: ReadsOf): string {
  const members = node.members.map((id) => plan.operations.find((entry) => entry.node_id === id)!);
  const recency = (member: OperationNode) => periodAnchor(periodSelectors(plan, member)[0]!).recency;
  const sorted = members.sort((left, right) => recency(left) - recency(right));
  return `${periodText(plan, sorted[0]!, names, readsOf)} to ${periodText(plan, sorted.at(-1)!, names, readsOf)}`;
}

function spreadSides<T>(plan: FinancialPlan, node: SpreadNode, side: (entry: { slot: LocalId; node: OperationNode }) => T): T[] {
  return [node.left, node.right].map((id) => {
    const operand = plan.operations.find((entry) => entry.node_id === id)!;
    return side({ slot: subjectSlot(plan, operand) ?? "", node: operand });
  });
}

function subjectNames(labels: Readonly<Record<string, PresentationLabel>>): (slot: LocalId) => string {
  return (slot) => labels[subjectLabelId(slot)]?.text ?? slot;
}

/** Whether every reported value under the node is a point-in-time measure. */
function measuresInstant(plan: FinancialPlan, node: OperationNode): boolean {
  if (node.operation === "reported_metric") {
    const kind = resolveMetricDefinition(node.metric_key)?.value_kind;
    return kind === "balance" || kind === "share_count";
  }
  const dependencies = operationDependencies(node).map((id) => plan.operations.find((entry) => entry.node_id === id)!);
  return dependencies.length > 0 && dependencies.every((dependency) => measuresInstant(plan, dependency));
}

// An instant's date is the day its value stands at, which for a 10-Q cover's share count falls after the quarter ends.
function readText({ selector, bound }: PeriodRead, instant: boolean): string {
  if (bound) return boundPeriodText(bound, instant);
  return instant ? `end of ${selectorText(selector)}` : selectorText(selector);
}

/** A bound period as an answer names it: "Q2 FY2025 (ended 2025-06-28)", or for an instant "as of" its date. */
export function boundPeriodText(bound: BoundPeriod, instant = false): string {
  return `${fiscalName(bound)} (${instant ? "as of" : "ended"} ${bound.end})`;
}

function fiscalName(period: Readonly<{ fiscal_year: number; fiscal_period: string }>): string {
  return period.fiscal_period === "FY" ? `FY${period.fiscal_year}` : `${period.fiscal_period} FY${period.fiscal_year}`;
}

function selectorText(selector: PeriodSelector): string {
  if (selector.kind === "fiscal_period") return fiscalName(selector);
  if (selector.kind === "at_cutoff") return "latest known at the cutoff";
  const unit = selector.period_type === "annual" ? "fiscal year" : "fiscal quarter";
  return selector.offset === 0 ? `latest ${unit}` : `${unit} ${selector.offset} before latest`;
}
