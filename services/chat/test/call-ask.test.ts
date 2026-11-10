// The Call ask (ADR 0005): a Call is made only when a message is one of a few
// fixed sentences naming one company. Every near miss asks for none.

import assert from "node:assert/strict";
import test from "node:test";
import { readCallAsk } from "../src/call.ts";

test("each fixed sentence asks a Call on the one company it names", () => {
  assert.deepEqual(
    ["Make a Call on AAPL", "make a call on aapl.", "What's your call on AAPL?", "What’s your call on NVDA?", "What is your call on BRK.B?", "Give me your opinion on AAPL", "  Give  me your opinion on COST!  "].map(readCallAsk),
    [{ subject: "AAPL" }, { subject: "aapl" }, { subject: "AAPL" }, { subject: "NVDA" }, { subject: "BRK.B" }, { subject: "AAPL" }, { subject: "COST" }],
  );
});

test("a near miss asks for no Call", () => {
  const nearMisses = [
    "What's AAPL's free cash flow?",
    "Make a Call on AAPL and MSFT",
    "What's your call on AAPL's margins?",
    "Make a call option on AAPL",
    "What's the call on AAPL?",
    "Give me your opinion on Apple's revenue",
    "Should I buy AAPL?",
    "AAPL call",
    "Make a Call on",
    "Please make a Call on AAPL",
    "Make a Call on AAPL as of 2026-11-06",
    "What's your call on AAPL vs MSFT?",
  ];
  assert.deepEqual(nearMisses.map(readCallAsk), nearMisses.map(() => null));
});
