// What a question about one company that asks for no figure is answered with
// (#398): its latest quarter's statement lines and margins, its revenue growth
// on the quarter and on the year, and its revenue over the quarters shown. One
// deterministic draft for buildDeterministicPlan; no model plans it.

const SLOT = "a";
const QUARTERS_SHOWN = 8;
// Each statement line and the margin it makes over revenue.
const LINES = [
  ["gross_profit", "gross_margin"],
  ["operating_income", "operating_margin"],
  ["net_income", "net_margin"],
] as const;
// Revenue growth and how many quarters back it compares with.
const GROWTH = [
  ["revenue_qoq", 1],
  ["revenue_yoy", 4],
] as const;

type Node = Record<string, unknown> & { node_id: string };

const quarter = (metric: string, offset: number): Node => ({
  node_id: `${metric}_q${offset}`,
  operation: "reported_metric",
  subject_slot: SLOT,
  metric_key: metric,
  period: { kind: "latest", period_type: "quarterly", offset },
});

/** The overview's draft for the company the planner knows by `mention`. */
export function companyOverviewDraft(mention: string) {
  const revenue = Array.from({ length: QUARTERS_SHOWN }, (_, offset) => quarter("revenue", offset));
  const lines = LINES.map(([metric]) => quarter(metric, 0));
  const margins = LINES.map(([metric, margin]): Node => ({ node_id: margin, operation: margin, numerator: `${metric}_q0`, revenue: revenue[0]!.node_id }));
  const growth = GROWTH.map(([id, back]): Node => ({ node_id: id, operation: "percent_change_positive_base", current: revenue[0]!.node_id, prior: revenue[back]!.node_id }));
  return {
    subjects: [{ slot_id: SLOT, mention }],
    operations: [...revenue, ...lines, ...margins, ...growth],
    outputs: [...lines, ...margins, ...growth, ...[...revenue].reverse()].map((node) => ({ output_id: `out_${node.node_id}`, node_id: node.node_id })),
    thresholds: [],
  };
}
