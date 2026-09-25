// The assistant message, snapshot, and certificate commit together or not at
// all, and a retry after any failure publishes exactly once.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Client } from "pg";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { requestCancellation } from "../../financial-engine/src/run-repo.ts";
import { IDS } from "../../financial-engine/test/db-fixtures.ts";
import { chatDatabase, chatHarness, completed, revenueModel } from "./financial-fixtures.ts";

async function published(db: Client, threadId: string) {
  const one = async (sql: string) => (await db.query(sql, [threadId])).rows[0].n as number;
  return {
    messages: await one(`select count(*)::int as n from chat_messages where thread_id = $1 and blocks @> '[{"kind":"financial_answer"}]'`),
    certificates: await one(`select count(*)::int as n from snapshot_financial_runs c join financial_runs r on r.run_id = c.run_id where r.parent_id = $1`),
  };
}

test("chat financial publication", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat financial publication coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-fin-publish");
  const ask = (turnId: string) => chatHarness(pool, { model: revenueModel(["AAA"]) }).run({ threadId, userId: IDS.owner, turnId, userIntent: "Revenue for AAA" });
  const failMessageInsert = async () => db.query(`
    create function fail_chat_message() returns trigger language plpgsql as $$ begin raise exception 'message store unavailable'; end $$;
    create trigger fail_chat_message before insert on chat_messages for each row execute function fail_chat_message();`);
  const restoreMessageInsert = async () => db.query(`drop trigger fail_chat_message on chat_messages; drop function fail_chat_message();`);

  await t.test("a failed message write leaves no snapshot, certificate, or message; the retry publishes once", async () => {
    const turnId = randomUUID();
    await failMessageInsert();
    try {
      const { events } = await ask(turnId);
      assert.deepEqual(events.map((event) => [event.type, event.error_code ?? null]), [["turn.started", null], ["turn.error", "financial_answer_failed"]]);
      assert.ok(!JSON.stringify(events).includes("message store unavailable"), "no internal error detail reaches the stream");
      assert.deepEqual(await published(db, threadId), { messages: 0, certificates: 0 });
    } finally {
      await restoreMessageInsert();
    }
    const retried = completed((await ask(turnId)).events);
    assert.ok(retried.message_id);
    assert.deepEqual(await published(db, threadId), { messages: 1, certificates: 1 });
  });

  await t.test("a thread that no longer belongs to the owner cannot receive the answer", async () => {
    await db.query(`update chat_threads set user_id = $2 where thread_id = $1`, [threadId, IDS.other]);
    try {
      const { events } = await ask(randomUUID());
      assert.equal(events.at(-1)!.type, "turn.error");
      assert.deepEqual(await published(db, threadId), { messages: 1, certificates: 1 }, "nothing new was committed");
    } finally {
      await db.query(`update chat_threads set user_id = $2 where thread_id = $1`, [threadId, IDS.owner]);
    }
  });

  await t.test("a calculation cancelled before publication yields a cancelled gap and no message", async () => {
    const turnId = randomUUID();
    await failMessageInsert();
    try {
      await ask(turnId);
    } finally {
      await restoreMessageInsert();
    }
    const run = (await db.query(`select run_id::text from financial_runs where parent_id = $1 and request_key = $2`, [threadId, turnId])).rows[0];
    await requestCancellation(db, IDS.owner, run.run_id);
    const retried = completed((await ask(turnId)).events);
    assert.deepEqual(retried.financial_gap, { reason_code: "run_cancelled" });
    assert.deepEqual(await published(db, threadId), { messages: 1, certificates: 1 }, "only the earlier answer exists");
  });
});
