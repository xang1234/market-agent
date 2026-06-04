import type { EarningsRepository } from "./earnings-repository.ts";
import {
  createDevProvidersConsensusRepository,
  createDevProvidersEarningsRepository,
  createDevProvidersHoldersRepository,
  type DevProvidersConsensusRepositoryOptions,
  type DevProvidersEarningsRepositoryOptions,
  type DevProvidersHoldersRepositoryOptions,
} from "./dev-provider-fundamentals.ts";
import {
  createDevProvidersIssuerProfileRepository,
  type DevProvidersIssuerProfileRepositoryOptions,
  type IssuerProfileTransactionalQueryExecutor,
} from "./dev-provider-profile.ts";
import type { ConsensusRepository } from "./consensus-repository.ts";
import type { DevProviderSidecarOptions } from "./dev-provider-sidecar.ts";
import type { HoldersRepository } from "./holders-repository.ts";
import {
  createPostgresIssuerProfileRepository,
  type IssuerProfileQueryExecutor,
  type IssuerProfileRepository,
} from "./issuer-repository.ts";
import { YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID } from "./provider-sources.ts";
import { createUnsupportedConsensusRepository } from "./unsupported-repositories.ts";
import type { UUID } from "./subject-ref.ts";

type DevProviderEnv = {
  ENABLE_UNOFFICIAL_DEV_PROVIDERS?: string;
  DEV_PROVIDERS_BASE_URL?: string;
  DEV_PROVIDERS_ORIGIN?: string;
};

// The dev-providers sidecar base URL, but only when unofficial dev providers are
// enabled — the single gate both the fundamentals service and the analyze run
// path consult before reaching for sidecar-backed data.
export function devProvidersBaseUrlFromEnv(env: DevProviderEnv = process.env): string | null {
  if (env.ENABLE_UNOFFICIAL_DEV_PROVIDERS !== "true") return null;
  return env.DEV_PROVIDERS_BASE_URL ?? env.DEV_PROVIDERS_ORIGIN ?? null;
}

// Resolve the consensus repository from the environment: the sidecar-backed repo
// when unofficial dev providers are enabled, else the unsupported (null) repo.
// Owns the profiles + source-id wiring so callers don't reassemble it.
export function consensusRepositoryFromEnv(
  db: IssuerProfileQueryExecutor,
  env: DevProviderEnv = process.env,
): ConsensusRepository {
  const baseUrl = devProvidersBaseUrlFromEnv(env);
  if (baseUrl === null) return createUnsupportedConsensusRepository();
  return createDevProvidersConsensusRepository({
    profiles: createPostgresIssuerProfileRepository(db),
    baseUrl,
    sourceId: YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID,
  });
}

export {
  createDevProvidersConsensusRepository,
  createDevProvidersEarningsRepository,
  createDevProvidersHoldersRepository,
  createDevProvidersIssuerProfileRepository,
  type DevProvidersConsensusRepositoryOptions,
  type DevProvidersEarningsRepositoryOptions,
  type DevProvidersHoldersRepositoryOptions,
  type DevProvidersIssuerProfileRepositoryOptions,
  type IssuerProfileTransactionalQueryExecutor,
};

export type DevProviderRuntimeOptions = DevProviderSidecarOptions & {
  profiles: IssuerProfileRepository;
  db: IssuerProfileTransactionalQueryExecutor;
  sourceId: UUID;
};

export type DevProviderRuntime = {
  profiles: IssuerProfileRepository;
  earnings: EarningsRepository;
  holders: HoldersRepository;
  consensus: ConsensusRepository;
};

export function createDevProviderRuntime(options: DevProviderRuntimeOptions): DevProviderRuntime {
  const sidecarOptions = {
    baseUrl: options.baseUrl,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  };
  return {
    profiles: createDevProvidersIssuerProfileRepository({
      primary: options.profiles,
      db: options.db,
      ...sidecarOptions,
    }),
    earnings: createDevProvidersEarningsRepository({
      profiles: options.profiles,
      sourceId: options.sourceId,
      ...sidecarOptions,
    }),
    holders: createDevProvidersHoldersRepository({
      profiles: options.profiles,
      sourceId: options.sourceId,
      ...sidecarOptions,
    }),
    consensus: createDevProvidersConsensusRepository({
      profiles: options.profiles,
      sourceId: options.sourceId,
      ...sidecarOptions,
    }),
  };
}
