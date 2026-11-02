import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { bootstrapDatabase, connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { loadEvidenceInspection, type EvidenceInspectionRef } from "../../evidence/src/inspector.ts";
import { answerMessageId, stableUuid } from "../src/chat-ids.ts";
import { createChatCoordinator } from "../src/coordinator.ts";
import { createChatMessagePersistence } from "../src/messages.ts";
import { startChatTestServer } from "./sse-helpers.ts";

test("a user message is saved under a snapshot the server made, whatever snapshot_id it carries; a message_id in use changes nothing", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for user message snapshot coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "chat-user-message-snapshot");
  const pool = await connectedPool(t, databaseUrl);

  const [ownerId, strangerId, sourceId, answerSnapshotId, ownerThreadId, strangerThreadId] =
    Array.from({ length: 6 }, () => randomUUID());
  await pool.query(`insert into users (user_id, email) values ($1,$2),($3,$4)`, [
    ownerId, `${ownerId}@t.dev`, strangerId, `${strangerId}@t.dev`,
  ]);
  await pool.query(
    `insert into sources (source_id, provider, kind, canonical_url, trust_tier, license_class, retrieved_at)
     values ($1,'polygon','market_data','https://polygon.io/','secondary','licensed',now())`,
    [sourceId],
  );
  await pool.query(
    `insert into snapshots (snapshot_id, subject_refs, source_ids, as_of, basis, normalization, allowed_transforms)
     values ($1, '[]'::jsonb, $2::jsonb, now(), 'unadjusted', 'none', '{}'::jsonb)`,
    [answerSnapshotId, JSON.stringify([sourceId])],
  );
  await pool.query(`insert into chat_threads (thread_id, user_id) values ($1,$2),($3,$4)`, [
    ownerThreadId, ownerId, strangerThreadId, strangerId,
  ]);
  const { rows: [answer] } = await pool.query<{ message_id: string }>(
    `insert into chat_messages (thread_id, role, snapshot_id, blocks, content_hash)
     values ($1::uuid, 'assistant', $2::uuid, '[]'::jsonb, 'h')
     returning message_id::text as message_id`,
    [ownerThreadId, answerSnapshotId],
  );

  const ref: EvidenceInspectionRef = { kind: "source", id: sourceId };
  const ownerView = await loadEvidenceInspection(pool, { user_id: ownerId, snapshot_id: answerSnapshotId, ref });
  assert.deepEqual(ownerView.links, [{ label: "Open source", href: "https://polygon.io/" }]);

  const base = await startChatTestServer(t, { threadsDb: pool });
  const post = (body: { message_id: string; snapshot_id: string }) => fetch(`${base}/v1/chat/threads/${strangerThreadId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": strangerId },
    body: JSON.stringify({ ...body, content: "What did they ask?" }),
  });
  const savedUnder = async (body: { message_id: string; snapshot_id: string }) => {
    const response = await post(body);
    assert.equal(response.status, 201);
    const { message } = (await response.json()) as { message: { snapshot_id: string } };
    const { rows: [snapshot] } = await pool.query(
      `select basis, model_version, (select latest_snapshot_id::text from chat_threads where thread_id = $2::uuid) as thread_latest
         from snapshots where snapshot_id = $1::uuid`,
      [message.snapshot_id, strangerThreadId],
    );
    return { snapshot_id: message.snapshot_id, ...snapshot };
  };

  const taken = await savedUnder({ message_id: randomUUID(), snapshot_id: answerSnapshotId });
  assert.deepEqual(
    { basis: taken.basis, model_version: taken.model_version, thread_latest: taken.thread_latest },
    { basis: "user_input", model_version: "chat-user-message", thread_latest: taken.snapshot_id },
  );
  await assert.rejects(
    () => loadEvidenceInspection(pool, { user_id: strangerId, snapshot_id: answerSnapshotId, ref }),
    /snapshot is not visible/,
  );

  // The owner's next clarification seals under this id, with a plain insert.
  const ownerTurnId = randomUUID();
  const clarificationSnapshotId = stableUuid(`scope-snapshot:${ownerThreadId}:${ownerTurnId}`);
  const preclaim = await savedUnder({ message_id: randomUUID(), snapshot_id: clarificationSnapshotId });
  assert.equal(preclaim.basis, "user_input");
  const claimed = await pool.query(`select count(*)::int as n from snapshots where snapshot_id = $1::uuid`, [clarificationSnapshotId]);
  assert.deepEqual(claimed.rows, [{ n: 0 }]);

  const rowsNow = async () => ({
    messages: (await pool.query(`select thread_id::text, role, snapshot_id::text, blocks, content_hash from chat_messages order by message_id`)).rows,
    snapshots: (await pool.query(`select count(*)::int as n from snapshots`)).rows,
  });
  const before = await rowsNow();
  const collided = await post({ message_id: answer!.message_id, snapshot_id: randomUUID() });
  assert.equal(collided.status, 409);
  assert.deepEqual(await collided.json(), { error: "message_id is already in use" });
  assert.deepEqual(await rowsNow(), before);
});

test("an answer whose id a user message of its own thread holds fails its turn, and leaves that message (#550)", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for answer id coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "chat-answer-id-taken");
  const pool = await connectedPool(t, databaseUrl);
  // Its clients fail every message read, as a read-back that fails after the commit does.
  const unreadable = await connectedPool(t, databaseUrl);
  unreadable.on("connect", (client) => {
    const query = client.query.bind(client) as (...args: unknown[]) => unknown;
    client.query = ((...args: unknown[]) =>
      typeof args[0] === "string" && args[0].includes("from chat_messages m") ? Promise.reject(new Error("read failed")) : query(...args)) as never;
  });
  const [userId, threadId, snapshotId, questionSnapshotId] = Array.from({ length: 4 }, () => randomUUID());
  await pool.query(`insert into users (user_id, email) values ($1,$2)`, [userId, `${userId}@t.dev`]);
  await pool.query(`insert into chat_threads (thread_id, user_id) values ($1,$2)`, [threadId, userId]);
  await pool.query(
    `insert into snapshots (snapshot_id, subject_refs, source_ids, as_of, basis, normalization, allowed_transforms)
     values ($1, '[]'::jsonb, '[]'::jsonb, now(), 'unadjusted', 'none', '{}'::jsonb), ($2, '[]'::jsonb, '[]'::jsonb, now(), 'unadjusted', 'none', '{}'::jsonb)`,
    [snapshotId, questionSnapshotId],
  );
  const rowsNow = async () => ({
    messages: (await pool.query(`select message_id::text, thread_id::text, role, snapshot_id::text, blocks, content_hash from chat_messages order by message_id`)).rows,
    thread: (await pool.query(`select latest_snapshot_id::text from chat_threads`)).rows,
  });

  const outcome = async (persistencePool: typeof pool) => {
    const [runId, turnId] = [randomUUID(), randomUUID()];
    await pool.query(
      `insert into chat_messages (message_id, thread_id, role, snapshot_id, blocks, content_hash) values ($1::uuid, $2::uuid, 'user', $3::uuid, '[]'::jsonb, 'h')`,
      [answerMessageId(threadId, runId, turnId), threadId, questionSnapshotId],
    );
    const before = await rowsNow();
    const turn = createChatCoordinator({
      analystToolRuntime: async () => ({
        snapshot_id: snapshotId,
        verification: { ok: true, failures: [] },
        tool_calls: [],
        blocks: [{
          id: "block-1",
          kind: "rich_text",
          snapshot_id: snapshotId,
          data_ref: { kind: "chat_turn", id: turnId },
          source_refs: [],
          as_of: "2026-05-06T00:00:00.000Z",
          segments: [{ type: "text", text: "Sealed." }],
        }],
      }),
      persistAssistantMessage: createChatMessagePersistence({
        pool: persistencePool,
        sealSnapshot: async () => ({ ok: true, verification: { ok: true, failures: [] }, snapshot: { snapshot_id: snapshotId } }) as never,
      }),
    }).getOrCreateTurn({ threadId, runId, turnId, userIntent: "What is the latest news?" });
    await turn.completed;
    assert.deepEqual(await rowsNow(), before);
    const last = turn.events.at(-1) as unknown as { type: string; error_code?: string };
    return [last.type, last.error_code];
  };

  assert.deepEqual(await outcome(pool), ["turn.error", "ChatMessageIdTakenError"]);
  assert.deepEqual(await outcome(unreadable), ["turn.error", "ChatMessageIdTakenError"]);
});
