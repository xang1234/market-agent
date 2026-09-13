import { randomUUID } from "node:crypto";

import { hashJsonValue } from "../../observability/src/tool-call.ts";
import { createOperationRunner } from "./operations.ts";
import type { DiscoveryReadModel } from "./read-model.ts";
import type { DiscoveryRepository, DiscoveryService, OperationRunner } from "./ports.ts";
import type { Brief, CandidateState, Readiness } from "./types.ts";
import { DiscoveryError } from "./types.ts";
import { parseBrief } from "./validation.ts";

export type DiscoveryDraftPlanner = (input: {
  user_id: string; campaign_id: string; base_brief: Brief | null; signal: AbortSignal;
}) => Promise<unknown>;

export type DiscoveryServiceDeps = {
  repo: DiscoveryRepository;
  reads: DiscoveryReadModel;
  readiness?: () => Readiness;
  draftPlanner?: DiscoveryDraftPlanner;
};

export function createDiscoveryService(deps: DiscoveryServiceDeps): DiscoveryService {
  const readiness = deps.readiness ?? (() => ({ ready: false, missing: ["model", "search", "reference"] }));
  return Object.freeze({
    createCampaign: (userId, input) => deps.repo.createCampaign(userId, input),
    listCampaigns: (userId, cursor, limit) => deps.repo.listCampaigns(userId, cursor, limit),
    async getCampaign(userId, campaignId) {
      const [campaign, brief, runs] = await Promise.all([
        deps.repo.getCampaign(userId, campaignId),
        deps.repo.currentBrief(userId, campaignId),
        deps.repo.listRuns(userId, campaignId, null, 1),
      ]);
      return { campaign, brief, latest_run: runs.items[0] ?? null, readiness: normalizedReadiness(readiness()) };
    },
    async draftBrief(userId, campaignId, expectedVersion) {
      assertVersion(expectedVersion);
      const campaign = await deps.repo.getCampaign(userId, campaignId);
      const base = await deps.repo.currentBrief(userId, campaignId);
      const baseVersion = base?.version ?? 0;
      if (baseVersion !== expectedVersion) throw new DiscoveryError("stale_brief", "brief version is stale");
      if (deps.draftPlanner === undefined || normalizedReadiness(readiness()).missing.includes("model")) {
        throw new DiscoveryError("unavailable", "draft model is unavailable");
      }
      const token = await deps.repo.acquireDraft(userId, campaignId, randomUUID());
      try {
        const operations = draftOperations(deps.repo, { campaign_id: campaign.campaign_id, user_id: userId, draft_token: token.draft_token });
        const raw = await operations.run({
          key: `draft/${token.draft_token}`,
          request_hash: hashJsonValue({ kind: "discovery-brief-draft-v1", campaign_id: campaign.campaign_id, base_version: baseVersion, base_hash: base?.hash ?? null }),
          resource: "model",
          phase: "draft",
          execute: ({ signal }) => deps.draftPlanner!({ user_id: userId, campaign_id: campaign.campaign_id, base_brief: base?.brief ?? null, signal }),
        });
        const current = await deps.repo.currentBrief(userId, campaignId);
        if ((current?.version ?? 0) !== expectedVersion) throw new DiscoveryError("stale_brief", "brief version changed while drafting");
        return { brief: proposalWithServerIds(raw), base_version: baseVersion };
      } finally {
        await deps.repo.releaseDraft(userId, campaignId, token.draft_token);
      }
    },
    saveBrief: (userId, campaignId, expectedVersion, brief) => deps.repo.saveBrief(userId, campaignId, expectedVersion, brief),
    startRun: (userId, campaignId, input) => deps.repo.startRun(userId, campaignId, input),
    listRuns: (userId, campaignId, cursor, limit) => deps.repo.listRuns(userId, campaignId, cursor, limit),
    getRun: (userId, runId) => deps.reads.runView(deps.repo, userId, runId),
    getCandidates: (userId, runId, input) => {
      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new DiscoveryError("validation", "limit must be an integer between 1 and 100");
      if (input.state !== undefined && !candidateStates.has(input.state)) throw new DiscoveryError("validation", "candidate state is invalid");
      return deps.reads.candidatePage(deps.repo, userId, runId, input);
    },
    getEvents: (userId, runId, after) => {
      if (!Number.isInteger(after) || after < 0) throw new DiscoveryError("validation", "event cursor is invalid");
      return deps.reads.eventPage(deps.repo, userId, runId, after);
    },
    cancelRun: (userId, runId) => deps.repo.requestCancel(userId, runId),
    deleteCampaign: (userId, campaignId) => deps.repo.deleteCampaign(userId, campaignId),
  });
}

function draftOperations(repo: DiscoveryRepository, scope: { campaign_id: string; user_id: string; draft_token: string }): OperationRunner {
  return createOperationRunner(repo, scope, new AbortController().signal);
}

function proposalWithServerIds(value: unknown): Brief {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new DiscoveryError("validation", "draft proposal is invalid");
  const raw = structuredClone(value) as Record<string, unknown>;
  const mechanisms = Array.isArray(raw.mechanisms) ? raw.mechanisms : [];
  const remapped = new Map<string, string>();
  raw.mechanisms = mechanisms.map((mechanism) => {
    const record = mechanism as Record<string, unknown>;
    const id = randomUUID();
    if (typeof record.mechanism_id === "string") remapped.set(record.mechanism_id, id);
    return { ...record, mechanism_id: id };
  });
  raw.criteria = (Array.isArray(raw.criteria) ? raw.criteria : []).map((criterion) => ({ ...(criterion as Record<string, unknown>), criterion_id: randomUUID() }));
  raw.queries = (Array.isArray(raw.queries) ? raw.queries : []).map((query, index) => {
    const record = query as Record<string, unknown>;
    const mapped = typeof record.mechanism_id === "string" ? remapped.get(record.mechanism_id) : undefined;
    return { ...record, mechanism_id: mapped ?? (raw.mechanisms as Array<{ mechanism_id: string }>)[index % Math.max(1, mechanisms.length)]?.mechanism_id };
  });
  return parseBrief(raw);
}

function normalizedReadiness(value: Readiness): Readiness {
  const missing = [...new Set(value.missing.filter((item) => item === "model" || item === "search" || item === "reference"))];
  return { ready: missing.length === 0, missing };
}
function assertVersion(value: unknown): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new DiscoveryError("validation", "expected_version must be a non-negative integer");
}
const candidateStates = new Set<CandidateState>(["unresolved_identity", "discovered", "not_selected", "researching", "shortlisted", "eligible_not_shortlisted", "excluded", "needs_evidence", "research_error"]);
