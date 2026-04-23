import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { writeEvalRunResult } from "../src/eval-run.ts";

test("writeEvalRunResult persists a row and round-trips result_json", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for observability integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-8-2");
  const client = await connectedClient(t, databaseUrl);

  const { eval_run_result_id, created_at } = await writeEvalRunResult(client, {
    suite_name: "ticker_disambiguation",
    model_version: "claude-opus-4-7",
    prompt_version: "resolver/v1.2",
    result_json: { passed: 47, failed: 3, cases: [{ id: "GOOG/GOOGL", outcome: "ambiguous" }] },
  });

  assert.match(eval_run_result_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.ok(created_at instanceof Date);

  const { rows } = await client.query(
    `select suite_name, model_version, prompt_version, result_json
     from eval_run_results where eval_run_result_id = $1`,
    [eval_run_result_id],
  );
  assert.deepEqual(rows[0], {
    suite_name: "ticker_disambiguation",
    model_version: "claude-opus-4-7",
    prompt_version: "resolver/v1.2",
    result_json: { passed: 47, failed: 3, cases: [{ id: "GOOG/GOOGL", outcome: "ambiguous" }] },
  });
});
