// Publication units are declared before execution: a Chat/Analyze section, a
// grid cell, a thesis condition, or a Discovery candidate's numerical
// assessment. Each unit's dependency closure is derived from the plan and
// frozen, so membership cannot be revised after a failure to make a
// certificate pass.

import type { FinancialPlanV1, LocalId } from "./contracts.ts";
import { dependencyClosure, topologicalOrder } from "./graph.ts";

export type UnitClosure = Readonly<{
  unit_id: LocalId;
  output_ids: ReadonlyArray<LocalId>;
  /** Transitive closure of the unit's output nodes, in topological order. */
  node_ids: ReadonlyArray<LocalId>;
}>;

export function unitClosures(plan: FinancialPlanV1): ReadonlyMap<LocalId, UnitClosure> {
  const order = topologicalOrder(plan);
  const closures = new Map<LocalId, UnitClosure>();
  for (const unit of plan.publication_units) {
    const outputs = plan.outputs.filter((output) => output.unit_id === unit.unit_id);
    const closure = dependencyClosure(plan, outputs.map((output) => output.node_id));
    closures.set(
      unit.unit_id,
      Object.freeze({
        unit_id: unit.unit_id,
        output_ids: Object.freeze(outputs.map((output) => output.output_id)),
        node_ids: Object.freeze(order.filter((nodeId) => closure.has(nodeId))),
      }),
    );
  }
  return closures;
}

/** Units whose closure contains the node, in declaration order: its blast radius. */
export function unitsDependingOn(plan: FinancialPlanV1, nodeId: LocalId): LocalId[] {
  return [...unitClosures(plan).values()].filter((closure) => closure.node_ids.includes(nodeId)).map((closure) => closure.unit_id);
}
