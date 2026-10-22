// The live scope eval (#378) replayed with no model: each recorded reply
// resolves to the scope its question expects. `npm run scope:eval` asks the
// live model again after a prompt change (scripts/scope-eval.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CASES_FILE, caseFailures, REPLIES_FILE, replyTo, type ScopeEvalCase, type ScopeEvalReplies } from "../scripts/scope-eval.ts";

const cases = JSON.parse(readFileSync(CASES_FILE, "utf8")) as ScopeEvalCase[];
const replies = JSON.parse(readFileSync(REPLIES_FILE, "utf8")) as ScopeEvalReplies;

test("every recorded reply resolves to the scope its question expects", () => {
  assert.equal(cases.length, 122);
  assert.deepEqual(cases.flatMap((evalCase) => caseFailures(evalCase, replyTo(replies, evalCase.question))), []);
});

test("a reply that misreads its question fails its case, and one outside the vocabularies is rejected", () => {
  const segments = cases.find((evalCase) => evalCase.id === 15)!;
  const name = "#15 Break down NVDA's revenue by segment.";
  assert.deepEqual(caseFailures(segments, '{"metrics":[],"asks":[],"turns_off":{"facets":[],"metrics":[]},"income_items":[],"period":{"kind":"latest"}}'), [
    `${name}: route "latest_quarter", expected "segments"`,
    `${name}: reads "latest_quarter", expected "segments"`,
    `${name}: segments false, expected true`,
    `${name}: metrics [], expected ["income_statement"]`,
    `${name}: income_items [], expected ["revenue"]`,
  ]);
  assert.deepEqual(caseFailures(segments, '{"asks":["valuation"]}'), [`${name}: reply rejected: {"asks":["valuation"]}`]);
  assert.deepEqual(caseFailures(segments, undefined), [`${name}: no recorded reply`]);
});
