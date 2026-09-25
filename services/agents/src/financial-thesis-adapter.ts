// Numerical thesis conditions through the verified financial engine.
//
// Each saved metric condition is a saved rule (financial-engine/saved-rule.ts)
// evaluated at the assessment run's pinned cutoff: met or not met maps to
// supported or challenged by the saved comparison; any gap is unresolved. A
// condition is sealed under its own certificate, and only while the thesis
// version it was computed for is still the agent's current one.

import { createRuntimeAuthority, type FinancialRuntimeAuthority } from "../../financial-core/src/index.ts";
import type { PersistParentArtifact } from "../../financial-engine/src/finalize.ts";
import { evaluateSavedRule, type SavedRuleDeps } from "../../financial-engine/src/saved-rule.ts";
import type { ConditionAssessment, ThesisVersion } from "./thesis-types.ts";

export type ThesisConditionRun = Readonly<{
  user_id: string;
  thesis: ThesisVersion;
  /** Identifies this assessment run; a retry with the same key resumes, never recomputes. */
  run_key: string;
  /** The pinned cutoff every condition is evaluated at. */
  as_of: string;
}>;

/** Assesses every metric condition of the thesis through the engine; narrative conditions are not touched. */
export async function evaluateFinancialThesisConditions(deps: SavedRuleDeps, run: ThesisConditionRun): Promise<ConditionAssessment[]> {
  const authority = thesisAuthority(run);
  const results: ConditionAssessment[] = [];
  for (const condition of run.thesis.conditions) {
    if (condition.metric === undefined) continue;
    const outcome = await evaluateSavedRule(deps, {
      authority,
      request_key: `${run.run_key}:${condition.condition_id}`,
      subject: run.thesis.subject_ref,
      rule: condition.metric,
      as_of: run.as_of,
      reporting_basis: "as_restated",
      origin: { kind: "thesis_condition", ref: `thesis:${run.thesis.thesis_version_id}:${condition.condition_id}` },
      threshold_attribution: { kind: "saved_thesis_condition", ref: condition.condition_id },
      publication_unit_kind: "thesis_condition",
      persistParent: requireCurrentThesis(run.thesis.thesis_version_id),
    });
    results.push({
      condition_id: condition.condition_id,
      status: outcome.status === "met" ? "supported" : outcome.status === "not_met" ? "challenged" : "unresolved",
      reason: outcome.reason,
      claim_refs: [],
      fact_refs: outcome.fact_refs,
      method: outcome.status === "unresolved" ? "no_evidence" : "metric",
      ...(outcome.certified ? { financial: outcome.certified } : {}),
    });
  }
  return results;
}

/**
 * What a reuse decision may compare: status, cited facts, and the certified
 * result's hash (definition, inputs, and outcome) — never snapshot, run, or
 * certificate ids, which differ on every run even for identical evidence.
 */
export function thesisReuseProjection(results: ReadonlyArray<ConditionAssessment>) {
  return results.map((result) => ({
    condition_id: result.condition_id,
    status: result.status,
    fact_refs: [...result.fact_refs].sort(),
    result_hash: result.financial?.result_hash ?? null,
  }));
}

function thesisAuthority(run: ThesisConditionRun): FinancialRuntimeAuthority {
  return createRuntimeAuthority({
    owner_user_id: run.user_id,
    egress_channel: "thesis",
    // The saved thesis version is the parent: a new version is a new parent, never an edit of this one.
    parent: { kind: "thesis_version", id: run.thesis.thesis_version_id, version: `v${run.thesis.version}` },
    allowed_source_classes: ["sec_filing"],
    feature: { surface: "thesis", capability: "financial-condition", mode: "enforce" },
    approval_state: "not_required",
    lease: null,
  });
}

/** Seals the condition only while its thesis version is still the agent's current one, under the agent's lock. */
function requireCurrentThesis(thesisVersionId: string): PersistParentArtifact {
  return async (tx) => {
    const current = await tx.client.query<{ current: boolean }>(
      `select (select v2.thesis_version_id from agent_thesis_versions v2 where v2.agent_id = a.agent_id order by v2.version desc limit 1) = v.thesis_version_id as current
         from agent_thesis_versions v
         join agents a on a.agent_id = v.agent_id
        where v.thesis_version_id = $1::uuid and a.user_id = $2::uuid
        for update of a`,
      [thesisVersionId, tx.run.user_id],
    );
    if (current.rows[0]?.current !== true) throw new Error("the thesis changed during assessment");
  };
}
