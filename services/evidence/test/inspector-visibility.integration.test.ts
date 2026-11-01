import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { bootstrapDatabase, connectedClient } from "../../../db/test/docker-pg.ts";
import { loadEvidenceInspection, type EvidenceInspectionRef } from "../src/inspector.ts";
import type { QueryExecutor } from "../src/types.ts";

test("a user message bound to another user's answer snapshot does not open it; the answer's own thread does", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "evidence-inspect-visibility");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;

  const [ownerId, strangerId, sourceId, snapshotId, ownerThreadId, strangerThreadId] =
    Array.from({ length: 6 }, () => randomUUID());
  await db.query(`insert into users (user_id, email) values ($1,$2),($3,$4)`, [
    ownerId, `${ownerId}@t.dev`, strangerId, `${strangerId}@t.dev`,
  ]);
  await db.query(
    `insert into sources (source_id, provider, kind, canonical_url, trust_tier, license_class, retrieved_at)
     values ($1,'polygon','market_data','https://polygon.io/','secondary','licensed',now())`,
    [sourceId],
  );
  await db.query(
    `insert into snapshots (snapshot_id, subject_refs, source_ids, as_of, basis, normalization, allowed_transforms)
     values ($1, '[]'::jsonb, $2::jsonb, now(), 'unadjusted', 'none', '{}'::jsonb)`,
    [snapshotId, JSON.stringify([sourceId])],
  );
  await db.query(`insert into chat_threads (thread_id, user_id) values ($1,$2),($3,$4)`, [
    ownerThreadId, ownerId, strangerThreadId, strangerId,
  ]);
  // The stranger's row is what a user message posted with the owner's
  // snapshot_id left behind before the chat service picked the id itself.
  await db.query(
    `insert into chat_messages (thread_id, role, snapshot_id, blocks, content_hash)
     values ($1::uuid, 'assistant', $3::uuid, '[]'::jsonb, 'h'), ($2::uuid, 'user', $3::uuid, '[]'::jsonb, 'h')`,
    [ownerThreadId, strangerThreadId, snapshotId],
  );

  const ref: EvidenceInspectionRef = { kind: "source", id: sourceId };
  const ownerView = await loadEvidenceInspection(db, { user_id: ownerId, snapshot_id: snapshotId, ref });
  assert.deepEqual(ownerView.links, [{ label: "Open source", href: "https://polygon.io/" }]);
  await assert.rejects(
    () => loadEvidenceInspection(db, { user_id: strangerId, snapshot_id: snapshotId, ref }),
    /snapshot is not visible/,
  );
});
