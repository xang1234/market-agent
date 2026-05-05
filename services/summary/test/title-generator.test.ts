import test from "node:test";
import assert from "node:assert/strict";
import {
  generateThreadTitle,
  fallbackThreadTitle,
} from "../src/title-generator.ts";

test("generateThreadTitle returns trimmed single-line model output capped at 60 chars", async () => {
  const title = await generateThreadTitle({
    userIntent: "what happened to Apple after earnings?",
    assistantText: "Apple shares rallied after earnings beat expectations.",
    model: async () => "  Apple Earnings Rally\nextra detail that should not leak  ",
  });

  assert.equal(title, "Apple Earnings Rally");
  assert.equal(title.length <= 60, true);
});

test("generateThreadTitle falls back to user intent when the model fails", async () => {
  const title = await generateThreadTitle({
    userIntent: "why did Taiwan Semiconductor sell off after guidance?",
    assistantText: "The selloff followed weaker capex commentary.",
    model: async () => {
      throw new Error("model unavailable");
    },
  });

  assert.equal(title, "Why Did Taiwan Semiconductor Sell Off After Guidance?");
  assert.equal(title.length <= 60, true);
});

test("fallbackThreadTitle uses assistant text when user intent is empty", () => {
  assert.equal(
    fallbackThreadTitle({
      userIntent: " ",
      assistantText: "Iran-US trade tensions lifted oil prices sharply today.",
    }),
    "Iran-US Trade Tensions Lifted Oil Prices Sharply Today",
  );
});
