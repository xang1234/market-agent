import assert from "node:assert/strict";
import test from "node:test";

import { createDevApiAdaptersFromEnv } from "../src/runtime.ts";

test("dev-api does not wire the durable Analyze adapter without a snapshot sealer module", async () => {
  const adapters = await createDevApiAdaptersFromEnv({
    DATABASE_URL: "postgres://example.invalid/market_agent",
  });

  assert.equal(adapters, undefined);
});
