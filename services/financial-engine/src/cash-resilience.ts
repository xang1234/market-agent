// The annual cash-resilience view (#210): five reported inputs and the three
// approved ratios over them, as one plan fragment every surface shares. Cash
// conversion compares one fiscal year's flows; the leverage ratios compare
// balances at that year's end. No score, rank, or new operation.

import type { PeriodSelector } from "../../financial-core/src/index.ts";

export type CashResiliencePeriod = Extract<PeriodSelector, { kind: "latest" } | { kind: "fiscal_period" }>;
type Node = Record<string, unknown> & { node_id: string };

const INPUTS = ["operating_cash_flow", "net_income_consolidated", "total_liabilities", "total_assets", "total_equity"] as const;
const RATIOS = [
  ["operating_cash_flow_to_net_income", "operating_cash_flow", "net_income_consolidated"],
  ["liabilities_to_assets", "total_liabilities", "total_assets"],
  ["liabilities_to_equity", "total_liabilities", "total_equity"],
] as const;

export const LATEST_FISCAL_YEAR: CashResiliencePeriod = { kind: "latest", period_type: "annual", offset: 0 };

/** Operations and outputs for one subject slot; ids start with `prefix` so a plan can hold several slots. */
export function cashResilienceDraft(slot: string, period: CashResiliencePeriod, prefix: string): { operations: Node[]; outputs: Array<{ output_id: string; node_id: string }> } {
  const id = (key: string) => `${prefix}${key}_${slot}`;
  const inputs = INPUTS.map((metric): Node => ({ node_id: id(metric), operation: "reported_metric", subject_slot: slot, metric_key: metric, period }));
  const ratios = RATIOS.map(([ratioKey, numerator, denominator]): Node => ({ node_id: id(ratioKey), operation: "ratio", ratio_key: ratioKey, numerator: id(numerator), denominator: id(denominator) }));
  return {
    operations: [...inputs, ...ratios],
    outputs: [...inputs, ...ratios].map((node) => ({ output_id: `out_${node.node_id}`, node_id: node.node_id })),
  };
}
