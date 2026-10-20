import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import pg from "pg";

import { bootstrapDatabase, dockerAvailable, registerLifoCleanup } from "../../../db/test/docker-pg.ts";
import { createDevApiRuntimeFromEnv, recoveryParents } from "../src/runtime.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** A database the runtime can start on. The runtime keeps its pool private, so the pools it queries are ended before the container stops. */
async function runtimeDatabase(t: TestContext, prefix: string): Promise<string> {
  const { databaseUrl } = await bootstrapDatabase(t, prefix);
  const pools = new Set<pg.Pool>();
  const query = pg.Pool.prototype.query;
  t.mock.method(pg.Pool.prototype, "query", function (this: pg.Pool, ...args: unknown[]) {
    pools.add(this);
    return (query as (...values: unknown[]) => unknown).apply(this, args);
  } as never);
  registerLifoCleanup(t, async () => { await Promise.all([...pools].map((pool) => pool.end())); });
  return databaseUrl;
}

test("dev-api wires the in-repo durable adapter runtime when only DATABASE_URL is configured and the worker is off", { skip: !dockerAvailable(), timeout: 120_000 }, async (t) => {
  const { adapters, worker } = await createDevApiRuntimeFromEnv({ DATABASE_URL: await runtimeDatabase(t, "dev-api-runtime"), FINANCIAL_WORKER_ENABLED: "false" });
  assert.equal(worker, null);

  assert.equal(typeof adapters?.analyze.createRun, "function");
  assert.equal(typeof adapters?.agents.run, "function");
});

test("even with the worker off, startup checks financial readiness for thesis, so an unreachable database stops it", async () => {
  await assert.rejects(createDevApiRuntimeFromEnv({ DATABASE_URL: "postgres://postgres@127.0.0.1:1/market_agent", FINANCIAL_WORKER_ENABLED: "false" }), /ECONNREFUSED/u);
});

test("dev-api default runtime module resolves when loader cwd is the repo root", { skip: !dockerAvailable(), timeout: 120_000 }, async (t) => {
  const { adapters } = await createDevApiRuntimeFromEnv({ DATABASE_URL: await runtimeDatabase(t, "dev-api-runtime-root"), FINANCIAL_WORKER_ENABLED: "false" }, repoRoot);

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
