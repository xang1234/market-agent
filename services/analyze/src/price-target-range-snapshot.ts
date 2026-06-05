// Seals a price_target_range block: binds the current-price + low/mean/high facts
// via the shared core, then wraps with withRequiredDisclosures so the current-price
// fact's freshness gets its pricing disclosure block.

import { buildFactBackedSealInput, withRequiredDisclosures, type FactRow } from "./block-seal-input.ts";
import type { PriceTargetRangeBlock } from "./price-target-range-block-builder.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";

export function buildPriceTargetRangeSealInput(input: {
  block: PriceTargetRangeBlock;
  facts: ReadonlyArray<FactRow>;
  primary: IssuerSubjectRef;
  listing: { kind: string; id: string };
  modelVersion?: string | null;
}): SnapshotSealInput {
  const seal = buildFactBackedSealInput({
    block: input.block,
    factRefs: [
      input.block.current_price_ref,
      input.block.low_ref,
      input.block.avg_ref,
      input.block.high_ref,
    ],
    subjectRefs: [
      { kind: input.primary.kind, id: input.primary.id },
      { kind: input.listing.kind, id: input.listing.id },
    ],
    facts: input.facts,
    ...(input.modelVersion === undefined ? {} : { modelVersion: input.modelVersion }),
  });
  return withRequiredDisclosures(seal);
}
