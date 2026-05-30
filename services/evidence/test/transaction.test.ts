import test from "node:test";
import assert from "node:assert/strict";

import {
  withPinnedClient,
  withTransaction,
} from "../src/transaction.ts";
import type { QueryExecutor } from "../src/types.ts";

function result<R extends Record<string, unknown>>(rows: R[] = []) {
  return { rows, command: "SELECT", rowCount: rows.length, oid: 0, fields: [] };
}

test("withPinnedClient reuses an acquired PoolClient shape instead of reconnecting it", async () => {
  const queries: string[] = [];
  const acquired = {
    async query<R extends Record<string, unknown>>(text: string) {
      queries.push(text);
      return result<R>();
    },
    async connect() {
      throw new Error("must not reconnect an acquired client");
    },
    release() {
      throw new Error("must not release a client it did not acquire");
    },
  };

  const used = await withPinnedClient(acquired, async (db) => {
    await db.query("select 1");
    return db;
  });

  assert.equal(used, acquired);
  assert.deepEqual(queries, ["select 1"]);
});

test("withPinnedClient treats standalone pg.Client-like executors as already pinned", async () => {
  const queries: string[] = [];
  const clientLike = {
    connectionParameters: {},
    async query<R extends Record<string, unknown>>(text: string) {
      queries.push(text);
      return result<R>();
    },
    async connect() {
      throw new Error("standalone clients are already pinned for query affinity");
    },
  };

  const used = await withPinnedClient(clientLike, async (db) => {
    await db.query("select 1");
    return db;
  });

  assert.equal(used, clientLike);
  assert.deepEqual(queries, ["select 1"]);
});

test("withTransaction reuses acquired PoolClient shape and runs transaction on it", async () => {
  const queries: string[] = [];
  const acquired = {
    async query<R extends Record<string, unknown>>(text: string) {
      queries.push(text);
      return result<R>();
    },
    async connect() {
      throw new Error("must not reconnect an acquired client");
    },
    release() {
      throw new Error("must not release a client it did not acquire");
    },
  };

  await withTransaction(acquired, async (tx) => {
    assert.equal(tx, acquired);
    await tx.query("insert into things");
  });

  assert.deepEqual(queries, ["begin", "insert into things", "commit"]);
});

test("withTransaction acquires and releases pool-like executors", async () => {
  const poolQueries: string[] = [];
  const txQueries: string[] = [];
  const releases: unknown[] = [];
  const tx: QueryExecutor & { release(destroy?: boolean): void } = {
    async query<R extends Record<string, unknown>>(text: string) {
      txQueries.push(text);
      return result<R>();
    },
    release(destroy?: boolean) {
      releases.push(destroy);
    },
  };
  const pool: QueryExecutor & { connect(): Promise<typeof tx> } = {
    async query<R extends Record<string, unknown>>(text: string) {
      poolQueries.push(text);
      return result<R>();
    },
    async connect() {
      return tx;
    },
  };

  await withTransaction(pool, async (db) => {
    assert.equal(db, tx);
    await db.query("insert into things");
  });

  assert.deepEqual(poolQueries, []);
  assert.deepEqual(txQueries, ["begin", "insert into things", "commit"]);
  assert.deepEqual(releases, [false]);
});
