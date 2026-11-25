// Standout findings: deterministic checks that each turn one company's annual
// series into one certified observation and how unusual it is against the
// company's own history. A detector is a template of approved engine nodes
// over its latest fiscal years, a ranking of the latest year among them, and a
// sentence filled only from the published results. A detector that cannot be
// sure declines by name, never guesses.

import type { FinancialAnswerContent, PresentedResult, ReasonCode } from "../../financial-core/src/index.ts";

type Node = Record<string, unknown> & { node_id: string };
type Direction = "highest" | "lowest";

export type Detector = Readonly<{
  id: string;
  // What the measure is, as the sentence names it.
  label: string;
  // How many of the company's latest fiscal years it ranks, the latest among them.
  years: number;
  // A finding when the latest year leads the ranking in one of these.
  directions: ReadonlyArray<Direction>;
  // One fiscal year's nodes, `offset` years before the latest, its measure last.
  year: (slot: string, offset: number) => ReadonlyArray<Node>;
}>;

const reported = (slot: string, metric: string, offset: number): Node =>
  ({ node_id: `${metric}_y${offset}`, operation: "reported_metric", subject_slot: slot, metric_key: metric, period: { kind: "latest", period_type: "annual", offset } });

export const DETECTORS: ReadonlyArray<Detector> = [
  {
    id: "operating_margin_extreme",
    label: "operating margin",
    years: 10,
    directions: ["highest", "lowest"],
    year: (slot, y) => [
      reported(slot, "revenue", y),
      reported(slot, "operating_income", y),
      { node_id: `operating_margin_y${y}`, operation: "operating_margin", numerator: `operating_income_y${y}`, revenue: `revenue_y${y}` },
    ],
  },
  {
    id: "sbc_share_of_free_cash_flow",
    label: "stock-based compensation as a multiple of free cash flow",
    years: 5,
    directions: ["highest"],
    year: (slot, y) => [
      reported(slot, "operating_cash_flow", y),
      reported(slot, "capex", y),
      reported(slot, "stock_based_compensation", y),
      { node_id: `free_cash_flow_y${y}`, operation: "free_cash_flow", operating_cash_flow: `operating_cash_flow_y${y}`, capex: `capex_y${y}` },
      { node_id: `sbc_to_fcf_y${y}`, operation: "ratio", ratio_key: "stock_based_compensation_to_free_cash_flow", numerator: `stock_based_compensation_y${y}`, denominator: `free_cash_flow_y${y}` },
    ],
  },
  {
    id: "cash_conversion_low",
    label: "cash conversion (operating cash flow / net income)",
    years: 10,
    directions: ["lowest"],
    year: (slot, y) => [
      reported(slot, "operating_cash_flow", y),
      reported(slot, "net_income_consolidated", y),
      { node_id: `cash_conversion_y${y}`, operation: "ratio", ratio_key: "operating_cash_flow_to_net_income", numerator: `operating_cash_flow_y${y}`, denominator: `net_income_consolidated_y${y}` },
    ],
  },
];

// A node's id names its year, never its slot: a findings plan is one company's.
const measureOf = (detector: Detector, offset: number) => detector.year("", offset).at(-1)!.node_id;
const rankNode = (detector: Detector, direction: Direction) => `${detector.id}_${direction}`;

/**
 * Every detector's nodes for one company in slot `slot`, as one plan draft:
 * a year's input shared by two detectors is read once. Outputs are each
 * detector's latest measure and its rankings.
 */
export function findingsDraft(slot: string): { operations: Node[]; outputs: Array<{ output_id: string; node_id: string }> } {
  const operations = new Map<string, Node>();
  const outputs: Array<{ output_id: string; node_id: string }> = [];
  for (const detector of DETECTORS) {
    const members = Array.from({ length: detector.years }, (_, offset) => {
      for (const node of detector.year(slot, offset)) operations.set(node.node_id, node);
      return measureOf(detector, offset);
    });
    outputs.push({ output_id: `out_${members[0]!}`, node_id: members[0]! });
    for (const direction of detector.directions) {
      const node_id = rankNode(detector, direction);
      operations.set(node_id, { node_id, operation: "period_rank", members, direction });
      outputs.push({ output_id: `out_${node_id}`, node_id });
    }
  }
  return { operations: [...operations.values()], outputs };
}

