// Per-unit durable checkpoints. What a unit publishes is derived purely by the
// core (unitPublication); this module gives each result its persistence
// identity and writes a unit's computations, results, and state in one
// fenced transaction. A resumed worker re-derives the same hashes, skips units
// already checkpointed, and any divergence from what was persisted is an
// integrity failure rather than an overwrite.

import { randomUUID } from "node:crypto";
import {
  ExecutionIntegrityError,
  unitPublication,
  validateDraftResult,
  type ComputationRecord,
  type CoverageState,
  type DraftFinancialResultV1,
  type FinancialPlanV1,
  type GraphEvaluation,
  type LocalId,
  type Sha256Hex,
} from "../../financial-core/src/index.ts";
import { fencedTransaction, type RunLease } from "./lease.ts";
import type { SqlExecutor } from "./ports.ts";
import { persistComputation, persistResult } from "./result-repo.ts";
import { markUnitComputed, rejectUnit } from "./unit-repo.ts";

export type UnitCheckpoint = Readonly<{
  unit_id: LocalId;
  rejected: boolean;
  coverage: CoverageState;
  computations: ReadonlyArray<ComputationRecord>;
  results: ReadonlyArray<Readonly<{ result: DraftFinancialResultV1; result_hash: Sha256Hex }>>;
}>;

/** The unit's publication with a fresh result identity per requested output. */
export function buildUnitCheckpoint(
  plan: FinancialPlanV1,
  evaluation: GraphEvaluation,
  hashes: ReadonlyMap<LocalId, Sha256Hex>,
  unitId: LocalId,
  newResultId: () => string = randomUUID,
): UnitCheckpoint {
  const publication = unitPublication(plan, evaluation, hashes, unitId);
  const results = publication.results.map(({ result_hash, ...expected }) => {
    const validated = validateDraftResult({ schema_version: "financial_result.v1", result_id: newResultId(), state: "draft", ...expected });
    if (!validated.ok) {
      throw new ExecutionIntegrityError(`draft result ${expected.output_id} is invalid: ${validated.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    }
    return { result: validated.value, result_hash };
  });
  return { ...publication, results };
}

/**
 * Writes one unit's computations, results, and state in a single fenced
 * transaction. Returns false when the unit was already checkpointed.
 */
export async function checkpointUnit(client: SqlExecutor, lease: RunLease, checkpoint: UnitCheckpoint): Promise<boolean> {
  return fencedTransaction(client, lease, async (tx) => {
    const state = (await tx.client.query<{ state: string }>(
      `select state from financial_run_units where run_id = $1 and unit_id = $2`,
      [lease.run_id, checkpoint.unit_id],
    )).rows[0]?.state;
    if (state === undefined) throw new ExecutionIntegrityError(`unit ${checkpoint.unit_id} was not declared`);
    if (state !== "pending") return false;
    const computationIds = new Map<LocalId, string>();
    for (const computation of checkpoint.computations) {
      computationIds.set(computation.node_id, await persistComputation(tx.client, lease.run_id, computation));
    }
    for (const { result, result_hash } of checkpoint.results) {
      await persistResult(tx.client, lease.run_id, result, result_hash, computationIds.get(result.node_id) ?? null);
    }
    if (checkpoint.rejected) await rejectUnit(tx, checkpoint.unit_id, "integrity_failure");
    else await markUnitComputed(tx, checkpoint.unit_id, checkpoint.coverage);
    return true;
  });
}
