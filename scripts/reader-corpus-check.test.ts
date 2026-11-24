import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";

import { load } from "../web/node_modules/js-yaml/dist/js-yaml.mjs";
import { missingExpectations, READER_EXPECTATIONS } from "./reader-corpus-check.ts";

const REPO_ROOT = dirname(dirname(new URL(import.meta.url).pathname));
const RELEASE_FIGURES = "services/evidence/src/release-figures.ts";
const NON_GAAP = "services/evidence/src/reader/non-gaap-reconciliation-extractor.ts";

test("a reader changed without its expected file fails, naming the rule", () => {
  const [problem, ...rest] = missingExpectations([RELEASE_FIGURES, "services/evidence/test/release-figures.test.ts"]);
  assert.equal(rest.length, 0);
  assert.match(problem!, /release-figures\.ts changed but .*release-figure-readings\.txt did not/u);
  assert.match(problem!, /Known bug classes here/u);
  assert.equal(missingExpectations([NON_GAAP, READER_EXPECTATIONS[RELEASE_FIGURES]!]).length, 1, "the other reader's file does not count");
});

test("a reader changed with its expected file, or no reader changed, passes", () => {
  assert.deepEqual(missingExpectations([RELEASE_FIGURES, READER_EXPECTATIONS[RELEASE_FIGURES]!, NON_GAAP, READER_EXPECTATIONS[NON_GAAP]!]), []);
  assert.deepEqual(missingExpectations(["services/evidence/src/canonical-text.ts", "README.md"]), []);
});

test("every reader and expected file the check names exists", () => {
  for (const [reader, expected] of Object.entries(READER_EXPECTATIONS)) {
    assert.ok(existsSync(join(REPO_ROOT, reader)), reader);
    assert.ok(existsSync(join(REPO_ROOT, expected)), expected);
  }
});

test("CI runs the check against the merge's base commit", () => {
  type Step = { uses?: string; run?: string; with?: Record<string, unknown> };
  const workflow = load(readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8")) as { jobs: Record<string, { steps: Step[] }> };
  const steps = workflow.jobs.scripts!.steps;
  const checkout = steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.ok(Number(checkout?.with?.["fetch-depth"]) >= 2, "the checkout holds the merge's first parent");
  assert.ok(steps.some((step) => step.run === "node --experimental-strip-types scripts/reader-corpus-check.ts HEAD^1"));
});
