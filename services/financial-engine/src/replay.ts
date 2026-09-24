// Verification replay of a saved run. Three things are kept apart:
//
//   * saved display — reading what was sealed (read-model.ts, inspection.ts);
//   * verification replay — this module: recompute the original run from its
//     pinned bindings, plan, and policies with this build's reviewed versions,
//     and compare with what was committed;
//   * recalculation — a new run from the parent feature, with current
//     evidence. Never done here.
//
// A replay takes no evidence port and no model: it cannot select evidence or
// call a provider. It never seals and never issues a certificate. A version the
// build does not ship makes the replay `replay_version_unavailable`; evidence
// revoked or erased since the original makes it `replay_evidence_unavailable`
// — a warning, not a fresh certificate of evidence that is no longer valid.

import {
  evaluateBoundPlan,
  ExecutionIntegrityError,
  nodeLineageHashes,
  unitPublication,
  type FinancialPlanV1,
} from "../../financial-core/src/index.ts";
import { loadBindings } from "./bind-inputs.ts";
import { fencedTransaction, type LeaseClaimant, type RunLease } from "./lease.ts";
import type { SqlExecutor } from "./ports.ts";
import { readClosureInputs } from "./read-model.ts";
import type { RunRecord } from "./run-record.ts";
import { getRun, transitionRun } from "./run-repo.ts";
import { FINANCIAL_VERSION_REGISTRY, unsupportedPlanVersion, type FinancialVersionRegistry } from "./version-registry.ts";

export type ReplayFailure = "replay_version_unavailable" | "replay_evidence_unavailable" | "replay_mismatch" | "replay_source_unavailable";

export type ReplayOutcome =
  | Readonly<{ status: "verified"; run_id: string; replay_of_run_id: string; verified_outputs: ReadonlyArray<string> }>
  | Readonly<{ status: "failed"; run_id: string; reason_code: ReplayFailure; output_ids: ReadonlyArray<string> }>;

/** A replay leases as its run's owner and parent; it holds no feature authority because it binds and publishes nothing. */
export function replayClaimant(run: RunRecord): LeaseClaimant {
  return { owner_user_id: run.user_id, parent: { kind: run.parent_kind, id: run.parent_id, version: run.parent_version }, lease: null };
}

/** Executes a leased replay run to its terminal state and reports the comparison. */
export async function executeReplay(input: {
  client: SqlExecutor;
  lease: RunLease;
  registry?: FinancialVersionRegistry;
}): Promise<ReplayOutcome> {
  const { client, lease } = input;
  const registry = input.registry ?? FINANCIAL_VERSION_REGISTRY;
  const replay = await getRun(client, lease.owner_user_id, lease.run_id);
  const original = replay?.replay_of_run_id ? await getRun(client, lease.owner_user_id, replay.replay_of_run_id) : null;
  if (!replay || !original || original.execution_state !== "completed") return finish(client, lease, "replay_source_unavailable");

  const plan = (await client.query<{ plan: FinancialPlanV1 }>(
    `select plan from financial_plans where plan_id = $1 and user_id = $2`,
    [original.plan_id, original.user_id],
  )).rows[0]!.plan;
  if (unsupportedPlanVersion(plan, registry) !== null) return finish(client, lease, "replay_version_unavailable");

  // Reauthorize the whole input closure: erased or revoked evidence is never replayed as valid.
  const slots = plan.operations.filter((node) => node.operation === "reported_metric").map((node) => node.node_id);
  const closure = await readClosureInputs(client, original.user_id, original.run_id, slots);
  if (closure.length !== slots.length || closure.some((input) => !input.available)) return finish(client, lease, "replay_evidence_unavailable");

  let bindings, evaluation, hashes;
  try {
    bindings = await loadBindings(client, original.run_id);
    evaluation = evaluateBoundPlan(plan, bindings);
    hashes = nodeLineageHashes(plan, evaluation, bindings);
  } catch (error) {
    // Pinned bindings that no longer match their hashes cannot reproduce anything.
    if (error instanceof ExecutionIntegrityError) return finish(client, lease, "replay_mismatch");
    throw error;
  }
  const committed = new Map((await client.query<{ unit_id: string; output_id: string; result_hash: string }>(
    `select r.unit_id, r.output_id, r.result_hash
       from financial_results r join financial_run_units u on u.run_id = r.run_id and u.unit_id = r.unit_id
      where r.run_id = $1 and r.state = 'finalized' and u.state = 'sealed'`,
    [original.run_id],
  )).rows.map((row) => [row.output_id, row]));
  const units = new Set([...committed.values()].map((row) => row.unit_id));
  const recomputed = new Map([...units].flatMap((unitId) => unitPublication(plan, evaluation, hashes, unitId).results.map((result) => [result.output_id, result.result_hash] as const)));
  const mismatched = [...committed.values()].filter((row) => recomputed.get(row.output_id) !== row.result_hash).map((row) => row.output_id).sort();
  if (mismatched.length > 0) return finish(client, lease, "replay_mismatch", mismatched);

  await fencedTransaction(client, lease, (tx) => transitionRun(tx, "completed", { coverage_state: original.coverage_state ?? "none" }));
  return { status: "verified", run_id: replay.run_id, replay_of_run_id: original.run_id, verified_outputs: [...committed.keys()].sort() };
}

async function finish(client: SqlExecutor, lease: RunLease, reason: ReplayFailure, outputIds: ReadonlyArray<string> = []): Promise<ReplayOutcome> {
  await fencedTransaction(client, lease, (tx) => transitionRun(tx, "failed", { failure_code: reason }));
  return { status: "failed", run_id: lease.run_id, reason_code: reason, output_ids: outputIds };
}
