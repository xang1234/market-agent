import test from "node:test";
import assert from "node:assert/strict";

import { createMarketStackFromEnv } from "../src/stack.ts";

test("createMarketStackFromEnv throws without DATABASE_URL", () => {
  assert.throws(() => createMarketStackFromEnv({}), /DATABASE_URL/);
});

test("createMarketStackFromEnv builds a cached adapter stack", async () => {
  const stack = createMarketStackFromEnv({
    DATABASE_URL: "postgres://localhost:5432/market_agent_unused",
  });
  assert.equal(typeof stack.adapter.getQuote, "function");
  assert.equal(typeof stack.cache.listStaleActiveListings, "function");
  assert.ok(stack.pool);
  // The pool is lazy; ending an unused pool resolves cleanly.
  await stack.pool.end();
});
