import assert from "node:assert/strict";
import test from "node:test";

import type { ControlledRouter } from "../../llm/src/router.ts";
import { createCampaignModel } from "../src/model.ts";
import { createOperationRunner } from "../src/operations.ts";
import { createDiscoveryRepository } from "../src/repository.ts";
import { DiscoveryError } from "../src/types.ts";
import { parseBrief, validateModelRequest } from "../src/validation.ts";
import type * as D from "../src/types.ts";
import type * as P from "../src/ports.ts";

type Assert<T extends true> = T;
type IsAssignable<From, To> = From extends To ? true : false;
type RepositoryFactoryIsCanonical = Assert<IsAssignable<ReturnType<typeof createDiscoveryRepository>, P.DiscoveryRepository>>;
type OperationRunnerFactoryIsCanonical = Assert<IsAssignable<typeof createOperationRunner, (repo: P.DiscoveryRepository, lease: P.Lease, signal: AbortSignal) => P.OperationRunner>>;
type CampaignModelFactoryIsCanonical = Assert<IsAssignable<typeof createCampaignModel, (router: ControlledRouter, operations: P.OperationRunner) => P.CampaignModel>>;
type AdvertisedPorts = P.Lease | P.Checkpoint | P.Excerpt | P.PacketFact | P.EvidencePacket | P.OperationContext |
  P.OperationRunner | P.CampaignModel | P.SearchProvider | P.IdentityProvider | P.EvidenceProvider | P.FinancialProvider |
  P.Providers | P.DiscoveryContext | P.DiscoveryPool | P.AssessmentContext | P.AttemptReservation | P.StoredCandidate |
  P.DiscoveryRepository | P.WorkerDeps | P.DiscoveryService | P.DiscoveryDb;
type AdvertisedDomainTypes = D.Id | D.Level | D.RunStatus | D.Stage | D.CandidateState | D.Resource | D.Origin |
  D.Citation | D.RawCitation | D.DimensionName | D.Dimension | D.Mechanism | D.Criterion | D.Brief | D.Limits |
  D.Campaign | D.SavedBrief | D.Coverage | D.RunRecord | D.CompanyIdentity | D.SearchHit | D.DiscoveredCandidate |
  D.CriterionOutcome | D.AnalystOutput | D.SkepticOutput | D.CandidateDecision | D.AssessedCandidate | D.RankedDecision |
  D.SourceView | D.CandidateView | D.EventKind | D.CampaignEvent | D.RunView | D.Page<unknown> | D.EventPage |
  D.Readiness | D.CampaignDetail | D.ResearchHandoff | D.DiscoveryErrorCode;
void (null as unknown as RepositoryFactoryIsCanonical | OperationRunnerFactoryIsCanonical | CampaignModelFactoryIsCanonical | AdvertisedPorts | AdvertisedDomainTypes);

test("canonical discovery contracts expose repositories, services, and validators", () => {
  assert.equal(typeof createDiscoveryRepository, "function");
  assert.equal(typeof createOperationRunner, "function");
  assert.equal(typeof createCampaignModel, "function");
  assert.equal(typeof DiscoveryError, "function");
  assert.equal(typeof parseBrief, "function");
  assert.equal(typeof validateModelRequest, "function");
});
