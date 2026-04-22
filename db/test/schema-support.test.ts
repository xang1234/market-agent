import test from "node:test";
import assert from "node:assert/strict";
import { applySqlText, withAdvisoryLock } from "../scripts/schema-support.ts";

test("applySqlText executes a dollar-quoted function body as one query", async () => {
  const calls: string[] = [];
  const client = {
    async query(sql: string) {
      calls.push(sql);
      return {};
    },
  };

  const sql = `create function demo() returns void language plpgsql as $$
begin
  perform 1;
  perform 2;
end;
$$;`;

  await applySqlText(client as never, sql, "demo function");

  assert.deepEqual(calls, ["begin", sql, "commit"]);
});

test("withAdvisoryLock acquires and releases the lock around the action", async () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      return {};
    },
  };

  await withAdvisoryLock(client as never, "migration_lock", async () => {
    calls.push({ sql: "action" });
  });

  assert.deepEqual(calls, [
    {
      sql: "select pg_advisory_lock(hashtext($1))",
      params: ["migration_lock"],
    },
    {
      sql: "action",
    },
    {
      sql: "select pg_advisory_unlock(hashtext($1))",
      params: ["migration_lock"],
    },
  ]);
});
