import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";

import { load } from "../web/node_modules/js-yaml/dist/js-yaml.mjs";
import { missingExpectations, READER_CORPUS } from "./reader-corpus-check.ts";

const REPO_ROOT = dirname(dirname(new URL(import.meta.url).pathname));
const RELEASE_FIGURES = "services/evidence/src/release-figures.ts";
const NON_GAAP = "services/evidence/src/reader/non-gaap-reconciliation-extractor.ts";

test("a reader changed without its expected file fails, naming the rule", () => {
  const [problem, ...rest] = missingExpectations([RELEASE_FIGURES, "services/evidence/test/release-figures.test.ts"]);
  assert.equal(rest.length, 0);
  assert.match(problem!, /release-figures\.ts changed but its corpus did not\..*release-figure-readings\.txt.*If no reading moved, add corpus inputs/u);
  assert.match(problem!, /Known bug classes here/u);
  assert.equal(missingExpectations([NON_GAAP, READER_CORPUS[RELEASE_FIGURES]![0]!]).length, 1, "the other reader's file does not count");
});

test("a reader changed with its expected file, or no reader changed, passes", () => {
  assert.deepEqual(missingExpectations([RELEASE_FIGURES, READER_CORPUS[RELEASE_FIGURES]![0]!, NON_GAAP, READER_CORPUS[NON_GAAP]![0]!]), []);
  assert.deepEqual(missingExpectations(["services/evidence/src/canonical-text.ts", "README.md"]), []);
});

test("a reader changed with only new corpus inputs passes", () => {
  assert.deepEqual(missingExpectations([RELEASE_FIGURES, "services/evidence/test/reader-corpus/release-figure-sentences.tsv"]), []);
  assert.deepEqual(missingExpectations([NON_GAAP, "services/evidence/test/reader-corpus/releases/0000000000-26-000001.htm"]), []);
  assert.equal(missingExpectations([NON_GAAP, "services/evidence/test/reader-corpus/releases-old/x.htm"]).length, 1, "a sibling folder is not the corpus");
});

test("every reader and expected file the check names exists", () => {
  for (const [reader, corpus] of Object.entries(READER_CORPUS)) {
    assert.ok(existsSync(join(REPO_ROOT, reader)), reader);
    for (const path of corpus) assert.ok(existsSync(join(REPO_ROOT, path)), path);
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
