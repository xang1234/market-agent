import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPromptCachePrefix,
  maybeRegenerateThreadSummary,
  type ThreadTurn,
} from "../src/thread-summary.ts";

function turns(count: number): ThreadTurn[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    text: `turn ${index + 1}`,
  }));
}

test("maybeRegenerateThreadSummary skips non-boundary turns to keep prompt cache prefix stable", async () => {
  let calls = 0;
  const result = await maybeRegenerateThreadSummary({
    turns: turns(19),
    previousSummary: "stable summary",
    previousSummarizedThroughTurn: 10,
    summarizeEveryTurns: 10,
    keepRecentTurns: 4,
    model: async () => {
      calls++;
      return "new summary";
    },
  });

  assert.equal(calls, 0);
  assert.deepEqual(result, {
    regenerated: false,
    summary: "stable summary",
    summarizedThroughTurn: 10,
  });
});

test("maybeRegenerateThreadSummary summarizes older turns at fixed boundaries", async () => {
  const result = await maybeRegenerateThreadSummary({
    turns: turns(20),
    previousSummary: "old summary",
    summarizeEveryTurns: 10,
    keepRecentTurns: 4,
    model: async (input) => {
      assert.equal(input.turns.length, 16);
      return "turns 1 through 16 summary";
    },
  });

  assert.deepEqual(result, {
    regenerated: true,
    summary: "turns 1 through 16 summary",
    summarizedThroughTurn: 16,
  });
});

test("maybeRegenerateThreadSummary does not overstate summary coverage without prior metadata", async () => {
  const result = await maybeRegenerateThreadSummary({
    turns: turns(19),
    previousSummary: "stable summary",
    summarizeEveryTurns: 10,
    keepRecentTurns: 4,
    model: async () => "new summary",
  });

  assert.equal(result.regenerated, false);
  assert.equal(result.summarizedThroughTurn, 0);
});

test("buildPromptCachePrefix places rolling summary in the stable prefix", () => {
  assert.equal(
    buildPromptCachePrefix({
      summary: "turns 1 through 16 summary",
      systemPrompt: "You are a market analyst.",
    }),
    "You are a market analyst.\n\nThread summary:\nturns 1 through 16 summary",
  );
});
