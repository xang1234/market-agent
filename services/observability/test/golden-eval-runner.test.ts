import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  GOLDEN_EVAL_CATEGORIES,
  DEFAULT_GOLDEN_EVAL_CASES_DIR,
  assertGoldenEvalCategoryCoverage,
  loadGoldenEvalCases,
  runGoldenEvalSuite,
} from "../src/golden-eval-runner.ts";
import type { QueryExecutor } from "../src/types.ts";

test("default golden eval cases cover every required category", () => {
  const cases = loadGoldenEvalCases(DEFAULT_GOLDEN_EVAL_CASES_DIR);

  assert.equal(GOLDEN_EVAL_CATEGORIES.length, 14);
  assert.doesNotThrow(() => assertGoldenEvalCategoryCoverage(cases));
  assert.deepEqual(
    [...new Set(cases.map((testCase) => testCase.category))].sort(),
    [...GOLDEN_EVAL_CATEGORIES].sort(),
  );
});

test("loadGoldenEvalCases validates category membership", () => {
  const casesDir = mkdtempSync(join(tmpdir(), "golden-eval-cases-"));
  writeFileSync(
    join(casesDir, "bad.json"),
    JSON.stringify([
      {
        id: "bad-category",
        category: "not_a_category",
        prompt: "Should fail validation",
      },
    ]),
    "utf8",
  );

  assert.throws(
    () => loadGoldenEvalCases(casesDir),
    /category: must be one of/,
  );
});

test("runGoldenEvalSuite evaluates cases and persists summarized results", async () => {
  const inserted: unknown[][] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      assert.match(text, /insert into eval_run_results/);
      inserted.push(values ?? []);
      return {
        rows: [
          {
            eval_run_result_id: "00000000-0000-4000-8000-000000000001",
            created_at: new Date("2026-04-29T00:00:00.000Z"),
          },
        ] as R[],
        command: "INSERT",
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    },
  };
  const cases = GOLDEN_EVAL_CATEGORIES.map((category) =>
    Object.freeze({
      id: `${category}-case`,
      category,
      prompt: `Evaluate ${category}`,
      expected: { category },
    }),
  );

  const result = await runGoldenEvalSuite(db, {
    suite_name: "golden-smoke",
    model_version: "model-2026-04-29",
    prompt_version: "analyst/v1",
    cases,
    evaluate: async (testCase) => ({
      passed: testCase.category !== "social_rumor_handling",
      actual: { category: testCase.category },
    }),
  });

  assert.equal(inserted.length, 1);
  assert.equal(inserted[0][0], "golden-smoke");
  assert.equal(inserted[0][1], "model-2026-04-29");
  assert.equal(inserted[0][2], "analyst/v1");
  assert.equal(result.row.eval_run_result_id, "00000000-0000-4000-8000-000000000001");
  assert.deepEqual(result.result_json.summary, {
    case_count: 14,
    passed: 13,
    failed: 1,
  });
  assert.deepEqual(
    result.result_json.categories.find(
      (category) => category.category === "social_rumor_handling",
    ),
    {
      category: "social_rumor_handling",
      case_count: 1,
      passed: 0,
      failed: 1,
    },
  );
  assert.equal(JSON.parse(String(inserted[0][3])).summary.failed, 1);
});
