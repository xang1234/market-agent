// The price comparison ask (#224) is one closed sentence; a message that
// starts as it does and leaves it is invalid, and the rest of chat, other
// questions comparing prices included, is untouched.

import assert from "node:assert/strict";
import test from "node:test";
import { ADVICE_WORDS, COMPARISON_DECLINES, readPriceComparisonAsk } from "../src/scenario-price-comparison.ts";

test("the closed sentence asks for the latest close, a date, or an instant with its offset", () => {
  const asks: Array<[string, unknown]> = [
    ["compare with the price", { kind: "latest" }],
    ["Compare it to the share price.", { kind: "latest" }],
    ["compare them against the closing price", { kind: "latest" }],
    ["compare  the scenarios with   stock price?", { kind: "latest" }],
    ["compare these to price", { kind: "latest" }],
    ["compare with the price as of 2026-10-30", { kind: "session_date", date: "2026-10-30" }],
    ["compare with the price as of 2026-10-30T16:00:00-04:00", { kind: "instant", at: "2026-10-30T20:00:00.000Z" }],
    ["compare with the price as of 2026-10-30T20:00Z", { kind: "instant", at: "2026-10-30T20:00:00.000Z" }],
    ["compare with the price as of 2026-10-30T20:00:00.123Z", { kind: "instant", at: "2026-10-30T20:00:00.123Z" }],
  ];
  for (const [text, requested] of asks) assert.deepEqual(readPriceComparisonAsk(text), { invalid: false, requested }, text);
});

test("the sentence's own head with an extra word, number, multiple, currency, advice word, or time with no offset makes the ask invalid, for its reason", () => {
  for (const [text, reason] of [
    ["compare with the price target", "advice"],
    ["compare with the price as of 2026-10-30T16:00:00", "form"],
    ["compare with the price as of 2026-10-30T20:00:00.1234Z", "form"],
    ["compare with the price as of 30/10/2026", "form"],
    ["compare with the price as of 2026-02-30", "form"],
    ["compare with the price as of 2026-10-30T25:00Z", "form"],
    ["compare with the price as of yesterday", "form"],
    ["compare with the price in EUR", "currency"],
    ["compare with the price in euros", "currency"],
    ["compare with the price at 25x", "form"],
    ["compare with the price, is it undervalued?", "advice"],
    ["compare them to the current price", "form"],
    ["Compare the scenarios against today's share price", "form"],
    ["compare with the price and buy", "advice"],
    ["compare with the price, is it cheap?", "advice"],
    ["compare with the price, is it expensive", "advice"],
    ["compare with the price potential", "advice"],
    ["compare with the price forecast", "advice"],
    ["compare with the price and recommend", "advice"],
    ["compare with the price as of 2026-10-30, is it cheap?", "advice"],
    ["compare with the price as of the last sell-off", "form"],
    ["compare with the price on returns day", "form"],
  ] as const) {
    assert.deepEqual(readPriceComparisonAsk(text), { invalid: true, reason }, text);
  }
});

test("each decline names its reason and the ask that works, with no advice wording", () => {
  assert.deepEqual(Object.keys(COMPARISON_DECLINES).sort(), ["advice", "currency", "form", "no_scenario"]);
  for (const text of Object.values(COMPARISON_DECLINES)) {
    assert.doesNotMatch(text, ADVICE_WORDS, text);
    assert.match(text, /“compare with the price” or “compare with the price as of 2026-10-30”/u, text);
  }
  assert.equal(new Set(Object.values(COMPARISON_DECLINES)).size, 4, "no two reasons say the same");
});

test("a message that does not start as the sentence does is no comparison ask, however it compares prices", () => {
  for (const text of [
    "compare revenue with AMD", "what is the price?", "SCEN bear 20x, base 25x, bull 30x", "make bull 35", "price history of NVDA",
    "How did NVDA's price compare with AMD's this year?", "compare NVDA vs AMD price performance", "AAPL vs MSFT price since January",
    "how do the scenarios compare to the current price", "bull vs price", "compare the upside with the price",
  ]) {
    assert.equal(readPriceComparisonAsk(text), null, text);
  }
});
