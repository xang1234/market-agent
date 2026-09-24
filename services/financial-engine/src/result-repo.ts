// Idempotent persistence of draft computations and requested-output results.
// A retry writes nothing new; a retry that would produce a different payload
// for the same node or output is an integrity failure (non-determinism or
// tampering), never an overwrite. Draft rows are not publicly readable as
// verified — only finalization (T15) can award that.

import {
  ExecutionIntegrityError,
  type ComputationRecord,
  type DraftFinancialResultV1,
  type LocalId,
  type Sha256Hex,
} from "../../financial-core/src/index.ts";
import type { SqlExecutor } from "./ports.ts";

export const FINANCIAL_CODE_VERSION = "financial-core.v1";

export async function persistComputation(client: SqlExecutor, runId: string, computation: ComputationRecord): Promise<string> {
  await client.query(
    `insert into computations (formula_id, code_version, input_refs, output_ref, financial_run_id, node_id, operation_version,
                               numeric_policy_version, definition_versions, output_hash)
     values ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, $9::jsonb, $10)
     on conflict (financial_run_id, node_id) where financial_run_id is not null do nothing`,
    [
      computation.operation,
      FINANCIAL_CODE_VERSION,
      JSON.stringify(computation.input_refs),
      JSON.stringify({ kind: "financial_node", node_id: computation.node_id }),
      runId,
      computation.node_id,
      computation.operation_version,
      computation.numeric_policy_version,
      JSON.stringify(computation.definition_versions),
      computation.output_hash,
    ],
  );
  const stored = (await client.query<{ computation_id: string; output_hash: string }>(
    `select computation_id::text, output_hash from computations where financial_run_id = $1 and node_id = $2`,
    [runId, computation.node_id],
  )).rows[0]!;
  if (stored.output_hash !== computation.output_hash) {
    throw new ExecutionIntegrityError(`computation ${computation.node_id} was already persisted with a different output`);
  }
  return stored.computation_id;
}

export async function persistResult(
  client: SqlExecutor,
  runId: string,
  result: DraftFinancialResultV1,
  resultHash: Sha256Hex,
  computationId: string | null,
): Promise<void> {
  await client.query(
    `insert into financial_results (result_id, run_id, output_id, node_id, unit_id, computation_id, state, disposition, payload, dependencies, result_hash)
     values ($1, $2, $3, $4, $5, $6, 'draft', $7, $8::jsonb, $9::jsonb, $10)
     on conflict (run_id, output_id) do nothing`,
    [result.result_id, runId, result.output_id, result.node_id, result.unit_id, computationId, result.disposition,
      JSON.stringify(result.payload), JSON.stringify(result.dependencies), resultHash],
  );
  const stored = (await client.query<{ result_hash: string }>(
    `select result_hash from financial_results where run_id = $1 and output_id = $2`,
    [runId, result.output_id],
  )).rows[0]!;
  if (stored.result_hash !== resultHash) {
    throw new ExecutionIntegrityError(`result ${result.output_id} was already persisted with a different payload`);
  }
}

export type StoredResult = Readonly<{
  result_id: string;
  output_id: LocalId;
  node_id: LocalId;
  unit_id: LocalId;
  computation_id: string | null;
  state: "draft" | "finalized";
  disposition: string;
  payload: unknown;
  dependencies: LocalId[];
  result_hash: Sha256Hex;
}>;

export async function loadResults(client: SqlExecutor, runId: string): Promise<StoredResult[]> {
  return (await client.query<StoredResult>(
    `select result_id::text, output_id, node_id, unit_id, computation_id::text, state, disposition, payload, dependencies, result_hash
       from financial_results where run_id = $1 order by output_id`,
    [runId],
  )).rows;
}
