import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPortfolio,
  assertPortfolioCreateInput,
  PORTFOLIO_NAME_MAX_LENGTH,
} from "../src/portfolio.ts";

test("assertPortfolioCreateInput: accepts a well-formed payload", () => {
  assert.doesNotThrow(() =>
    assertPortfolioCreateInput({ name: "Core US Equities", base_currency: "USD" }),
  );
});

test("assertPortfolioCreateInput: rejects missing base_currency", () => {
  assert.throws(
    () => assertPortfolioCreateInput({ name: "Core" }),
    /portfolio.base_currency/,
  );
});

test("assertPortfolioCreateInput: rejects null base_currency", () => {
  assert.throws(
    () => assertPortfolioCreateInput({ name: "Core", base_currency: null }),
    /portfolio.base_currency/,
  );
});

test("assertPortfolioCreateInput: rejects non-ISO 4217 base_currency", () => {
  assert.throws(
    () => assertPortfolioCreateInput({ name: "Core", base_currency: "usd" }),
    /portfolio.base_currency/,
  );
  assert.throws(
    () => assertPortfolioCreateInput({ name: "Core", base_currency: "Dollars" }),
    /portfolio.base_currency/,
  );
  assert.throws(
    () => assertPortfolioCreateInput({ name: "Core", base_currency: "US" }),
    /portfolio.base_currency/,
  );
});

test("assertPortfolioCreateInput: rejects missing name", () => {
  assert.throws(
    () => assertPortfolioCreateInput({ base_currency: "USD" }),
    /portfolio.name/,
  );
});

test("assertPortfolioCreateInput: rejects empty name", () => {
  assert.throws(
    () => assertPortfolioCreateInput({ name: "", base_currency: "USD" }),
    /portfolio.name/,
  );
});

test("assertPortfolioCreateInput: rejects name above max length", () => {
  const tooLong = "x".repeat(PORTFOLIO_NAME_MAX_LENGTH + 1);
  assert.throws(
    () => assertPortfolioCreateInput({ name: tooLong, base_currency: "USD" }),
    /portfolio.name/,
  );
});

test("assertPortfolioCreateInput: rejects non-object body", () => {
  assert.throws(() => assertPortfolioCreateInput(null), /must be an object/);
  assert.throws(() => assertPortfolioCreateInput("string"), /must be an object/);
  assert.throws(() => assertPortfolioCreateInput(42), /must be an object/);
});

test("assertPortfolio: accepts a fully populated row", () => {
  assert.doesNotThrow(() =>
    assertPortfolio({
      portfolio_id: "11111111-1111-4111-a111-111111111111",
      user_id: "22222222-2222-4222-a222-222222222222",
      name: "Core",
      base_currency: "USD",
      created_at: "2026-04-27T00:00:00.000Z",
      updated_at: "2026-04-27T00:00:00.000Z",
    }),
  );
});

test("assertPortfolio: rejects rows missing base_currency", () => {
  assert.throws(
    () =>
      assertPortfolio({
        portfolio_id: "11111111-1111-4111-a111-111111111111",
        user_id: "22222222-2222-4222-a222-222222222222",
        name: "Core",
        created_at: "2026-04-27T00:00:00.000Z",
        updated_at: "2026-04-27T00:00:00.000Z",
      }),
    /portfolio.base_currency/,
  );
});
