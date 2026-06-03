// Derives the cited bar facts + the single issuer subject and delegates to the
// shared fact-backed seal-input core. revenue_bars carries no `subjects` array
// (single-subject block), so the issuer is passed explicitly for the manifest.

import { buildFactBackedSealInput, type FactRow } from "./block-seal-input.ts";
import type { RevenueBarsBlock } from "./revenue-bars-block-builder.ts";
import type { IssuerSubjectRef, UUID } from "../../fundamentals/src/subject-ref.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";

export type RevenueBarsFactRow = FactRow;

export function buildRevenueBarsSealInput(input: {
  block: RevenueBarsBlock;
  facts: ReadonlyArray<RevenueBarsFactRow>;
  primary: IssuerSubjectRef;
  modelVersion?: string | null;
}): SnapshotSealInput {
  return buildFactBackedSealInput({
    block: input.block as unknown as Parameters<typeof buildFactBackedSealInput>[0]["block"],
    factRefs: distinctBarValueRefs(input.block),
    subjectRefs: [{ kind: input.primary.kind, id: input.primary.id }],
    facts: input.facts,
    ...(input.modelVersion === undefined ? {} : { modelVersion: input.modelVersion }),
  });
}

function distinctBarValueRefs(block: RevenueBarsBlock): UUID[] {
  const refs: UUID[] = [];
  const seen = new Set<UUID>();
  for (const bar of block.bars) {
    if (seen.has(bar.value_ref)) continue;
    seen.add(bar.value_ref);
    refs.push(bar.value_ref);
  }
  return refs;
}
