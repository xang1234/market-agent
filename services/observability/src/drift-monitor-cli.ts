import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { runGoldenEvalDriftMonitor } from "./drift-monitor.ts";
import type { GoldenEvalEvaluator } from "./golden-eval-runner.ts";

type EvaluatorModule = {
  evaluateGoldenCase?: GoldenEvalEvaluator;
  default?: GoldenEvalEvaluator;
};

async function main(): Promise<void> {
  const databaseUrl = process.env.OBSERVABILITY_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL or OBSERVABILITY_DATABASE_URL is required");
  const evaluatorModule = process.env.GOLDEN_EVAL_EVALUATOR_MODULE;
  if (!evaluatorModule) throw new Error("GOLDEN_EVAL_EVALUATOR_MODULE is required");

  const imported = await import(evaluatorModule) as EvaluatorModule;
  const evaluate = imported.evaluateGoldenCase ?? imported.default;
  if (typeof evaluate !== "function") {
    throw new Error("GOLDEN_EVAL_EVALUATOR_MODULE must export evaluateGoldenCase or a default evaluator");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await runGoldenEvalDriftMonitor(pool, {
      suite_name: process.env.GOLDEN_EVAL_SUITE_NAME ?? "golden-nightly",
      model_version: requiredEnv("GOLDEN_EVAL_MODEL_VERSION"),
      prompt_version: requiredEnv("GOLDEN_EVAL_PROMPT_VERSION"),
      casesDir: process.env.GOLDEN_EVAL_CASES_DIR,
      evaluate,
      policy: { failOnAlert: process.env.GOLDEN_EVAL_FAIL_ON_ALERT !== "false" },
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.policy_status === "failed") process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
