import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { bootstrapDatabase, connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { listChatMessagesForThread, saveChatMessageWorkSummary } from "../src/messages.ts";

test("a saved work summary is read back with its answer exactly as written; a message without one has none", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for work summary coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "chat-work-summary");
  const pool = await connectedPool(t, databaseUrl);

  const [userId, threadId, snapshotId, answerId, questionId] = Array.from({ length: 5 }, () => randomUUID());
  await pool.query(`insert into users (user_id, email) values ($1,$2)`, [userId, `${userId}@t.dev`]);
  await pool.query(`insert into chat_threads (thread_id, user_id) values ($1,$2)`, [threadId, userId]);
  await pool.query(
    `insert into snapshots (snapshot_id, subject_refs, source_ids, as_of, basis, normalization, allowed_transforms)
     values ($1, '[]'::jsonb, '[]'::jsonb, now(), 'unadjusted', 'none', '{}'::jsonb)`,
    [snapshotId],
  );
  await pool.query(
    `insert into chat_messages (message_id, thread_id, role, snapshot_id, blocks, content_hash, created_at)
     values ($1::uuid, $3::uuid, 'user', $4::uuid, '[]'::jsonb, 'q', now()), ($2::uuid, $3::uuid, 'assistant', $4::uuid, '[]'::jsonb, 'a', now() + interval '1 second')`,
    [questionId, answerId, threadId, snapshotId],
  );
  const work_summary = { elapsed_ms: 34_000, events: [{ type: "turn.started", at_ms: 0, bundle_id: "single_subject_analysis" }] };

  await saveChatMessageWorkSummary(pool, { thread_id: threadId, message_id: questionId, work_summary });
  await saveChatMessageWorkSummary(pool, { thread_id: threadId, message_id: answerId, work_summary });

  const read = await listChatMessagesForThread(pool, { thread_id: threadId, user_id: userId });
  // As text: a reload must return the summary exactly as the completion carried it, key order included.
  assert.deepEqual(read?.messages.map((message) => [message.role, JSON.stringify(message.work_summary)]), [
    ["user", undefined],
    ["assistant", JSON.stringify(work_summary)],
  ]);
});
