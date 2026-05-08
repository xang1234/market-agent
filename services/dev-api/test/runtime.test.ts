import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createDevApiAdaptersFromEnv } from "../src/runtime.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test("dev-api wires the in-repo durable adapter runtime when only DATABASE_URL is configured", async () => {
  const adapters = await createDevApiAdaptersFromEnv({
    DATABASE_URL: "postgres://example.invalid/market_agent",
  });

  assert.equal(typeof adapters?.analyze.createRun, "function");
  assert.equal(typeof adapters?.agents.run, "function");
});

test("dev-api default runtime module resolves when loader cwd is the repo root", async () => {
  const adapters = await createDevApiAdaptersFromEnv({
    DATABASE_URL: "postgres://example.invalid/market_agent",
  }, repoRoot);

  assert.equal(typeof adapters?.analyze.createRun, "function");
  assert.equal(typeof adapters?.agents.run, "function");
});
