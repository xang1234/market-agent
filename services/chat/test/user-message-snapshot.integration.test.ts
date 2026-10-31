import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { bootstrapDatabase, connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { loadEvidenceInspection, type EvidenceInspectionRef } from "../../evidence/src/inspector.ts";
import { startChatTestServer } from "./sse-helpers.ts";

test("a user message carrying another user's answer snapshot_id neither binds it nor opens it in the inspector", { timeout: 120000 }, async (t) => {
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
  await pool.query(
    `insert into chat_messages (thread_id, role, snapshot_id, blocks, content_hash)
     values ($1::uuid, 'assistant', $2::uuid, '[]'::jsonb, 'h')`,
    [ownerThreadId, answerSnapshotId],
  );

  const ref: EvidenceInspectionRef = { kind: "source", id: sourceId };
  const ownerView = await loadEvidenceInspection(pool, { user_id: ownerId, snapshot_id: answerSnapshotId, ref });
  assert.deepEqual(ownerView.links, [{ label: "Open source", href: "https://polygon.io/" }]);

  const base = await startChatTestServer(t, { threadsDb: pool });
  const post = (snapshotId: string) => fetch(`${base}/v1/chat/threads/${strangerThreadId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": strangerId },
    body: JSON.stringify({ message_id: randomUUID(), snapshot_id: snapshotId, content: "What did they ask?" }),
  });
  const response = await post(answerSnapshotId);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "snapshot_id is already in use" });

  const bound = await pool.query(
    `select m.message_id, t.latest_snapshot_id
       from chat_threads t left join chat_messages m on m.thread_id = t.thread_id
      where t.thread_id = $1::uuid`,
    [strangerThreadId],
  );
  assert.deepEqual(bound.rows, [{ message_id: null, latest_snapshot_id: null }]);
  await assert.rejects(
    () => loadEvidenceInspection(pool, { user_id: strangerId, snapshot_id: answerSnapshotId, ref }),
    /snapshot is not visible/,
  );

  const ownSnapshotId = randomUUID();
  const own = await post(ownSnapshotId);
  assert.equal(own.status, 201);
  assert.equal(((await own.json()) as { message: { snapshot_id: string } }).message.snapshot_id, ownSnapshotId);
});
