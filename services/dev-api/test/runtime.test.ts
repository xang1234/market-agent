import assert from "node:assert/strict";
import test from "node:test";

import { createDevApiAdaptersFromEnv } from "../src/runtime.ts";

test("dev-api wires the in-repo durable adapter runtime when only DATABASE_URL is configured", async () => {
  const adapters = await createDevApiAdaptersFromEnv({
    DATABASE_URL: "postgres://example.invalid/market_agent",
  });

  assert.equal(typeof adapters?.analyze.createRun, "function");
  assert.equal(typeof adapters?.agents.run, "function");
});
