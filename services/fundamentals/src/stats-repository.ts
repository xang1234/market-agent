import type { BuildKeyStatsInput } from "./key-stats.ts";
import type { UUID } from "./subject-ref.ts";

// What buildKeyStats needs to compute an envelope. Modeling the repo as
// "give me the bundle for this issuer" keeps the HTTP handler thin and
// hides the eventual fan-out (statements service, prior-period selection,
// market-price fetch) behind one boundary.
export type StatsInputs = BuildKeyStatsInput;

export type StatsRepository = {
  findStatsInputs(issuer_id: UUID): Promise<StatsInputs | null>;
};

export type StatsRepositoryRecord = {
  subject_id: UUID;
  inputs: StatsInputs;
};

export function createInMemoryStatsRepository(
  records: ReadonlyArray<StatsRepositoryRecord>,
): StatsRepository {
  const byId = new Map<UUID, StatsInputs>();
  for (const { subject_id, inputs } of records) {
    byId.set(subject_id, inputs);
  }
  return {
    async findStatsInputs(issuer_id: UUID): Promise<StatsInputs | null> {
      return byId.get(issuer_id) ?? null;
    },
  };
}
