import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import type { FinancialPool } from "../../financial-engine/src/ports.ts";
import { requireFinancialReadiness } from "../../financial-engine/src/readiness.ts";
import { createFinancialCriteriaEvaluator } from "./financial-execution.ts";
import type * as D from "./types.ts";
import type {
  AssessmentQuoteRequest, CampaignModel, DiscoveryRepository, EvidencePacket, Lease, OperationRunner,
  Providers, WorkerDeps,
} from "./ports.ts";

export type UserScopedProviderFactory = Readonly<{
  search: (userId: D.Id) => Providers["search"];
  identity: (userId: D.Id) => Providers["identity"];
  evidence: (userId: D.Id) => Providers["evidence"];
  financials: (userId: D.Id) => Providers["financials"];
}>;

/**
 * The service runtime supplies concrete adapters here. Keeping their creation
 * behind the lease makes a cached financial reader or document service unable
 * to accidentally retain a previous user's visibility scope.
 */
export function createWorkerDeps(input: {
  repo: DiscoveryRepository;
  clock: () => Date;
  providerFactory: UserScopedProviderFactory;
  /** Must construct routing from this run's model_config; createCampaignModel accepts it directly. */
  modelFactory: (input: Readonly<{ user_id: D.Id; model_config: readonly D.ModelConfigSnapshot[]; operations: OperationRunner }>) => CampaignModel;
  loadExisting: (userId: D.Id, brief: D.Brief) => Promise<D.ExistingCandidate[]>;
  persistQuotes: (lease: Lease, packet: EvidencePacket, raw: D.AnalystOutput | D.SkepticOutput, request: AssessmentQuoteRequest) => Promise<Map<string, D.Citation>>;
  commitAssessment: WorkerDeps["commitAssessment"];
  pool: FinancialPool;
}): WorkerDeps {
  if (typeof input.pool?.connect !== "function") throw new Error("createWorkerDeps needs the financial engine's pool");
  return Object.freeze({
    repo: input.repo,
    clock: input.clock,
    providers: (lease) => Object.freeze({
      search: input.providerFactory.search(lease.user_id),
      identity: input.providerFactory.identity(lease.user_id),
      evidence: input.providerFactory.evidence(lease.user_id),
      financials: input.providerFactory.financials(lease.user_id),
    }),
    model: (lease, operations, modelConfig) => input.modelFactory({ user_id: lease.user_id, model_config: modelConfig, operations }),
    loadExisting: (lease, brief) => input.loadExisting(lease.user_id, brief),
    persistQuotes: input.persistQuotes,
    commitAssessment: input.commitAssessment,
    financialCriteria: createFinancialCriteriaEvaluator({ pool: input.pool, evidence: createEvidenceFinancialPort, clock: input.clock }),
    financialReadiness: () => requireFinancialReadiness(input.pool, ["discovery"]),
  });
}
