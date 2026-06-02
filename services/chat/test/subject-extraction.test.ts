import assert from "node:assert/strict";
import test from "node:test";

import { extractSubjectCandidates } from "../src/subject-extraction.ts";

test("a bare ticker yields a single candidate", () => {
  assert.deepEqual(extractSubjectCandidates("MU"), ["MU"]);
  assert.deepEqual(extractSubjectCandidates("  AAPL "), ["AAPL"]);
});

test("a conversational message yields the whole text then the embedded ticker", () => {
  assert.deepEqual(extractSubjectCandidates("tell me about MU"), ["tell me about MU", "MU"]);
  assert.deepEqual(extractSubjectCandidates("describe MU"), ["describe MU", "MU"]);
});

test("multiple uppercase tokens are tried longest-first, in appearance order on ties", () => {
  assert.deepEqual(extractSubjectCandidates("what is SNDK PE ?"), ["what is SNDK PE ?", "SNDK", "PE"]);
  assert.deepEqual(
    extractSubjectCandidates("compare SNDK and AXTI"),
    ["compare SNDK and AXTI", "SNDK", "AXTI"],
  );
});

test("lowercase words are not treated as tickers (only the whole text is tried)", () => {
  // Tickers are written in caps; matching 'is'/'a' against single-letter tickers
  // would mis-ground the turn, so lowercase tokens are ignored.
  assert.deepEqual(extractSubjectCandidates("what is a good stock?"), ["what is a good stock?"]);
  assert.deepEqual(extractSubjectCandidates("tell me about mu"), ["tell me about mu"]);
});

test("empty or whitespace input yields no candidates", () => {
  assert.deepEqual(extractSubjectCandidates(""), []);
  assert.deepEqual(extractSubjectCandidates("   "), []);
  assert.deepEqual(extractSubjectCandidates(null), []);
  assert.deepEqual(extractSubjectCandidates(undefined), []);
});

test("the embedded ticker is not duplicated when it equals the whole message", () => {
  assert.deepEqual(extractSubjectCandidates("AXTI"), ["AXTI"]);
});
