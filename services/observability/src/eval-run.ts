import type { QueryExecutor } from "./types.ts";

export type EvalRunResultInput = {
  suite_name: string;
  model_version: string;
  prompt_version: string;
  result_json: unknown;
};

export type EvalRunResultRow = {
  eval_run_result_id: string;
  created_at: Date;
};

// Writes a row to eval_run_results. PX.1 schedules these nightly per suite;
// `model_version` + `prompt_version` let drift reports attribute regressions.
export async function writeEvalRunResult(
  db: QueryExecutor,
  input: EvalRunResultInput,
): Promise<EvalRunResultRow> {
  const { rows } = await db.query<EvalRunResultRow>(
    `insert into eval_run_results
       (suite_name, model_version, prompt_version, result_json)
     values ($1, $2, $3, $4::jsonb)
     returning eval_run_result_id, created_at`,
    [
      input.suite_name,
      input.model_version,
      input.prompt_version,
      JSON.stringify(input.result_json),
    ],
  );
  return rows[0];
}
