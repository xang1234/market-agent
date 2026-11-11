// The live scope eval (#378) replayed with no model: each recorded reply
// resolves to the scope its question expects. `npm run scope:eval` asks the
// live model again after a prompt change (scripts/scope-eval.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CASES_FILE, caseFailures, measure, parseArgs, REPLIES_FILE, replyTo, selectCases, type ScopeEvalCase, type ScopeEvalReplies } from "../scripts/scope-eval.ts";
import { parseProposal } from "../src/scope-proposal.ts";

const cases = JSON.parse(readFileSync(CASES_FILE, "utf8")) as ScopeEvalCase[];
const replies = JSON.parse(readFileSync(REPLIES_FILE, "utf8")) as ScopeEvalReplies;

test("every recorded reply resolves to the scope its question expects", () => {
  assert.equal(cases.length, 136);
  assert.deepEqual(cases.flatMap((evalCase) => caseFailures(evalCase, replyTo(replies, evalCase.question))), []);
});

test("a reply that misreads its question fails its case, and one outside the vocabularies is rejected", () => {
  const segments = cases.find((evalCase) => evalCase.id === 15)!;
  const name = "#15 Break down NVDA's revenue by segment.";
  assert.deepEqual(caseFailures(segments, '{"metrics":[],"asks":[],"turns_off":{"facets":[],"metrics":[]},"income_items":[],"period":{"kind":"none"},"companies":{"kind":"as_named","names":[]}}'), [
    `${name}: route "latest_quarter", expected "segments"`,
    `${name}: reads "latest_quarter", expected "segments"`,
    `${name}: segments false, expected true`,
    `${name}: metrics [], expected ["income_statement"]`,
    `${name}: income_items [], expected ["revenue"]`,
  ]);
  assert.deepEqual(caseFailures(segments, '{"asks":["valuation"]}'), [`${name}: reply rejected: {"asks":["valuation"]}`]);
  assert.deepEqual(caseFailures(segments, undefined), [`${name}: no recorded reply`]);
});

test("scope:eval re-records only with no arguments, and measures only with well-formed --cases= and --runs=", () => {
  assert.deepEqual(parseArgs([]), { mode: "record" });
  assert.deepEqual(parseArgs(["--cases=31,57", "--runs=10"]), { mode: "measure", ids: [31, 57], runs: 10 });
  assert.deepEqual(parseArgs(["--runs=3"]), { mode: "measure", ids: null, runs: 3 });
  assert.deepEqual(parseArgs(["--cases=31"]), { mode: "measure", ids: [31], runs: 1 });
  for (const argv of [
    ["--runs", "10"], ["10"], ["--case=31"], ["--verbose"], ["--runs=1", "--runs=2"],
    ["--runs=0"], ["--runs=-1"], ["--runs=abc"], ["--runs=1.5"], ["--runs="],
    ["--cases="], ["--cases=#31"], ["--cases=31,"], ["--cases=57,57"],
  ]) assert.throws(() => parseArgs(argv), Error, argv.join(" "));
});

test("measuring a case id the eval does not have names it", () => {
  assert.deepEqual(selectCases(cases, null), cases);
  assert.deepEqual(selectCases(cases, [57, 31]).map((evalCase) => evalCase.id), [31, 57]);
  assert.throws(() => selectCases(cases, [31, 1000, 2000]), /no case 1000, 2000/);
});

test("a measured reply that fails, is cut off or is rejected is an error, not a miss, and any error exits nonzero", async (t) => {
  const segments = cases.find((evalCase) => evalCase.id === 15)!;
  const right = replyTo(replies, segments.question)!;
  const wrong = '{"metrics":[],"asks":[],"turns_off":{"facets":[],"metrics":[]},"income_items":[],"period":{"kind":"none"},"companies":{"kind":"as_named","names":[]}}';
  const lines: string[] = [];
  t.mock.method(console, "log", (line: string) => lines.push(line));
  const asked = (texts: Array<[string, boolean]>) => {
    let next = 0;
    return async (question: string) => {
      const [text, accepted] = texts[next++]!;
      return { text, proposal: accepted ? parseProposal(text, question) : null };
    };
  };
  assert.equal(await measure([segments], 2, asked([[right, true], [wrong, true]])), 0);
  assert.match(lines[0]!, /^#15\tmiss 1\/2\terrors 0\t/);
  lines.length = 0;
  assert.equal(await measure([segments], 3, asked([[right, true], [wrong, false], ["", false]])), 1);
  assert.match(lines[0]!, /^#15\tmiss 0\/1\terrors 2\t/);
  assert.match(lines.at(-1)!, /1 cases x 3 runs, asked concurrently/);
});
