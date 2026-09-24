// Exact predicates: thresholds against attributed values and explicit-peer
// rankings. Display-rounded values never decide an outcome; exact rational
// lineage does, and without it the result is precision_indeterminate.

import type { Comparison, PeerCompareNode, PlanThreshold, PredicatePayload, RankingPayload, ThresholdNode } from "./contracts.ts";
import { convertDimensionless, isDimensionless, unitIncompatibility } from "./dimensions.ts";
import { compareExactDecimals, compareRatioToThreshold, parseDerivedDecimalText, type ExactDecimal } from "./exact-decimal.ts";
import { contextIncompatibility, operationGap, type FinancialOperand, type OperationGap } from "./operations.ts";
import { compareRationals } from "./rational.ts";

export type PredicateOutcome = { ok: true; payload: PredicatePayload | RankingPayload } | OperationGap;

export function evaluateComparison(comparison: -1 | 0 | 1, operator: Comparison): boolean {
  switch (operator) {
    case "gt":
      return comparison > 0;
    case "gte":
      return comparison >= 0;
    case "lt":
      return comparison < 0;
    case "lte":
      return comparison <= 0;
    case "eq":
      return comparison === 0;
  }
}

export function thresholdPredicate(node: ThresholdNode, subject: FinancialOperand, threshold: PlanThreshold): PredicateOutcome {
  const parsed = parseDerivedDecimalText(threshold.value);
  if (!parsed.ok) return operationGap("numeric_limit_exceeded", "The threshold exceeds supported numeric limits.");
  let limit: ExactDecimal = parsed.value;
  if (isDimensionless(subject.unit) && isDimensionless(threshold.unit)) {
    limit = convertDimensionless(limit, threshold.unit.kind, subject.unit.kind);
  } else {
    const incompatible = unitIncompatibility(subject.unit, threshold.unit);
    if (incompatible) {
      return operationGap(
        incompatible,
        incompatible === "incompatible_currency" ? "The threshold uses a different currency." : "The threshold uses an incompatible unit.",
      );
    }
  }
  let comparison: -1 | 0 | 1;
  if (subject.rational !== null) {
    // Denominators are positive by construction, so this is never null.
    comparison = compareRatioToThreshold(subject.rational.numerator, subject.rational.denominator, limit)!;
  } else if (subject.exact) {
    comparison = compareExactDecimals(subject.value, limit);
  } else {
    return operationGap("precision_indeterminate", "The value is a rounded representation and cannot decide this threshold.");
  }
  return {
    ok: true,
    payload: { kind: "predicate", predicate: "threshold", comparison: node.comparison, outcome: evaluateComparison(comparison, node.comparison) },
  };
}

/**
 * Ranks the available members of a frozen cohort. Missing members are
 * disclosed through population/complete, and the full-cohort leaders
 * (`extreme`) are withheld unless every requested member was evaluated.
 */
export function peerCompare(node: PeerCompareNode, members: ReadonlyArray<FinancialOperand | null>): PredicateOutcome {
  if (members.length !== node.members.length) throw new RangeError("peer_compare members must align with node.members");
  const present = node.members
    .map((nodeId, index) => ({ nodeId, operand: members[index] ?? null }))
    .filter((entry): entry is { nodeId: string; operand: FinancialOperand } => entry.operand !== null);
  if (present.length === 0) return operationGap("missing_input", "No cohort member has an eligible value.");

  for (let left = 0; left < present.length; left += 1) {
    for (let right = left + 1; right < present.length; right += 1) {
      const incompatible = contextIncompatibility(present[left]!.operand, present[right]!.operand, {
        sameSubject: false,
        sameMetric: true,
        period: "same_dates",
      });
      if (incompatible) return incompatible;
    }
  }

  let compare: (left: FinancialOperand, right: FinancialOperand) => -1 | 0 | 1;
  if (present.every((entry) => entry.operand.rational !== null)) {
    compare = (left, right) => compareRationals(left.rational!, right.rational!);
  } else if (present.every((entry) => entry.operand.exact)) {
    compare = (left, right) => compareExactDecimals(left.value, right.value);
  } else {
    return operationGap("precision_indeterminate", "A member value is rounded and cannot be ranked exactly.");
  }

  const better = node.direction === "highest" ? 1 : -1;
  const ranks = present.map((entry) => ({
    node_id: entry.nodeId,
    rank: 1 + present.filter((other) => compare(other.operand, entry.operand) === better).length,
  }));
  const complete = present.length === node.members.length;
  return {
    ok: true,
    payload: {
      kind: "ranking",
      direction: node.direction,
      population: { requested: node.members.length, evaluated: present.length },
      complete,
      ranks,
      extreme: complete ? ranks.filter((entry) => entry.rank === 1).map((entry) => entry.node_id).sort() : null,
    },
  };
}
