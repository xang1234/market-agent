import test from "node:test";
import assert from "node:assert/strict";

import {
  withTransaction,
} from "../src/transaction.ts";
import type { QueryExecutor } from "../src/types.ts";

function result<R extends Record<string, unknown>>(rows: R[] = []) {
  return { rows, command: "SELECT", rowCount: rows.length, oid: 0, fields: [] };
}

test("withTransaction runs on an already-pinned client and passes an explicit transaction context", async () => {
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
    assert.equal(tx.db, acquired);
    await tx.db.query("insert into things");
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

  await withTransaction(pool, async (txContext) => {
    assert.equal(txContext.db, tx);
    await txContext.db.query("insert into things");
  });

  assert.deepEqual(poolQueries, []);
  assert.deepEqual(txQueries, ["begin", "insert into things", "commit"]);
  assert.deepEqual(releases, [false]);
});

test("withTransaction runs registered rollback cleanups in reverse order", async () => {
  const queries: string[] = [];
  const cleanupCalls: string[] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string) {
      queries.push(text);
      return result<R>();
    },
  };

  await assert.rejects(
    withTransaction(db, async (tx) => {
      tx.onRollback(() => cleanupCalls.push("first"));
      const unregister = tx.onRollback(() => cleanupCalls.push("removed"));
      tx.onRollback(() => cleanupCalls.push("second"));
      unregister();
      await tx.db.query("insert into things");
      throw new Error("insert failed");
    }),
    /insert failed/,
  );

  assert.deepEqual(queries, ["begin", "insert into things", "rollback"]);
  assert.deepEqual(cleanupCalls, ["second", "first"]);
});

test("withTransaction does not run rollback cleanups after an uncertain commit", async () => {
  const queries: string[] = [];
  const cleanupCalls: string[] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string) {
      queries.push(text);
      if (/^commit$/i.test(text)) {
        throw new Error("commit connection lost");
      }
      return result<R>();
    },
  };

  await assert.rejects(
    withTransaction(db, async (tx) => {
      tx.onRollback(() => cleanupCalls.push("cleanup"));
      await tx.db.query("insert into things");
    }),
    /commit connection lost/,
  );

  assert.deepEqual(queries, ["begin", "insert into things", "commit"]);
  assert.deepEqual(cleanupCalls, []);
});
