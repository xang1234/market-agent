// Atomic publication of one financial unit. On the caller's pinned client, in
// a single fenced transaction:
//
//   1. lock the run under the current lease (stale workers, cancellation, and
//      terminal runs are fenced out) and check the parent version;
//   2. lock the unit row; a sealed unit returns its existing publication, so a
//      retry is idempotent;
//   3. share-lock the bound sources and facts in canonical order (Evidence's
//      access-lock protocol), so a revocation either commits first and is seen
//      below, or waits for this commit;
//   4. reverify the unit from ledger records and seal the snapshot with its
//      certificate (Snapshot's sealer; nothing verified earlier is trusted);
//   5. seal the unit, finalize its results, append the publication event, and
//      let the parent persist its artifact through the same transaction;
//   6. commit. Any failure rolls every step back: no snapshot, certificate,
//      sealed unit, finalized result, event, or parent artifact survives.
//
// No provider or model call belongs here. The parent callback receives the
// fenced transaction and must write through its client only; a second
// connection could not see or join this transaction.

import {
  ExecutionIntegrityError,
  type FinancialPlanV1,
  type FinancialRuntimeAuthority,
  type LocalId,
} from "../../financial-core/src/index.ts";
import { lockEvidenceForPublication } from "../../evidence/src/financial-access-lock.ts";
import { buildFinancialSealInput, toSealFactRow } from "../../snapshot/src/seal-input.ts";
import { sealSnapshotInTransaction, type SnapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import type { SnapshotVerifierFailure, VerifierBlock } from "../../snapshot/src/snapshot-verifier.ts";
import { appendRunEvent } from "./events-repo.ts";
import { fencedTransaction, type FencedTx, type RunLease } from "./lease.ts";
import { transitionRun } from "./run-repo.ts";

export type ParentPublication = Readonly<{
  run_id: string;
  unit_id: LocalId;
  snapshot_id: string;
  certificate_digest: string;
  result_ids: ReadonlyArray<string>;
}>;

/** Persists the parent's artifact inside the finalization transaction, through `tx.client` only. */
export type PersistParentArtifact = (tx: FencedTx, publication: ParentPublication) => Promise<void>;

export type FinalizationRejection = "parent_version_mismatch" | "unit_not_ready" | "evidence_unavailable" | "verification_failed";

export type FinalizationResult =
  | Readonly<{ status: "published"; publication: ParentPublication; run_completed: boolean }>
  | Readonly<{ status: "existing"; publication: Omit<ParentPublication, "result_ids"> }>
  | Readonly<{ status: "rejected"; reason_code: FinalizationRejection; failures: ReadonlyArray<SnapshotVerifierFailure> }>;

export async function finalizeUnit(input: {
  client: SnapshotTransactionClient;
  lease: RunLease;
  authority: FinancialRuntimeAuthority;
  unit_id: LocalId;
  snapshot_id: string;
  blocks: ReadonlyArray<VerifierBlock>;
  persistParent: PersistParentArtifact;
}): Promise<FinalizationResult> {
  const { client, lease, authority, unit_id: unitId } = input;
  return fencedTransaction(client, lease, async (tx) => {
    const { run } = tx;
    if (run.user_id !== authority.owner_user_id || run.parent_kind !== authority.parent.kind || run.parent_id !== authority.parent.id) {
      throw new ExecutionIntegrityError("the authority does not own this run's parent");
    }
    if (run.parent_version !== authority.parent.version) return rejected("parent_version_mismatch");

    const unit = (await tx.client.query<{ state: string; snapshot_id: string | null; certificate_digest: string | null }>(
      `select state, snapshot_id::text, certificate_digest from financial_run_units where run_id = $1 and unit_id = $2 for update`,
      [run.run_id, unitId],
    )).rows[0];
    if (!unit) throw new ExecutionIntegrityError(`unit ${unitId} was not declared`);
    if (unit.state === "sealed") {
      return { status: "existing", publication: { run_id: run.run_id, unit_id: unitId, snapshot_id: unit.snapshot_id!, certificate_digest: unit.certificate_digest! } };
    }
    if (unit.state !== "computed") return rejected("unit_not_ready");

    const facts = (await tx.client.query<Parameters<typeof toSealFactRow>[0]>(
      `select f.fact_id::text, f.source_id::text, f.unit, f.period_kind::text, f.period_start::text, f.period_end::text, f.fiscal_year, f.fiscal_period
         from financial_run_units u
         join financial_run_inputs i on i.run_id = u.run_id and u.closure_node_ids ? i.input_slot and i.binding_status = 'bound'
         join facts f on f.fact_id = i.fact_id
        where u.run_id = $1 and u.unit_id = $2
        order by f.fact_id`,
      [run.run_id, unitId],
    )).rows.map(toSealFactRow);
    const locked = await lockEvidenceForPublication(tx.client, {
      source_ids: facts.map((fact) => fact.source_id),
      fact_ids: facts.map((fact) => fact.fact_id),
    });
    if (locked.missing_source_ids.length > 0 || locked.missing_fact_ids.length > 0) return rejected("evidence_unavailable");

    const plan = (await tx.client.query<{ plan: FinancialPlanV1 }>(`select plan from financial_plans where plan_id = $1`, [run.plan_id])).rows[0]!.plan;
    const sealed = await sealSnapshotInTransaction(client, buildFinancialSealInput({
      snapshot_id: input.snapshot_id,
      claim: { owner_user_id: run.user_id, run_id: run.run_id, unit_id: unitId },
      knowledgeCutoff: run.knowledge_cutoff,
      subjectRefs: plan.subjects.members.map((member) => member.subject_ref),
      blocks: input.blocks,
      boundFacts: facts,
    }));
    if (!sealed.ok) return rejected("verification_failed", sealed.verification.failures);
    const financial = sealed.verification.financial;
    if (!financial) throw new ExecutionIntegrityError("a financial seal verified without a certificate");

    await tx.client.query(
      `update financial_run_units set state = 'sealed', snapshot_id = $3, certificate_digest = $4, updated_at = now()
        where run_id = $1 and unit_id = $2`,
      [run.run_id, unitId, input.snapshot_id, financial.certificate_digest],
    );
    await tx.client.query(
      `update financial_results
          set state = 'finalized', disposition = case when disposition = 'computed' then 'verified' else disposition end, finalized_at = now()
        where run_id = $1 and unit_id = $2 and state = 'draft'`,
      [run.run_id, unitId],
    );
    await appendRunEvent(tx.client, run.run_id, "unit_sealed", { unit_id: unitId, payload: { certificate_digest: financial.certificate_digest } });

    const publication: ParentPublication = {
      run_id: run.run_id,
      unit_id: unitId,
      snapshot_id: input.snapshot_id,
      certificate_digest: financial.certificate_digest,
      result_ids: financial.result_ids,
    };
    await input.persistParent(tx, publication);

    const open = Number((await tx.client.query<{ n: number }>(
      `select count(*)::int as n from financial_run_units where run_id = $1 and state in ('pending', 'computed')`,
      [run.run_id],
    )).rows[0]!.n);
    if (open === 0) await transitionRun(tx, "completed", { coverage_state: run.coverage_state ?? "none" });
    return { status: "published", publication, run_completed: open === 0 };
  });
}

function rejected(reason_code: FinalizationRejection, failures: ReadonlyArray<SnapshotVerifierFailure> = []): FinalizationResult {
  return { status: "rejected", reason_code, failures };
}
