import test from "node:test";
import assert from "node:assert/strict";

import { classifyMentionProminence } from "../src/reader/mention-prominence.ts";

test("classifyMentionProminence ranks headline matches above body matches", () => {
  assert.equal(
    classifyMentionProminence("Apple", {
      headline: "Apple beats Q1 estimates",
      body: "Analysts also mentioned Apple suppliers in the footnote.",
    }),
    "headline",
  );
});

test("classifyMentionProminence distinguishes lead, body, and incidental matches", () => {
  assert.equal(
    classifyMentionProminence("AAPL", {
      lead: "AAPL rose after the release.",
      body: "The filing includes supplier details.",
    }),
    "lead",
  );
  assert.equal(
    classifyMentionProminence("AAPL", {
      body: "The article references AAPL once in the middle paragraphs.",
      incidental: "AAPL appears in a related-links widget.",
    }),
    "body",
  );
  assert.equal(
    classifyMentionProminence("AAPL", {
      incidental: "Related tickers: AAPL, MSFT",
    }),
    "incidental",
  );
});

test("classifyMentionProminence defaults to incidental when no section contains the mention", () => {
  assert.equal(
    classifyMentionProminence("Nvidia", {
      headline: "Apple beats Q1 estimates",
      lead: "AAPL rose after the release.",
      body: "The filing includes supplier details.",
    }),
    "incidental",
  );
});

test("classifyMentionProminence does not match short tickers inside unrelated words", () => {
  assert.equal(
    classifyMentionProminence("A", {
      headline: "Analysts raise estimates after earnings",
      body: "Ticker A is only listed in the body table.",
    }),
    "body",
  );
});
