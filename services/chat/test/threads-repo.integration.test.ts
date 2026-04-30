import test from "node:test";
import assert from "node:assert/strict";

import type { Client } from "pg";

import {
  archiveThread,
  createThread,
  getThread,
  listThreads,
  updateThreadTitle,
} from "../src/threads-repo.ts";
import {
  bootstrapDatabase,
  connectedClient,
  dockerAvailable,
} from "../../../db/test/docker-pg.ts";

async function seedUser(client: Client, email: string): Promise<string> {
  const { rows } = await client.query<{ user_id: string }>(
    "insert into users (email) values ($1) returning user_id::text as user_id",
    [email],
  );
  return rows[0].user_id;
}

test("end-to-end: create, list, rename, archive a chat thread for a real user", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat threads repository integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-2fu-1-1-threads");
  const client = await connectedClient(t, databaseUrl);

  const userId = await seedUser(client, "fra-2fu-1-1@example.test");

  // Empty list to start.
  assert.deepEqual(await listThreads(client, userId), []);

  // Create two threads with a delay so updated_at orders deterministically.
  const first = await createThread(client, userId, { title: "first" });
  await client.query("select pg_sleep(0.01)");
  const second = await createThread(client, userId, { title: "second" });

  const listed = await listThreads(client, userId);
  assert.equal(listed.length, 2);
  // Newest first by updated_at desc.
  assert.equal(listed[0].thread_id, second.thread_id);
  assert.equal(listed[1].thread_id, first.thread_id);

  // Rename first thread; updated_at advances and it floats to the top.
  const renamed = await updateThreadTitle(client, userId, first.thread_id, { title: "first renamed" });
  assert.equal(renamed.title, "first renamed");
  assert.notEqual(renamed.updated_at, first.updated_at);

  const afterRename = await listThreads(client, userId);
  assert.equal(afterRename[0].thread_id, first.thread_id);

  // Archive the second thread; default list filters it out.
  const archived = await archiveThread(client, userId, second.thread_id);
  assert.ok(archived.archived_at, "expected archived_at to be set");

  const activeOnly = await listThreads(client, userId);
  assert.deepEqual(
    activeOnly.map((t) => t.thread_id),
    [first.thread_id],
  );

  // include_archived returns both rows.
  const all = await listThreads(client, userId, { includeArchived: true });
  assert.equal(all.length, 2);
});

test("archive is idempotent: archived_at is preserved across repeat calls", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat threads repository integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-2fu-1-1-archive-idempotent");
  const client = await connectedClient(t, databaseUrl);

  const userId = await seedUser(client, "fra-2fu-1-1-archive@example.test");
  const created = await createThread(client, userId, { title: "to archive" });

  const firstArchive = await archiveThread(client, userId, created.thread_id);
  assert.ok(firstArchive.archived_at);

  // Repeat archive returns the SAME archived_at — coalesce keeps the original
  // moment, so callers can safely retry without losing audit fidelity.
  const secondArchive = await archiveThread(client, userId, created.thread_id);
  assert.equal(secondArchive.archived_at, firstArchive.archived_at);
});

test("threads are user-scoped: one user's calls cannot see or mutate another user's thread", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat threads repository integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-2fu-1-1-cross-user");
  const client = await connectedClient(t, databaseUrl);

  const ownerId = await seedUser(client, "fra-2fu-1-1-owner@example.test");
  const intruderId = await seedUser(client, "fra-2fu-1-1-intruder@example.test");

  const owned = await createThread(client, ownerId, { title: "private" });

  // Intruder cannot list it.
  const intruderList = await listThreads(client, intruderId);
  assert.equal(intruderList.length, 0);

  // Intruder cannot get it — returns 404 / NotFound (does not leak existence).
  await assert.rejects(
    () => getThread(client, intruderId, owned.thread_id),
    /chat thread not found/,
  );

  // Intruder cannot rename or archive it.
  await assert.rejects(
    () => updateThreadTitle(client, intruderId, owned.thread_id, { title: "stolen" }),
    /chat thread not found/,
  );
  await assert.rejects(
    () => archiveThread(client, intruderId, owned.thread_id),
    /chat thread not found/,
  );

  // The owned thread is untouched: still active, original title.
  const refetched = await getThread(client, ownerId, owned.thread_id);
  assert.equal(refetched.title, "private");
  assert.equal(refetched.archived_at, null);
});

test("create with primary_subject_ref persists both kind and id columns and round-trips them", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat threads repository integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-2fu-1-1-subject");
  const client = await connectedClient(t, databaseUrl);

  const userId = await seedUser(client, "fra-2fu-1-1-subject@example.test");
  const subjectId = "55555555-5555-4555-a555-555555555555";

  const created = await createThread(client, userId, {
    title: "with subject",
    primary_subject_ref: { kind: "issuer", id: subjectId },
  });
  assert.deepEqual(created.primary_subject_ref, { kind: "issuer", id: subjectId });

  // Round-trip through getThread.
  const refetched = await getThread(client, userId, created.thread_id);
  assert.deepEqual(refetched.primary_subject_ref, { kind: "issuer", id: subjectId });
});
