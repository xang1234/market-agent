// Numerical criterion outcomes: certified calculations bound to a candidate's assessment.
//
// A numerical criterion's outcome comes only from a committed, certified
// calculation reloaded server-side. Its citation is the certified-result
// reference (run, unit, snapshot, certificate, result hash) — a distinct kind
// from claim and fact citations. The calculation's own snapshot verified its
// inputs at its cutoff, so the assessment snapshot does not re-cite them as
// current facts (an as-reported original may since have been restated).
// Model-supplied packet values are never authoritative for a numerical
// criterion; narrative evidence keeps its exact quote and numeric-token checks.
// Authorization is transitive: a certified outcome counts only while its run
// belongs to this campaign run and its inputs are visible to the user.

import type { SqlExecutor } from "../../financial-engine/src/ports.ts";
import type { SavedRuleOutcome } from "../../financial-engine/src/saved-rule.ts";
import type { NumericalCriterion } from "./financial-criteria.ts";
import type { Lease } from "./ports.ts";
import type { CandidateDecision, Citation, CriterionOutcome, Id } from "./types.ts";

/** The deterministic outcome of a numerical criterion: met or not met is pass or fail; anything else is unknown. */
export function certifiedCriterionOutcome(criterion: NumericalCriterion, outcome: SavedRuleOutcome): CriterionOutcome<Citation> {
  return Object.freeze({
    criterion_id: criterion.criterion_id,
    outcome: outcome.status === "met" ? "pass" : outcome.status === "not_met" ? "fail" : "unknown",
    explanation: outcome.reason,
    citations: [],
    ...(outcome.certified ? { certified: outcome.certified } : {}),
  });
}

/** Every numerical criterion has exactly one certified outcome, and no other criterion has one. */
export function assertCertifiedOutcomes(criteria: ReadonlyArray<NumericalCriterion>, outcomes: ReadonlyMap<Id, CriterionOutcome<Citation>>): void {
  if (outcomes.size !== criteria.length || criteria.some((criterion) => !outcomes.has(criterion.criterion_id))) {
    throw new Error("every numerical criterion needs exactly one certified outcome");
  }
}

/** The certified outcomes whose inputs are no longer all visible to the user, by criterion id. */
export async function outcomesWithHiddenInputs(db: SqlExecutor, userId: Id, outcomes: ReadonlyArray<CriterionOutcome<Citation>>): Promise<Set<Id>> {
  const certified = outcomes.filter((outcome) => outcome.certified);
  if (certified.length === 0) return new Set();
  const { rows } = await db.query<{ run_id: string }>(
    `select distinct i.run_id::text
       from financial_run_inputs i
       left join facts f on f.fact_id = i.fact_id and f.invalidated_at is null
       left join sources s on s.source_id = f.source_id and (s.user_id is null or s.user_id = $2::uuid)
      where i.run_id = any($1::uuid[]) and i.binding_status = 'bound' and s.source_id is null`,
    [certified.map((outcome) => outcome.certified!.run_id), userId],
  );
  const hiddenRuns = new Set(rows.map((row) => row.run_id));
  return new Set(certified.filter((outcome) => hiddenRuns.has(outcome.certified!.run_id)).map((outcome) => outcome.criterion_id));
}

/** A certified outcome whose inputs became invisible or erased is unknown: the dependent criterion is hidden safely. */
export function hideOutcomes(outcomes: ReadonlyMap<Id, CriterionOutcome<Citation>>, hidden: ReadonlySet<Id>): Map<Id, CriterionOutcome<Citation>> {
  return new Map([...outcomes].map(([id, outcome]) => [id, hidden.has(id)
    ? Object.freeze({ criterion_id: id, outcome: "unknown" as const, explanation: "An input to this calculation is no longer available.", citations: [] })
    : outcome]));
}

/**
 * Checked in the assessment commit transaction: every certified reference in
 * the decision names a sealed unit of a financial run owned by this user and
 * parented by this campaign run, with every input still visible.
 */
export async function requireCertifiedResults(tx: SqlExecutor, lease: Lease, decision: CandidateDecision): Promise<void> {
  const certified = decision.criteria.filter((criterion) => criterion.certified !== undefined);
  for (const criterion of certified) {
    const ref = criterion.certified!;
    const { rows } = await tx.query<{ ok: boolean }>(
      `select exists (
         select 1 from financial_run_units u join financial_runs r on r.run_id = u.run_id
          where u.run_id = $1::uuid and u.unit_id = $2 and u.state = 'sealed'
            and u.snapshot_id is not distinct from $3::uuid and u.certificate_digest is not distinct from $4
            and r.user_id = $5::uuid and r.parent_kind = 'discovery_run' and r.parent_id = $6::uuid
       ) as ok`,
      [ref.run_id, ref.unit_id, ref.snapshot_id, ref.certificate_digest, lease.user_id, lease.run_id],
    );
    if (rows[0]?.ok !== true) throw new Error(`criterion ${criterion.criterion_id} cites a calculation outside this campaign run`);
  }
  if ((await outcomesWithHiddenInputs(tx, lease.user_id, certified)).size > 0) {
    throw new Error("a certified criterion's inputs are no longer visible");
  }
}
