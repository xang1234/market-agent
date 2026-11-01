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

test("a snapshot sealed under an answer opens for the answer's owner; a user message's snapshot grants nothing", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "evidence-inspect-children");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;

  const [ownerId, strangerId, sourceId, ownerThreadId, strangerThreadId] = Array.from({ length: 5 }, () => randomUUID());
  await db.query(`insert into users (user_id, email) values ($1,$2),($3,$4)`, [
    ownerId, `${ownerId}@t.dev`, strangerId, `${strangerId}@t.dev`,
  ]);
  await db.query(
    `insert into sources (source_id, provider, kind, canonical_url, trust_tier, license_class, retrieved_at)
     values ($1,'polygon','market_data','https://polygon.io/','secondary','licensed',now())`,
    [sourceId],
  );
  const snapshot = async (parent: string | null) => {
    const snapshotId = randomUUID();
    await db.query(
      `insert into snapshots (snapshot_id, subject_refs, source_ids, as_of, basis, normalization, allowed_transforms, parent_snapshot)
       values ($1, '[]'::jsonb, $2::jsonb, now(), 'unadjusted', 'none', '{}'::jsonb, $3)`,
      [snapshotId, JSON.stringify([sourceId]), parent],
    );
    return snapshotId;
  };
  const answer = await snapshot(null);
  const question = await snapshot(null);
  const cause = await snapshot(answer);
  const questionChild = await snapshot(question);
  await db.query(`insert into chat_threads (thread_id, user_id) values ($1,$2),($3,$4)`, [
    ownerThreadId, ownerId, strangerThreadId, strangerId,
  ]);
  // The stranger's user message names the owner's answer snapshot, as one
  // posted before the chat service picked the id itself could.
  await db.query(
    `insert into chat_messages (thread_id, role, snapshot_id, blocks, content_hash)
     values ($1::uuid, 'assistant', $3::uuid, '[]'::jsonb, 'h'), ($1::uuid, 'user', $4::uuid, '[]'::jsonb, 'h'),
            ($2::uuid, 'user', $3::uuid, '[]'::jsonb, 'h')`,
    [ownerThreadId, strangerThreadId, answer, question],
  );

  const ref: EvidenceInspectionRef = { kind: "source", id: sourceId };
  const ownerView = await loadEvidenceInspection(db, { user_id: ownerId, snapshot_id: cause, ref });
  assert.deepEqual(ownerView.links, [{ label: "Open source", href: "https://polygon.io/" }]);
  await assert.rejects(
    () => loadEvidenceInspection(db, { user_id: strangerId, snapshot_id: cause, ref }),
    /snapshot is not visible/,
  );
  await assert.rejects(
    () => loadEvidenceInspection(db, { user_id: ownerId, snapshot_id: questionChild, ref }),
    /snapshot is not visible/,
  );
});

test("a child snapshot opens only through its parent's answer; another owner's finding or answer naming the child grants nothing", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "evidence-inspect-child-holders");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;

  const [ownerId, strangerId, sourceId, ownerThreadId, strangerThreadId, agentId] = Array.from({ length: 6 }, () => randomUUID());
  await db.query(`insert into users (user_id, email) values ($1,$2),($3,$4)`, [
    ownerId, `${ownerId}@t.dev`, strangerId, `${strangerId}@t.dev`,
  ]);
  await db.query(
    `insert into sources (source_id, provider, kind, canonical_url, trust_tier, license_class, retrieved_at)
     values ($1,'polygon','market_data','https://polygon.io/','secondary','licensed',now())`,
    [sourceId],
  );
  const snapshot = async (parent: string | null) => {
    const snapshotId = randomUUID();
    await db.query(
      `insert into snapshots (snapshot_id, subject_refs, source_ids, as_of, basis, normalization, allowed_transforms, parent_snapshot)
       values ($1, '[]'::jsonb, $2::jsonb, now(), 'unadjusted', 'none', '{}'::jsonb, $3)`,
      [snapshotId, JSON.stringify([sourceId]), parent],
    );
    return snapshotId;
  };
  const answer = await snapshot(null);
  const cause = await snapshot(answer);
  await db.query(`insert into chat_threads (thread_id, user_id) values ($1,$2),($3,$4)`, [
    ownerThreadId, ownerId, strangerThreadId, strangerId,
  ]);
  await db.query(
    `insert into chat_messages (thread_id, role, snapshot_id, blocks, content_hash)
     values ($1::uuid, 'assistant', $3::uuid, '[]'::jsonb, 'h'), ($2::uuid, 'assistant', $4::uuid, '[]'::jsonb, 'h')`,
    [ownerThreadId, strangerThreadId, answer, cause],
  );
  await db.query(
    `insert into agents (agent_id, user_id, name, thesis, universe, cadence) values ($1, $2, 'Monitor', 'Thesis', '[]'::jsonb, 'daily')`,
    [agentId, strangerId],
  );
  await db.query(
    `insert into findings (agent_id, snapshot_id, subject_refs, severity, headline, summary_blocks)
     values ($1, $2, '[]'::jsonb, 'low', 'h', '[]'::jsonb)`,
    [agentId, cause],
  );

  const ref: EvidenceInspectionRef = { kind: "source", id: sourceId };
  const ownerView = await loadEvidenceInspection(db, { user_id: ownerId, snapshot_id: cause, ref });
  assert.deepEqual(ownerView.links, [{ label: "Open source", href: "https://polygon.io/" }]);
  await assert.rejects(
    () => loadEvidenceInspection(db, { user_id: strangerId, snapshot_id: cause, ref }),
    /snapshot is not visible/,
  );
});
