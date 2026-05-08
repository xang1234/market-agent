import assert from "node:assert/strict";
import test from "node:test";

import {
  GOLDEN_EVAL_CATEGORIES,
  runGoldenEvalDriftMonitor,
  type GoldenEvalCase,
} from "../src/index.ts";

test("runGoldenEvalDriftMonitor persists a run, computes drift, and flags policy failure by default", async () => {
  const db = fakeDb();
  const cases = GOLDEN_EVAL_CATEGORIES.map((category, index): GoldenEvalCase => ({
    id: `case-${index}`,
    category,
    prompt: `Prompt ${index}`,
  }));

  const result = await runGoldenEvalDriftMonitor(db, {
    suite_name: "golden-nightly",
    model_version: "model-v2",
    prompt_version: "prompt-v2",
    cases,
    evaluate: async (testCase) => ({
      passed: testCase.category !== "themes_macro_topics",
      actual: { checked: testCase.id },
    }),
  });

  assert.equal(result.run.row.eval_run_result_id, "00000000-0000-4000-8000-000000000002");
  assert.equal(result.drift_report?.alert, true);
  assert.equal(result.policy_status, "failed");
  assert.deepEqual(
    result.drift_report?.regressed_categories.map((category) => category.category),
    ["themes_macro_topics"],
  );
  assert.match(db.queries[0]?.text ?? "", /insert into eval_run_results/i);
  assert.match(db.queries[1]?.text ?? "", /from eval_run_results/i);
});

test("runGoldenEvalDriftMonitor can explicitly opt out of failing on alert", async () => {
  const db = fakeDb();
  const cases = GOLDEN_EVAL_CATEGORIES.map((category, index): GoldenEvalCase => ({
    id: `case-${index}`,
    category,
    prompt: `Prompt ${index}`,
  }));

  const result = await runGoldenEvalDriftMonitor(db, {
    suite_name: "golden-nightly",
    model_version: "model-v2",
    prompt_version: "prompt-v2",
    cases,
    evaluate: async (testCase) => ({
      passed: testCase.category !== "themes_macro_topics",
      actual: { checked: testCase.id },
    }),
    policy: { failOnAlert: false },
  });

  assert.equal(result.drift_report?.alert, true);
  assert.equal(result.policy_status, "passed");
});

test("runGoldenEvalDriftMonitor passes policy when there is no previous run yet", async () => {
  const db = fakeDb({ includePrevious: false });
  const cases = GOLDEN_EVAL_CATEGORIES.map((category, index): GoldenEvalCase => ({
    id: `case-${index}`,
    category,
    prompt: `Prompt ${index}`,
  }));

  const result = await runGoldenEvalDriftMonitor(db, {
    suite_name: "golden-nightly",
    model_version: "model-v1",
    prompt_version: "prompt-v1",
    cases,
    evaluate: () => ({ passed: true }),
    policy: { failOnAlert: true },
  });

  assert.equal(result.drift_report, null);
  assert.equal(result.policy_status, "passed");
});

function fakeDb(options: { includePrevious?: boolean } = {}) {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  let currentResult: unknown;
  const includePrevious = options.includePrevious ?? true;
  return {
    queries,
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values: values ?? [] });
      if (/insert into eval_run_results/i.test(text)) {
        currentResult = JSON.parse(String(values?.[3]));
        return {
          rows: [
            {
              eval_run_result_id: "00000000-0000-4000-8000-000000000002",
              created_at: new Date("2026-05-08T00:00:00.000Z"),
            },
          ],
        };
      }
      if (/from eval_run_results/i.test(text)) {
        return {
          rows: [
            {
              eval_run_result_id: "00000000-0000-4000-8000-000000000002",
              suite_name: "golden-nightly",
              model_version: "model-v2",
              prompt_version: "prompt-v2",
              created_at: new Date("2026-05-08T00:00:00.000Z"),
              result_json: currentResult,
            },
            ...(includePrevious
              ? [
                  {
                    eval_run_result_id: "00000000-0000-4000-8000-000000000001",
                    suite_name: "golden-nightly",
                    model_version: "model-v1",
                    prompt_version: "prompt-v1",
                    created_at: new Date("2026-05-07T00:00:00.000Z"),
                    result_json: previousPassingRun(),
                  },
                ]
              : []),
          ],
        };
      }
      return { rows: [] };
    },
  };
}

function previousPassingRun() {
  return {
    suite_name: "golden-nightly",
    model_version: "model-v1",
    prompt_version: "prompt-v1",
    summary: {
      case_count: GOLDEN_EVAL_CATEGORIES.length,
      passed: GOLDEN_EVAL_CATEGORIES.length,
      failed: 0,
    },
    categories: GOLDEN_EVAL_CATEGORIES.map((category) => ({
      category,
      case_count: 1,
      passed: 1,
      failed: 0,
    })),
    cases: GOLDEN_EVAL_CATEGORIES.map((category, index) => ({
      id: `case-${index}`,
      category,
      passed: true,
    })),
  };
}
