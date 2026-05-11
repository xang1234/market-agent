import type { ConsensusRepository } from "./consensus-repository.ts";
import type { EarningsRepository } from "./earnings-repository.ts";
import type { HoldersRepository } from "./holders-repository.ts";
import type { SegmentsRepository } from "./segments-repository.ts";
import type { StatsRepository } from "./stats-repository.ts";

export function createUnsupportedConsensusRepository(): ConsensusRepository {
  return {
    async find() {
      return null;
    },
  };
}

export function createUnsupportedEarningsRepository(): EarningsRepository {
  return {
    async find() {
      return null;
    },
  };
}

export function createUnsupportedHoldersRepository(): HoldersRepository {
  return {
    async find() {
      return null;
    },
  };
}

export function createUnsupportedSegmentsRepository(): SegmentsRepository {
  return {
    async find() {
      return null;
    },
  };
}

export function createUnsupportedStatsRepository(): StatsRepository {
  return {
    async find() {
      return null;
    },
  };
}