export type Finding = Readonly<{
  detector_id: string;
  statement: string;
  // The engine results it rests on: the latest year's measure and its ranking.
  result_ids: readonly [string, string];
  salience: Readonly<{ direction: Direction; rank: 1; of: number }>;
}>;

export type DeclineReason = "incomplete_history" | "uncertified_input" | "tag_change" | "non_positive_base" | "engine_gap" | "within_range";

export type Decline = Readonly<{ detector_id: string; reason: DeclineReason; detail: string }>;

export type DetectorOutcome = Finding | Decline;

// A blocked result names no root cause: a missing year, a conflicting or
// unverified figure and a failed read all block alike, so it claims only that
// an input was not certified.
const REASONS: Partial<Record<ReasonCode, DeclineReason>> = {
  missing_input: "incomplete_history",
  blocked_by_dependency: "uncertified_input",
  incompatible_definition: "tag_change",
  non_positive_base: "non_positive_base",
  non_positive_denominator: "non_positive_base",
  zero_denominator: "non_positive_base",
};

/** Each detector's finding or named decline, read from the published findings plan. */
export function runDetectors(content: FinancialAnswerContent, company: string): DetectorOutcome[] {
  const byOutput = new Map(content.results.map((result) => [result.output_id, result]));
  const label = (id: string) => content.labels[id]?.text ?? id;
  return DETECTORS.map((detector): DetectorOutcome => {
    const decline = (reason: DeclineReason, detail: string): Decline => ({ detector_id: detector.id, reason, detail });
    // A ranking tolerates every evidence gap among its years and blocks only on a failed read, so its block is an engine gap.
    const gap = (result: PresentedResult | undefined, of: "latest" | "ranking") => {
      if (result?.presented.kind !== "gap") return decline("engine_gap", "the engine published no result");
      const failed = result.disposition === "execution_error" || (of === "ranking" && result.disposition === "blocked_dependency");
      return decline(failed ? "engine_gap" : REASONS[result.presented.reason_code] ?? "engine_gap", `${result.presented.reason_code}: ${result.presented.text}`);
    };
    const latest = byOutput.get(`out_${measureOf(detector, 0)}`);
    if (latest?.presented.kind !== "value") return gap(latest, "latest");
    const period = latest.period_label_id;
    let within: string | null = null;
    for (const direction of detector.directions) {
      const ranking = byOutput.get(`out_${rankNode(detector, direction)}`);
      if (ranking?.presented.kind !== "ranking") return gap(ranking, "ranking");
      const { complete, order, leader_label_ids: leaders } = ranking.presented;
      if (!complete || leaders === null) return decline("incomplete_history", `${order.length} of ${detector.years} fiscal years have a value`);
      // A year tied at the extreme is no standout: a flat series ties every year.
      if (leaders.length === 1 && leaders[0] === period) {
        return {
          detector_id: detector.id,
          statement: `${company}'s ${detector.label} was ${latest.presented.text} in ${label(period)}, the ${direction} of its last ${detector.years} fiscal years.`,
          result_ids: [latest.result_id, ranking.result_id],
          salience: { direction, rank: 1, of: detector.years },
        };
      }
      const rank = order.find((entry) => "period_label_id" in entry && entry.period_label_id === period)?.rank;
      within ??= `${label(period)} ranks ${rank} of ${detector.years} by ${direction}${leaders.length > 1 && rank === 1 ? `, tied with ${leaders.length - 1} other years` : ""}`;
    }
    return decline("within_range", within!);
  });
}

export const isFinding = (outcome: DetectorOutcome): outcome is Finding => "statement" in outcome;

export const DECLINE_WORDS: Readonly<Record<DeclineReason, string>> = {
  incomplete_history: "a year in its window has no value",
  uncertified_input: "an input to its latest year was not certified",
  tag_change: "a figure in its window filed under another concept",
  non_positive_base: "a zero or negative base",
  engine_gap: "not computed",
  within_range: "the latest year is not alone at the extreme",
};

/** What a run with no finding says of each detector; null when one found something. */
export function noFindingNote(company: string, outcomes: ReadonlyArray<DetectorOutcome>): string | null {
  if (outcomes.some(isFinding)) return null;
  const labelOf = new Map(DETECTORS.map((detector) => [detector.id, detector.label]));
  return `${company}: no standout finding in its own history (${outcomes.map((outcome) => `${labelOf.get(outcome.detector_id)}: ${DECLINE_WORDS[(outcome as Decline).reason]}`).join("; ")}).`;
}
