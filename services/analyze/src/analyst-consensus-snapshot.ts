// Derives the cited consensus facts (analyst_count + bucket counts) + the issuer
// subject and delegates to the shared fact-backed seal-input core.

import { buildFactBackedSealInput } from "./block-seal-input.ts";
import type { AnalystConsensusBlock } from "./analyst-consensus-block-builder.ts";
import type { FactRow } from "../../evidence/src/fact-repo.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";

export function buildAnalystConsensusSealInput(input: {
  block: AnalystConsensusBlock;
  facts: ReadonlyArray<FactRow>;
  primary: IssuerSubjectRef;
  modelVersion?: string | null;
}): SnapshotSealInput {
  return buildFactBackedSealInput({
    block: input.block,
    factRefs: [input.block.analyst_count_ref, ...input.block.distribution.map((bucket) => bucket.count_ref)],
    subjectRefs: [{ kind: input.primary.kind, id: input.primary.id }],
    facts: input.facts,
    ...(input.modelVersion === undefined ? {} : { modelVersion: input.modelVersion }),
  });
}
