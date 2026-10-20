import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createDevApiRuntimeFromEnv, recoveryParents } from "../src/runtime.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test("dev-api wires the in-repo durable adapter runtime when only DATABASE_URL is configured and the worker is off", async () => {
  const { adapters, worker } = await createDevApiRuntimeFromEnv({
    DATABASE_URL: "postgres://example.invalid/market_agent",
    FINANCIAL_WORKER_ENABLED: "false",
  });
  assert.equal(worker, null);

  assert.equal(typeof adapters?.analyze.createRun, "function");
  assert.equal(typeof adapters?.agents.run, "function");
});

test("with the worker flag unset, startup checks financial readiness, so an unreachable database stops it", async () => {
  await assert.rejects(createDevApiRuntimeFromEnv({ DATABASE_URL: "postgres://postgres@127.0.0.1:1/market_agent" }), /ECONNREFUSED/u);
});

test("dev-api default runtime module resolves when loader cwd is the repo root", async () => {
  const { adapters } = await createDevApiRuntimeFromEnv({
    DATABASE_URL: "postgres://example.invalid/market_agent",
    FINANCIAL_WORKER_ENABLED: "false",
  }, repoRoot);

  assert.equal(typeof adapters?.analyze.createRun, "function");
  assert.equal(typeof adapters?.agents.run, "function");
});

test("the worker always recovers grid runs, and analyze runs only when the analyze lane is on", () => {
  const db = { query: async () => assert.fail("building the parents runs no query") };
  assert.deepEqual(Object.keys(recoveryParents(db, undefined)), ["analyst_grid_run"]);
  assert.deepEqual(Object.keys(recoveryParents(db, { publish: () => undefined })), ["analyze_memo_run", "analyst_grid_run"]);
});

test("dev-api imports evidence inspector without evaluating evidence's optional object-store deps", () => {
  const source = readFileSync(resolve(repoRoot, "services/dev-api/src/http.ts"), "utf8");

  assert.doesNotMatch(source, /\.\.\/\.\.\/evidence\/src\/index\.ts/);
  assert.match(source, /\.\.\/\.\.\/evidence\/src\/inspector\.ts/);
});
