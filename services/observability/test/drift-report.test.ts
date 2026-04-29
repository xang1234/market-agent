import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGoldenEvalDriftReport,
  readLatestGoldenEvalDriftReport,
} from "../src/drift-report.ts";
import type {
  GoldenEvalCategory,
  GoldenEvalRunResultJson,
} from "../src/golden-eval-runner.ts";
import type { QueryExecutor } from "../src/types.ts";

function runJson(
  overrides: Partial<GoldenEvalRunResultJson> = {},
): GoldenEvalRunResultJson {
  const categories = [
    category("ticker_name_disambiguation", 2, 2, 0),
    category("social_rumor_handling", 2, 2, 0),
    category("snapshot_transform_correctness", 2, 1, 1),
  ];

  return {
    suite_name: "golden-nightly",
    model_version: "model-2026-04-29",
    prompt_version: "analyst/v1",
    summary: {
      case_count: 6,
      passed: 5,
      failed: 1,
    },
    categories,
    cases: [],
    ...overrides,
  };
}

function category(
  name: GoldenEvalCategory,
  case_count: number,
  passed: number,
  failed: number,
) {
  return Object.freeze({
    category: name,
    case_count,
    passed,
    failed,
  });
}

test("buildGoldenEvalDriftReport flags categories whose failures increased", () => {
  const previous = runJson();
  const current = runJson({
    model_version: "model-2026-04-30",
    summary: {
      case_count: 6,
      passed: 4,
      failed: 2,
    },
    categories: [
      category("ticker_name_disambiguation", 2, 2, 0),
      category("social_rumor_handling", 2, 1, 1),
      category("snapshot_transform_correctness", 2, 1, 1),
    ],
  });

  const report = buildGoldenEvalDriftReport({
    previous: {
      eval_run_result_id: "00000000-0000-4000-8000-000000000001",
      created_at: new Date("2026-04-29T00:00:00.000Z"),
      result_json: previous,
    },
    current: {
      eval_run_result_id: "00000000-0000-4000-8000-000000000002",
      created_at: new Date("2026-04-30T00:00:00.000Z"),
      result_json: current,
    },
  });

  assert.equal(report.alert, true);
  assert.deepEqual(report.summary_delta, {
    case_count_delta: 0,
    passed_delta: -1,
    failed_delta: 1,
  });
  assert.deepEqual(report.regressed_categories, [
    {
      category: "social_rumor_handling",
      case_count_delta: 0,
      passed_delta: -1,
      failed_delta: 1,
      previous_failed: 0,
      current_failed: 1,
    },
  ]);
  assert.deepEqual(report.improved_categories, []);
});

test("buildGoldenEvalDriftReport rejects runs from different suites", () => {
  assert.throws(
    () =>
      buildGoldenEvalDriftReport({
        previous: {
          eval_run_result_id: "00000000-0000-4000-8000-000000000001",
          created_at: new Date("2026-04-29T00:00:00.000Z"),
          result_json: runJson({ suite_name: "golden-nightly" }),
        },
        current: {
          eval_run_result_id: "00000000-0000-4000-8000-000000000002",
          created_at: new Date("2026-04-30T00:00:00.000Z"),
          result_json: runJson({ suite_name: "ad-hoc-regression" }),
        },
      }),
    /same suite/,
  );
});

test("readLatestGoldenEvalDriftReport compares the newest two runs for a suite", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return {
        rows: [
          {
            eval_run_result_id: "00000000-0000-4000-8000-000000000002",
            suite_name: "golden-nightly",
            model_version: "model-2026-04-30",
            prompt_version: "analyst/v1",
            created_at: new Date("2026-04-30T00:00:00.000Z"),
            result_json: runJson({
              model_version: "model-2026-04-30",
              summary: { case_count: 6, passed: 4, failed: 2 },
              categories: [
                category("ticker_name_disambiguation", 2, 2, 0),
                category("social_rumor_handling", 2, 1, 1),
                category("snapshot_transform_correctness", 2, 1, 1),
              ],
            }),
          },
          {
            eval_run_result_id: "00000000-0000-4000-8000-000000000001",
            suite_name: "golden-nightly",
            model_version: "model-2026-04-29",
            prompt_version: "analyst/v1",
            created_at: new Date("2026-04-29T00:00:00.000Z"),
            result_json: runJson(),
          },
        ] as R[],
        command: "SELECT",
        rowCount: 2,
        oid: 0,
        fields: [],
      };
    },
  };

  const report = await readLatestGoldenEvalDriftReport(db, {
    suite_name: "golden-nightly",
  });

  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /from eval_run_results/i);
  assert.match(
    queries[0].text,
    /order by created_at desc,\s+eval_run_result_id desc/i,
  );
  assert.deepEqual(queries[0].values, ["golden-nightly"]);
  assert.equal(report?.current_run.eval_run_result_id, "00000000-0000-4000-8000-000000000002");
  assert.equal(report?.previous_run.eval_run_result_id, "00000000-0000-4000-8000-000000000001");
  assert.equal(report?.regressed_categories[0].category, "social_rumor_handling");
});

test("readLatestGoldenEvalDriftReport returns null until two runs exist", async () => {
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>() {
      return {
        rows: [] as R[],
        command: "SELECT",
        rowCount: 0,
        oid: 0,
        fields: [],
      };
    },
  };

  assert.equal(
    await readLatestGoldenEvalDriftReport(db, { suite_name: "golden-nightly" }),
    null,
  );
});
