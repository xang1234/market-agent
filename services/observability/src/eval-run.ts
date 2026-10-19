import { serializeJsonValue, type JsonValue, type QueryExecutor } from "./types.ts";

export type EvalRunResultInput = {
  suite_name: string;
  model_version: string;
  prompt_version: string;
  result_json: JsonValue;
};

export type EvalRunResultRow = {
  eval_run_result_id: string;
  created_at: Date;
};

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
      serializeJsonValue(input.result_json),
    ],
  );
  return rows[0];
}
