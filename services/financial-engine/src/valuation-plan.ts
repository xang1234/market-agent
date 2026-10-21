// How a surface plans a market cap or P/E (#444): the share price at the
// plan's cutoff, the operand the valuation reads beside it, and the valuation
// over both. Grids and the screener plan from this one definition, so they
// never disagree on which share count or EPS a figure rests on.

import type { OperationKind } from "../../financial-core/src/index.ts";

export type Valuation = Extract<OperationKind, "market_cap" | "pe_ratio">;

/**
 * What each valuation reads beside the price: the latest filing's share count,
 * or the latest fiscal year's diluted EPS, the only EPS pe_ratio.v1 accepts.
 */
const OPERANDS: Readonly<Record<Valuation, Readonly<{ operand: "shares" | "earnings"; metric_key: string; period: Readonly<Record<string, unknown>> }>>> = {
  market_cap: { operand: "shares", metric_key: "shares_outstanding", period: { kind: "latest", period_type: "quarterly", offset: 0 } },
  pe_ratio: { operand: "earnings", metric_key: "eps_diluted", period: { kind: "latest", period_type: "annual", offset: 0 } },
};

/** A valuation's nodes: its price `<node>_px`, its operand `<node>_shares` or `<node>_earnings`, and the figure `<node>`. */
export function valuationOperations(nodeId: string, subjectSlot: string, valuation: Valuation): Array<Record<string, unknown>> {
  const { operand, metric_key, period } = OPERANDS[valuation];
  return [
    { node_id: `${nodeId}_px`, operation: "reported_metric", subject_slot: subjectSlot, metric_key: "share_price", period: { kind: "at_cutoff" } },
    { node_id: `${nodeId}_${operand}`, operation: "reported_metric", subject_slot: subjectSlot, metric_key, period },
    { node_id: nodeId, operation: valuation, price: `${nodeId}_px`, [operand]: `${nodeId}_${operand}` },
  ];
}

/**
 * A valuation's published nodes, its own figure first: that is the result a
 * surface shows. The planner always publishes the price and operand beside
 * it, so they are listed after the figure rather than added before it.
 */
export function valuationOutputs(nodeId: string, valuation: Valuation): string[] {
  return [nodeId, `${nodeId}_px`, `${nodeId}_${OPERANDS[valuation].operand}`];
}
