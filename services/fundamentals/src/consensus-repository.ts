import {
  buildAnalystConsensus,
  type AnalystConsensusEnvelope,
  type BuildAnalystConsensusInput,
} from "./analyst-consensus.ts";
import type { UUID } from "./subject-ref.ts";

export type ConsensusRepository = {
  find(issuer_id: UUID): Promise<AnalystConsensusEnvelope | null>;
};

export type ConsensusRepositoryRecord = {
  subject_id: UUID;
  inputs: BuildAnalystConsensusInput;
};

export function createInMemoryConsensusRepository(
  records: ReadonlyArray<ConsensusRepositoryRecord>,
): ConsensusRepository {
  // Pre-compute envelopes once so the per-request hot path is a Map lookup,
  // not a fresh buildAnalystConsensus run (validation + frozen allocations).
  const byId = new Map<UUID, AnalystConsensusEnvelope>();
  for (const { subject_id, inputs } of records) {
    byId.set(subject_id, buildAnalystConsensus(inputs));
  }
  return {
    async find(issuer_id: UUID): Promise<AnalystConsensusEnvelope | null> {
      return byId.get(issuer_id) ?? null;
    },
  };
}
