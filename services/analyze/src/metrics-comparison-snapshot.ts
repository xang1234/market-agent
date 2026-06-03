// Assembles the snapshot seal input for a metrics_comparison block by deriving
// the cited cell facts + compared subjects and delegating to the shared
// fact-backed seal-input core (block-seal-input.ts).

import { buildFactBackedSealInput, type FactRow } from "./block-seal-input.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";
import type { MetricsComparisonBlock } from "./metrics-comparison-block-builder.ts";
import type { UUID } from "../../fundamentals/src/subject-ref.ts";

// A fact row backing a cell. Retained as an alias for the shared FactRow so
// existing imports keep working.
export type PeerComparisonFactRow = FactRow;

export function buildPeerComparisonSealInput(input: {
  block: MetricsComparisonBlock;
  facts: ReadonlyArray<PeerComparisonFactRow>;
  modelVersion?: string | null;
}): SnapshotSealInput {
  return buildFactBackedSealInput({
    block: input.block,
    factRefs: cellValueRefs(input.block),
    subjectRefs: input.block.subjects.map((subject) => ({ kind: subject.kind, id: subject.id })),
    facts: input.facts,
    ...(input.modelVersion === undefined ? {} : { modelVersion: input.modelVersion }),
  });
}

// All non-null cell value_refs in row-major order (the core dedups).
function cellValueRefs(block: MetricsComparisonBlock): UUID[] {
  return block.cells.flatMap((row) =>
    row.flatMap((cell) => (cell === null ? [] : [cell.value_ref])),
  );
}
