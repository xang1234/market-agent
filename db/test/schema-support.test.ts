import test from "node:test";
import assert from "node:assert/strict";
import { applySqlText } from "../scripts/schema-support.ts";

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
