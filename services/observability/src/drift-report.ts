import type {
  GoldenEvalCategory,
  GoldenEvalCategorySummary,
  GoldenEvalRunResultJson,
} from "./golden-eval-runner.ts";
import type { QueryExecutor } from "./types.ts";

export type GoldenEvalDriftRun = {
  eval_run_result_id: string;
  created_at: Date | string;
  result_json: GoldenEvalRunResultJson;
};

export type GoldenEvalCategoryDrift = {
  category: GoldenEvalCategory;
  case_count_delta: number;
  passed_delta: number;
  failed_delta: number;
  previous_failed: number;
  current_failed: number;
};

export type GoldenEvalDriftReport = {
  suite_name: string;
  previous_run: GoldenEvalDriftRunRef;
  current_run: GoldenEvalDriftRunRef;
  summary_delta: {
    case_count_delta: number;
    passed_delta: number;
    failed_delta: number;
  };
  regressed_categories: ReadonlyArray<GoldenEvalCategoryDrift>;
  improved_categories: ReadonlyArray<GoldenEvalCategoryDrift>;
  alert: boolean;
};

export type BuildGoldenEvalDriftReportInput = {
  previous: GoldenEvalDriftRun;
  current: GoldenEvalDriftRun;
};

export type ReadLatestGoldenEvalDriftReportInput = {
  suite_name: string;
};

export type GoldenEvalDriftRunRef = {
  eval_run_result_id: string;
  created_at: string;
  suite_name: string;
  model_version: string;
  prompt_version: string;
};

type EvalRunResultDriftRow = {
  eval_run_result_id: string;
  suite_name: string;
  model_version: string;
  prompt_version: string;
  created_at: Date;
  result_json: GoldenEvalRunResultJson;
};

export function buildGoldenEvalDriftReport(
  input: BuildGoldenEvalDriftReportInput,
): GoldenEvalDriftReport {
  assertSameSuite(input.previous, input.current);

  const summary_delta = Object.freeze({
    case_count_delta:
      input.current.result_json.summary.case_count -
      input.previous.result_json.summary.case_count,
    passed_delta:
      input.current.result_json.summary.passed -
      input.previous.result_json.summary.passed,
    failed_delta:
      input.current.result_json.summary.failed -
      input.previous.result_json.summary.failed,
  });

  const categoryDeltas = categoryDeltaRows(input.previous, input.current);
  const regressed_categories = Object.freeze(
    categoryDeltas
      .filter((delta) => delta.failed_delta > 0 || delta.passed_delta < 0)
      .sort(compareRegressionSeverity),
  );
  const improved_categories = Object.freeze(
    categoryDeltas
      .filter((delta) => delta.failed_delta < 0 || delta.passed_delta > 0)
      .sort(compareImprovementSize),
  );

  return Object.freeze({
    suite_name: input.current.result_json.suite_name,
    previous_run: runRef(input.previous),
    current_run: runRef(input.current),
    summary_delta,
    regressed_categories,
    improved_categories,
    alert:
      regressed_categories.length > 0 ||
      summary_delta.failed_delta > 0 ||
      summary_delta.passed_delta < 0,
  });
}

export async function readLatestGoldenEvalDriftReport(
  db: QueryExecutor,
  input: ReadLatestGoldenEvalDriftReportInput,
): Promise<GoldenEvalDriftReport | null> {
  const { rows } = await db.query<EvalRunResultDriftRow>(
    `select eval_run_result_id,
            suite_name,
            model_version,
            prompt_version,
            created_at,
            result_json
       from eval_run_results
      where suite_name = $1
      order by created_at desc, eval_run_result_id desc
      limit 2`,
    [input.suite_name],
  );

  if (rows.length < 2) {
    return null;
  }

  return buildGoldenEvalDriftReport({
    current: rowToDriftRun(rows[0]),
    previous: rowToDriftRun(rows[1]),
  });
}

function categoryDeltaRows(
  previous: GoldenEvalDriftRun,
  current: GoldenEvalDriftRun,
): GoldenEvalCategoryDrift[] {
  const previousByCategory = categoryMap(previous.result_json.categories);
  const currentByCategory = categoryMap(current.result_json.categories);
  const categories = [...new Set([...previousByCategory.keys(), ...currentByCategory.keys()])]
    .sort();

  return categories.map((category) => {
    const previousSummary = previousByCategory.get(category) ?? emptyCategory(category);
    const currentSummary = currentByCategory.get(category) ?? emptyCategory(category);
    return Object.freeze({
      category,
      case_count_delta:
        currentSummary.case_count - previousSummary.case_count,
      passed_delta: currentSummary.passed - previousSummary.passed,
      failed_delta: currentSummary.failed - previousSummary.failed,
      previous_failed: previousSummary.failed,
      current_failed: currentSummary.failed,
    });
  });
}

function assertSameSuite(
  previous: GoldenEvalDriftRun,
  current: GoldenEvalDriftRun,
): void {
  if (previous.result_json.suite_name !== current.result_json.suite_name) {
    throw new Error(
      `Golden eval drift report requires runs from the same suite: previous=${previous.result_json.suite_name}, current=${current.result_json.suite_name}`,
    );
  }
}

function categoryMap(
  categories: ReadonlyArray<GoldenEvalCategorySummary>,
): Map<GoldenEvalCategory, GoldenEvalCategorySummary> {
  return new Map(categories.map((category) => [category.category, category]));
}

function emptyCategory(category: GoldenEvalCategory): GoldenEvalCategorySummary {
  return Object.freeze({
    category,
    case_count: 0,
    passed: 0,
    failed: 0,
  });
}

function compareRegressionSeverity(
  left: GoldenEvalCategoryDrift,
  right: GoldenEvalCategoryDrift,
): number {
  return (
    right.failed_delta - left.failed_delta ||
    left.passed_delta - right.passed_delta ||
    left.category.localeCompare(right.category)
  );
}

function compareImprovementSize(
  left: GoldenEvalCategoryDrift,
  right: GoldenEvalCategoryDrift,
): number {
  return (
    left.failed_delta - right.failed_delta ||
    right.passed_delta - left.passed_delta ||
    left.category.localeCompare(right.category)
  );
}

function runRef(run: GoldenEvalDriftRun): GoldenEvalDriftRunRef {
  return Object.freeze({
    eval_run_result_id: run.eval_run_result_id,
    created_at:
      run.created_at instanceof Date
        ? run.created_at.toISOString()
        : run.created_at,
    suite_name: run.result_json.suite_name,
    model_version: run.result_json.model_version,
    prompt_version: run.result_json.prompt_version,
  });
}

// Indexed row columns are authoritative over duplicated payload fields when reconstructing drift inputs.
function rowToDriftRun(row: EvalRunResultDriftRow): GoldenEvalDriftRun {
  return Object.freeze({
    eval_run_result_id: row.eval_run_result_id,
    created_at: row.created_at,
    result_json: Object.freeze({
      ...row.result_json,
      suite_name: row.suite_name,
      model_version: row.model_version,
      prompt_version: row.prompt_version,
    }),
  });
}
