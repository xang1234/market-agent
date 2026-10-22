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
