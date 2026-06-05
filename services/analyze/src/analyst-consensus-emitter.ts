// The earnings_quality playbook's deterministic emitter for the analyst_overview
// section: fetch the consensus envelope, materialize the rating-distribution
// facts, build the block, and assemble the seal input. Returns null (section
// omitted) when there is no envelope or no rating distribution. Does NOT seal —
// the run path seals the returned input in its transaction.

import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { ConsensusRepository } from "../../fundamentals/src/consensus-repository.ts";
import type { IssuerSubjectRef, UUID } from "../../fundamentals/src/subject-ref.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";
import { materializeConsensusFacts } from "./analyst-consensus-materializer.ts";
import { buildAnalystConsensusBlock } from "./analyst-consensus-block-builder.ts";
import { buildAnalystConsensusSealInput } from "./analyst-consensus-snapshot.ts";

export type AnalystConsensusEmitterDeps = {
  db: QueryExecutor;
  consensus: ConsensusRepository;
  clock?: () => Date;
};

export type AnalystConsensusEmitInput = {
  primary: IssuerSubjectRef;
  snapshotId: UUID;
  blockId: string;
  asOf: string;
  title?: string;
};

export async function emitAnalystConsensusBlock(
  deps: AnalystConsensusEmitterDeps,
  input: AnalystConsensusEmitInput,
): Promise<SnapshotSealInput | null> {
  const envelope = await deps.consensus.find(input.primary.id);
  if (envelope === null || envelope.rating_distribution === null) return null;

  const materialized = await materializeConsensusFacts(deps.db, {
    issuer: input.primary,
    envelope,
    clock: deps.clock,
  });
  if (materialized === null) return null;

  const coverageWarning = envelope.coverage_warnings[0]?.message;
  const block = buildAnalystConsensusBlock({
    materialized,
    base: {
      id: input.blockId,
      snapshot_id: input.snapshotId,
      as_of: input.asOf,
      source_refs: [envelope.rating_distribution.source_id],
      ...(input.title === undefined ? {} : { title: input.title }),
    },
    ...(coverageWarning === undefined ? {} : { coverage_warning: coverageWarning }),
  });

  return buildAnalystConsensusSealInput({ block, facts: materialized.factRows, primary: input.primary });
}
