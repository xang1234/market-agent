// Derives the cited bar facts + the single issuer subject and delegates to the
// shared fact-backed seal-input core. revenue_bars carries no `subjects` array
// (single-subject block), so the issuer is passed explicitly for the manifest.

import { buildFactBackedSealInput, type FactRow } from "./block-seal-input.ts";
import type { RevenueBarsBlock } from "./revenue-bars-block-builder.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";

export type RevenueBarsFactRow = FactRow;

export function buildRevenueBarsSealInput(input: {
  block: RevenueBarsBlock;
  facts: ReadonlyArray<RevenueBarsFactRow>;
  primary: IssuerSubjectRef;
  modelVersion?: string | null;
}): SnapshotSealInput {
  return buildFactBackedSealInput({
    block: input.block,
    factRefs: input.block.bars.map((bar) => bar.value_ref),
    subjectRefs: [{ kind: input.primary.kind, id: input.primary.id }],
    facts: input.facts,
    ...(input.modelVersion === undefined ? {} : { modelVersion: input.modelVersion }),
  });
}
