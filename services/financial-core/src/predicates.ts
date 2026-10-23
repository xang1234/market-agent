// Exact predicates: thresholds against attributed values, explicit-peer
// rankings, and one subject's periods ranked. Operand values are exact
// rationals, so every comparison is an exact cross-product; display-rounded
// values never decide an outcome.

import type { Comparison, PeerCompareNode, PeriodRankNode, PlanThreshold, ThresholdNode } from "./contracts.ts";
import { convertDimensionless, isDimensionless, unitIncompatibility } from "./dimensions.ts";
import { parseDerivedDecimalText } from "./exact-decimal.ts";
import {
  measureMismatch,
  measurementMismatch,
  operationGap,
  type FinancialOperand,
  type OperationGap,
  type PredicateOutcome,
} from "./operations.ts";
import { classifyDuration, periodsOverlap } from "./periods.ts";
import { compareRationals, rationalFromDecimal } from "./rational.ts";

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
  const unit = subject.measurement.unit;
  const parsed = parseDerivedDecimalText(threshold.value);
  let limit = parsed.ok ? rationalFromDecimal(parsed.value) : null;
  if (limit === null) return operationGap("numeric_limit_exceeded", "The threshold exceeds supported numeric limits.");
  if (isDimensionless(unit) && isDimensionless(threshold.unit)) {
    limit = convertDimensionless(limit, threshold.unit.kind, unit.kind);
  } else {
    const incompatible = unitIncompatibility(unit, threshold.unit);
    if (incompatible) {
      return operationGap(
        incompatible,
        incompatible === "incompatible_currency" ? "The threshold uses a different currency." : "The threshold uses an incompatible unit.",
      );
    }
  }
  const outcome = evaluateComparison(compareRationals(subject.value, limit), node.comparison);
  return { ok: true, operand: null, payload: { kind: "predicate", predicate: "threshold", comparison: node.comparison, outcome } };
}

/**
 * Ranks the available members of a frozen cohort. Missing members are
 * disclosed through population/complete, and the full-cohort leaders
 * (`extreme`) are withheld unless every requested member was evaluated.
 */
export function peerCompare(node: PeerCompareNode, members: ReadonlyArray<FinancialOperand | null>): PredicateOutcome {
  return rank(node, members, { mismatch: cohortMismatch, none: "No cohort member has an eligible value.", leaders: "of_complete" });
}

/**
 * Ranks one subject's measure across its own periods: a window's high or low.
 * A period without a value is left out and counted, and the leaders of the
 * periods ranked are named, so a reader sees how many were ranked.
 */
export function periodRank(node: PeriodRankNode, members: ReadonlyArray<FinancialOperand | null>): PredicateOutcome {
  return rank(node, members, { mismatch: windowMismatch, none: "No period has an eligible value.", leaders: "of_ranked" });
}

function rank(
  node: PeerCompareNode | PeriodRankNode,
  members: ReadonlyArray<FinancialOperand | null>,
  rules: { mismatch: (left: FinancialOperand, right: FinancialOperand) => OperationGap | null; none: string; leaders: "of_complete" | "of_ranked" },
): PredicateOutcome {
  if (members.length !== node.members.length) throw new RangeError(`${node.operation} members must align with node.members`);
  const present = node.members
    .map((nodeId, index) => ({ nodeId, operand: members[index] ?? null }))
    .filter((entry): entry is { nodeId: string; operand: FinancialOperand } => entry.operand !== null);
  if (present.length === 0) return operationGap("missing_input", rules.none);

  for (let left = 0; left < present.length; left += 1) {
    for (let right = left + 1; right < present.length; right += 1) {
      const incompatible = rules.mismatch(present[left]!.operand, present[right]!.operand);
      if (incompatible) return incompatible;
    }
  }

  const better = node.direction === "highest" ? 1 : -1;
  const ranks = present.map((entry) => ({
    node_id: entry.nodeId,
    rank: 1 + present.filter((other) => compareRationals(other.operand.value, entry.operand.value) === better).length,
  }));
  const complete = present.length === node.members.length;
  return {
    ok: true,
    operand: null,
    payload: {
      kind: "ranking",
      direction: node.direction,
      population: { requested: node.members.length, evaluated: present.length },
      complete,
      ranks,
      extreme: complete || rules.leaders === "of_ranked" ? ranks.filter((entry) => entry.rank === 1).map((entry) => entry.node_id).sort() : null,
    },
  };
}

/** Cohort members: distinct subjects, one measure, one measurement, the same period dates. */
function cohortMismatch(left: FinancialOperand, right: FinancialOperand): OperationGap | null {
  if (left.subject_slot === right.subject_slot) return operationGap("incompatible_scope", "A cohort cannot include the same subject twice.");
  const samePeriod = left.period.kind === right.period.kind && left.period.start === right.period.start && left.period.end === right.period.end;
  return (
    measureMismatch(left, right) ??
    measurementMismatch(left, right) ??
    (samePeriod ? null : operationGap("incompatible_period", "The cohort members cover different periods."))
  );
}

/** A window's periods: one subject, one measure, one measurement, distinct periods of one length. */
function windowMismatch(left: FinancialOperand, right: FinancialOperand): OperationGap | null {
  if (left.subject_slot !== right.subject_slot) return operationGap("incompatible_scope", "A period ranking is of one subject.");
  const incompatible = measureMismatch(left, right) ?? measurementMismatch(left, right);
  if (incompatible) return incompatible;
  const shape = classifyDuration(left.period);
  if (shape === "other" || shape !== classifyDuration(right.period)) return operationGap("incompatible_period", "A period ranking compares periods of one length.");
  return periodsOverlap(left.period, right.period) ? operationGap("overlapping_periods", "The ranked periods overlap.") : null;
}
