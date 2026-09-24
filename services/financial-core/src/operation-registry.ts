// The single source of per-operation facts: approved version, what it produces,
// whether it tolerates missing operands, and how it evaluates. Graph
// validation, plan evaluation, and future verifiers all read this table, so
// adding an operation is one entry here plus its implementation.

import type { FinancialPlanV1, OperationKind, OperationNode, ReportedMetricNode, VersionTag } from "./contracts.ts";
import {
  absoluteChange,
  margin,
  percentChangePositiveBase,
  ratio,
  trailingSum,
  type FinancialOperand,
  type OperandOutcome,
  type OperationOutcome,
} from "./operations.ts";
import { peerCompare, thresholdPredicate } from "./predicates.ts";

/** Supplies reported inputs; the engine binds evidence, the core never does. */
export type ReportedMetricEvaluator = (node: ReportedMetricNode) => OperandOutcome;
export type EvaluationContext = { plan: FinancialPlanV1; reported: ReportedMetricEvaluator };

type NodeOf<K extends OperationKind> = Extract<OperationNode, { operation: K }>;
type Operands = ReadonlyArray<FinancialOperand | null>;

export type OperationSpec<K extends OperationKind> = Readonly<{
  operation_version: VersionTag;
  interpretation: string;
  produces: "value" | "predicate";
  /** Only peer_compare: evaluates the available members and reports an incomplete cohort. */
  tolerates_missing_operands: boolean;
  evaluate: (node: NodeOf<K>, operands: Operands, context: EvaluationContext) => OperationOutcome;
}>;

const VALUE_OPERATION = { produces: "value", tolerates_missing_operands: false } as const;

export const OPERATION_REGISTRY: { readonly [K in OperationKind]: OperationSpec<K> } = Object.freeze({
  reported_metric: {
    ...VALUE_OPERATION,
    operation_version: "reported_metric.v1",
    interpretation: "Eligible reported value for the exact subject, metric, period, and basis.",
    evaluate: (node, _operands, context) => context.reported(node),
  },
  absolute_change: {
    ...VALUE_OPERATION,
    operation_version: "absolute_change.v1",
    interpretation: "Current minus prior for compatible periods, units, scope, and basis.",
    evaluate: (node, operands) => absoluteChange(node, required(node, operands, 0), required(node, operands, 1)),
  },
  percent_change_positive_base: {
    ...VALUE_OPERATION,
    operation_version: "percent_change_positive_base.v1",
    interpretation: "(current - prior) / prior, defined only for a positive prior value.",
    evaluate: (node, operands) => percentChangePositiveBase(node, required(node, operands, 0), required(node, operands, 1)),
  },
  gross_margin: {
    ...VALUE_OPERATION,
    operation_version: "gross_margin.v1",
    interpretation: "Gross profit / revenue for the identical period, scope, and basis; revenue must be positive.",
    evaluate: marginOf,
  },
  operating_margin: {
    ...VALUE_OPERATION,
    operation_version: "operating_margin.v1",
    interpretation: "Operating income / revenue for the identical period, scope, and basis; revenue must be positive.",
    evaluate: marginOf,
  },
  net_margin: {
    ...VALUE_OPERATION,
    operation_version: "net_margin.v1",
    interpretation: "Net income / revenue for the identical period, scope, and basis; revenue must be positive.",
    evaluate: marginOf,
  },
  ratio: {
    ...VALUE_OPERATION,
    operation_version: "ratio.v1",
    interpretation: "Approved metric pair with an explicit denominator constraint and timing.",
    evaluate: (node, operands) => ratio(node, required(node, operands, 0), required(node, operands, 1)),
  },
  trailing_sum: {
    ...VALUE_OPERATION,
    operation_version: "trailing_sum.v1",
    interpretation: "Sum of four consecutive, non-overlapping fiscal quarters of an additive flow metric.",
    evaluate: (node, operands) => trailingSum(node, node.quarters.map((_, index) => required(node, operands, index))),
  },
  threshold: {
    operation_version: "threshold.v1",
    interpretation: "Exact comparison with an attributed threshold in compatible units.",
    produces: "predicate",
    tolerates_missing_operands: false,
    evaluate: (node, operands, context) => {
      const threshold = context.plan.thresholds.find((entry) => entry.threshold_id === node.threshold_id);
      if (!threshold) throw new Error(`node ${node.node_id} references an undeclared threshold`);
      return thresholdPredicate(node, required(node, operands, 0), threshold);
    },
  },
  peer_compare: {
    operation_version: "peer_compare.v1",
    interpretation: "Ranking of a frozen cohort on identical definitions and periods; ties explicit.",
    produces: "predicate",
    tolerates_missing_operands: true,
    evaluate: (node, operands) => peerCompare(node, operands),
  },
});

export function evaluateOperation<K extends OperationKind>(node: NodeOf<K>, operands: Operands, context: EvaluationContext): OperationOutcome {
  const spec: OperationSpec<K> = OPERATION_REGISTRY[node.operation as K];
  return spec.evaluate(node, operands, context);
}

function marginOf(node: NodeOf<"gross_margin" | "operating_margin" | "net_margin">, operands: Operands): OperationOutcome {
  return margin(node, required(node, operands, 0), required(node, operands, 1));
}

/** Evaluation only reaches non-tolerant operations when every operand was computed. */
function required(node: OperationNode, operands: Operands, index: number): FinancialOperand {
  const operand = operands[index];
  if (!operand) throw new Error(`node ${node.node_id} is missing a required operand`);
  return operand;
}
