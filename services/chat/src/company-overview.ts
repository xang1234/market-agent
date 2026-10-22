import { buildDeterministicPlan, type PlanningContext, type PlanningResult, type RequestedSubject } from "../../financial-engine/src/planner.ts";
import { requestedFiscalQuarter, requestedFiscalYear, requestedPriceWindow } from "./fact-blocks.ts";
import { PARTIAL_QUARTER, type ScopeProposal } from "./research-scope.ts";

const SLOT = "a";
const QUARTERS_SHOWN = 8;
const MARGIN_OF_LINE = { gross_profit: "gross_margin", operating_income: "operating_margin", net_income: "net_margin" } as const;
const QUARTERS_BACK = { revenue_qoq: 1, revenue_yoy: 4 } as const;

type Node = Record<string, unknown> & { node_id: string };

const quarter = (metric: string, offset: number): Node => ({
  node_id: `${metric}_q${offset}`,
  operation: "reported_metric",
  subject_slot: SLOT,
  metric_key: metric,
  period: { kind: "latest", period_type: "quarterly", offset },
});

/** Whether a turn may be a company overview before its reading: one resolved company it names, not carried, and no period. */
export function namesOneCompany(subjects: ReadonlyArray<RequestedSubject>, carried: boolean, text: string): boolean {
  return subjects.length === 1 && subjects[0]!.resolution.status === "resolved" && !carried &&
    requestedFiscalYear(text) === undefined && requestedFiscalQuarter(text) === undefined && !PARTIAL_QUARTER.test(text) && requestedPriceWindow(text) === undefined;
}

/** Whether the reading of a question asks for no figure and turns nothing off ("no margins"), so the overview answers it. */
export function asksForNoFigure(reading: ScopeProposal | null): boolean {
  return reading !== null && reading.metrics.length === 0 && reading.income_items.length === 0 &&
    reading.turns_off.facets.size === 0 && reading.turns_off.metrics.size === 0 &&
    [...reading.asks].every((facet) => facet === "latest_quarter");
}

export function planCompanyOverview(context: PlanningContext): PlanningResult {
  return buildDeterministicPlan(context, companyOverviewDraft(context.requested_subjects[0]!.mention));
}

export function companyOverviewDraft(mention: string) {
  const revenue = Array.from({ length: QUARTERS_SHOWN }, (_, offset) => quarter("revenue", offset));
  const lines = Object.keys(MARGIN_OF_LINE).map((metric) => quarter(metric, 0));
  const margins = Object.entries(MARGIN_OF_LINE).map(([metric, margin]): Node => ({ node_id: margin, operation: margin, numerator: `${metric}_q0`, revenue: revenue[0]!.node_id }));
  const growth = Object.entries(QUARTERS_BACK).map(([id, back]): Node => ({ node_id: id, operation: "percent_change_positive_base", current: revenue[0]!.node_id, prior: revenue[back]!.node_id }));
  return {
    subjects: [{ slot_id: SLOT, mention }],
    operations: [...revenue, ...lines, ...margins, ...growth],
    outputs: [...[...revenue].reverse(), ...lines, ...margins, ...growth].map((node) => ({ output_id: `out_${node.node_id}`, node_id: node.node_id })),
    thresholds: [],
  };
}
