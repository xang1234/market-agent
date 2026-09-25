// Executing Discovery's numerical criteria within the campaign's authority.
//
// Each candidate × numerical criterion is one deterministic engine plan whose
// parent is the Discovery run, carrying the worker's lease epoch as its fence.
// The engine leases such a run only under that fenced parent authority, the
// recovery supervisor never resumes it, and its finalization commits only
// while this worker's campaign lease is live, the run is not cancelled, the
// approved brief is unchanged, and the candidate is still being researched.
// No provider or model call is involved: local arithmetic over stored
// evidence, never permission for extra network work or budget.

import { createRuntimeAuthority, type FinancialRuntimeAuthority } from "../../financial-core/src/index.ts";
import type { PersistParentArtifact } from "../../financial-engine/src/finalize.ts";
import { evaluateSavedRule, type SavedRuleDeps } from "../../financial-engine/src/saved-rule.ts";
import { assertApprovedBrief, briefAuthorityVersion, numericalCriteria } from "./financial-criteria.ts";
import { certifiedCriterionOutcome, hideOutcomes, outcomesWithHiddenInputs } from "./financial-outcomes.ts";
import type { Lease } from "./ports.ts";
import type { Citation, CompanyIdentity, CriterionOutcome, Id, SavedBrief } from "./types.ts";

/** One deterministic outcome per numerical criterion of the approved brief, by criterion id. */
export type FinancialCriteriaEvaluator = (
  lease: Lease,
  input: { brief: SavedBrief; candidate_id: Id; identity: CompanyIdentity; as_of: string },
) => Promise<ReadonlyMap<Id, CriterionOutcome<Citation>>>;

export function createFinancialCriteriaEvaluator(deps: SavedRuleDeps & {
  /** The worker's clock, the same one its campaign lease is judged by (worker-lock.ts). */
  clock?: () => Date;
}): FinancialCriteriaEvaluator {
  const clock = deps.clock ?? (() => new Date());
  return async (lease, input) => {
    assertApprovedBrief(input.brief);
    const outcomes = new Map<Id, CriterionOutcome<Citation>>();
    for (const criterion of numericalCriteria(input.brief.brief)) {
      const outcome = await evaluateSavedRule(deps, {
        authority: campaignAuthority(lease, input.brief),
        // Stable per candidate and criterion, so a resumed run reuses the committed calculation.
        request_key: `${input.candidate_id}:${criterion.criterion_id}`,
        subject: { kind: "issuer", id: input.identity.issuer_id },
        rule: criterion.metric,
        as_of: input.as_of,
        reporting_basis: "as_restated",
        origin: { kind: "discovery_criterion", ref: `discovery:${lease.run_id}:${input.candidate_id}:${criterion.criterion_id}` },
        threshold_attribution: { kind: "approved_discovery_brief", ref: `${input.brief.brief_id}:${criterion.criterion_id}` },
        publication_unit_kind: "discovery_assessment",
        persistParent: requireLiveCampaign(lease, input.brief.brief_id, input.candidate_id, clock),
      });
      outcomes.set(criterion.criterion_id, certifiedCriterionOutcome(criterion, outcome));
    }
    return hideOutcomes(outcomes, await outcomesWithHiddenInputs(deps.pool, lease.user_id, [...outcomes.values()]));
  };
}

function campaignAuthority(lease: Lease, brief: SavedBrief): FinancialRuntimeAuthority {
  return createRuntimeAuthority({
    owner_user_id: lease.user_id,
    egress_channel: "discovery",
    parent: { kind: "discovery_run", id: lease.run_id, version: briefAuthorityVersion(brief) },
    allowed_source_classes: ["sec_filing"],
    feature: { surface: "discovery", capability: "financial-criterion", mode: "enforce" },
    approval_state: "approved",
    lease: { epoch: lease.epoch, fence_token: lease.worker_id },
  });
}

/** Commits a criterion's certificate only under this worker's live, uncancelled campaign lease and approved brief. */
function requireLiveCampaign(lease: Lease, briefId: Id, candidateId: Id, clock: () => Date): PersistParentArtifact {
  return async (tx) => {
    const row = (await tx.client.query<{ live: boolean; lease_epoch: string | number; lease_owner: string | null; cancel_requested_at: unknown; status: string; brief_id: string; state: string | null }>(
      `select r.lease_expires_at > $4::timestamptz as live, r.lease_epoch, r.lease_owner, r.cancel_requested_at, r.status, r.brief_id::text,
              (select c.state from discovery_candidates c where c.run_id = r.run_id and c.candidate_id = $3::uuid) as state
         from discovery_runs r
        where r.run_id = $1::uuid and r.user_id = $2::uuid
        for update of r`,
      [lease.run_id, lease.user_id, candidateId, clock().toISOString()],
    )).rows[0];
    if (!row || row.live !== true || Number(row.lease_epoch) !== lease.epoch || row.lease_owner !== lease.worker_id) {
      throw new Error("the campaign lease is no longer current");
    }
    if (row.cancel_requested_at !== null || row.status !== "running") throw new Error("the campaign run is no longer running");
    if (row.brief_id !== briefId) throw new Error("the campaign's approved brief changed");
    if (row.state !== "researching") throw new Error("the candidate is no longer being researched");
  };
}
