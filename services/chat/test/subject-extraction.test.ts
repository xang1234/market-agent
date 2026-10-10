import assert from "node:assert/strict";
import test from "node:test";

import { extractSubjectMentions } from "../src/subject-extraction.ts";

test("a bare ticker is one mention", () => {
  assert.deepEqual(extractSubjectMentions("MU"), ["MU"]);
  assert.deepEqual(extractSubjectMentions("  AAPL "), ["AAPL"]);
});

test("a conversational message yields the embedded ticker", () => {
  assert.deepEqual(extractSubjectMentions("tell me about MU"), ["MU"]);
});

test("every ticker is returned once, in the order written", () => {
  assert.deepEqual(extractSubjectMentions("compare SNDK and AXTI"), ["SNDK", "AXTI"]);
  assert.deepEqual(extractSubjectMentions("NVDA vs AMD vs NVDA"), ["NVDA", "AMD"]);
});

test("lowercase words and finance acronyms are not treated as tickers", () => {
  // Tickers are written in caps; matching 'is'/'a' against single-letter tickers
  // would mis-ground the turn, and EPS/FY never name a company.
  assert.deepEqual(extractSubjectMentions("what is a good stock?"), []);
  assert.deepEqual(extractSubjectMentions("tell me about mu"), []);
  assert.deepEqual(extractSubjectMentions("EPS for AAPL in FY2023"), ["AAPL"]);
});

test("empty or whitespace input yields no mentions", () => {
  assert.deepEqual(extractSubjectMentions(""), []);
  assert.deepEqual(extractSubjectMentions("   "), []);
  assert.deepEqual(extractSubjectMentions(null), []);
  assert.deepEqual(extractSubjectMentions(undefined), []);
});

test("a benchmark index is not a company mention (#206)", () => {
  assert.deepEqual(extractSubjectMentions("Compare NVDA and AMD YTD against the S&P 500"), ["NVDA", "AMD"]);
  assert.deepEqual(extractSubjectMentions("How did AAPL do vs the s&p?"), ["AAPL"]);
});
