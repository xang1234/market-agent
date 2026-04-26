import { buildKeyStats, type BuildKeyStatsInput, type KeyStatsEnvelope } from "./key-stats.ts";
import type { UUID } from "./subject-ref.ts";

export type StatsRepository = {
  find(issuer_id: UUID): Promise<KeyStatsEnvelope | null>;
};

export type StatsRepositoryRecord = {
  subject_id: UUID;
  inputs: BuildKeyStatsInput;
};

export function createInMemoryStatsRepository(
  records: ReadonlyArray<StatsRepositoryRecord>,
): StatsRepository {
  // Pre-compute envelopes once so the per-request hot path is a Map lookup,
  // not a fresh buildKeyStats run (validation + ~7 frozen allocations).
  const byId = new Map<UUID, KeyStatsEnvelope>();
  for (const { subject_id, inputs } of records) {
    byId.set(subject_id, buildKeyStats(inputs));
  }
  return {
    async find(issuer_id: UUID): Promise<KeyStatsEnvelope | null> {
      return byId.get(issuer_id) ?? null;
    },
  };
}
