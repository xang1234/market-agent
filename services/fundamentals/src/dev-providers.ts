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
import type { DevProviderSidecarOptions } from "./dev-provider-sidecar.ts";
import type { HoldersRepository } from "./holders-repository.ts";
import type { IssuerProfileRepository } from "./issuer-repository.ts";
import type { UUID } from "./subject-ref.ts";

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
  };
}
