import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { bootstrapDatabase, connectedClient } from "../../../db/test/docker-pg.ts";
import { deleteSnapshotIfUnreachable, snapshotHasCurrentReachability } from "../src/snapshot-reachability.ts";
import type { QueryExecutor } from "../src/types.ts";

async function snapshot(db: QueryExecutor, parent: string | null = null): Promise<string> {
  const snapshotId = randomUUID();
  await db.query(
    `insert into snapshots (snapshot_id, subject_refs, as_of, basis, normalization, allowed_transforms, parent_snapshot)
     values ($1, '[]'::jsonb, now(), 'unadjusted', 'none', '{}'::jsonb, $2)`,
    [snapshotId, parent],
  );
  return snapshotId;
}

test("a snapshot sealed under an answer is held by the answer, and never holds the answer's snapshot", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "evidence-snapshot-children");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;

  const [userId, threadId] = [randomUUID(), randomUUID()];
  await db.query(`insert into users (user_id, email) values ($1, $2)`, [userId, `${userId}@t.dev`]);
  await db.query(`insert into chat_threads (thread_id, user_id) values ($1, $2)`, [threadId, userId]);
  const answer = await snapshot(db);
  const cause = await snapshot(db, answer);
  await db.query(
    `insert into chat_messages (thread_id, role, snapshot_id, blocks, content_hash) values ($1, 'assistant', $2, '[]'::jsonb, 'h')`,
    [threadId, answer],
  );

  assert.equal(await snapshotHasCurrentReachability(db, cause), true, "the answer holds the snapshot sealed under it");

  await db.query(`delete from chat_threads where thread_id = $1`, [threadId]);
  assert.equal(await snapshotHasCurrentReachability(db, cause), false, "nothing holds it once the answer is gone");
  assert.equal(await snapshotHasCurrentReachability(db, answer), false, "the child does not hold its parent");

  assert.equal(await deleteSnapshotIfUnreachable(db, answer), true);
  const { rows } = await db.query(`select snapshot_id from snapshots where snapshot_id = any($1::uuid[])`, [[answer, cause]]);
  assert.deepEqual(rows, [], "the parent's deletion takes its child");
});
