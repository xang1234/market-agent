import {
  readLatestGoldenEvalDriftReport,
  type GoldenEvalDriftReport,
} from "./drift-report.ts";
import {
  DEFAULT_GOLDEN_EVAL_CASES_DIR,
  loadGoldenEvalCases,
  runGoldenEvalSuite,
  type GoldenEvalCase,
  type GoldenEvalEvaluator,
  type RunGoldenEvalSuiteResult,
} from "./golden-eval-runner.ts";
import type { QueryExecutor } from "./types.ts";

export type GoldenEvalDriftPolicy = {
  failOnAlert?: boolean;
};

export type RunGoldenEvalDriftMonitorInput = {
  suite_name: string;
  model_version: string;
  prompt_version: string;
  cases?: ReadonlyArray<GoldenEvalCase>;
  casesDir?: string;
  evaluate: GoldenEvalEvaluator;
  policy?: GoldenEvalDriftPolicy;
};

export type RunGoldenEvalDriftMonitorResult = {
  run: RunGoldenEvalSuiteResult;
  drift_report: GoldenEvalDriftReport | null;
  policy_status: "passed" | "failed";
};

export async function runGoldenEvalDriftMonitor(
  db: QueryExecutor,
  input: RunGoldenEvalDriftMonitorInput,
): Promise<RunGoldenEvalDriftMonitorResult> {
  const cases = input.cases ?? loadGoldenEvalCases(input.casesDir ?? DEFAULT_GOLDEN_EVAL_CASES_DIR);
  const run = await runGoldenEvalSuite(db, {
    suite_name: input.suite_name,
    model_version: input.model_version,
    prompt_version: input.prompt_version,
    cases,
    evaluate: input.evaluate,
  });
  const drift_report = await readLatestGoldenEvalDriftReport(db, {
    suite_name: input.suite_name,
  });
  const policy_status =
    input.policy?.failOnAlert === true && drift_report?.alert === true ? "failed" : "passed";

  return Object.freeze({
    run,
    drift_report,
    policy_status,
  });
}
