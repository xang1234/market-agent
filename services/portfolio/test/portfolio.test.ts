import test from "node:test";
import assert from "node:assert/strict";
import {
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
