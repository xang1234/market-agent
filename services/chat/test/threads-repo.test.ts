import test from "node:test";
import assert from "node:assert/strict";

import {
  archiveThread,
  ChatThreadNotFoundError,
  ChatThreadValidationError,
  createThread,
  getThread,
  listThreads,
  updateThreadTitle,
} from "../src/threads-repo.ts";
import {
  buildRow,
  fakeDb,
  SNAPSHOT_ID,
  SUBJECT_ID,
  THREAD_ID,
  USER_ID,
} from "./threads-fixtures.ts";

test("listThreads filters out archived rows by default and orders by updated_at desc", async () => {
  const { db, queries } = fakeDb(() => [
    buildRow({ thread_id: THREAD_ID, updated_at: "2026-04-02T00:00:00.000Z" }),
  ]);

  const threads = await listThreads(db, USER_ID);

  assert.equal(threads.length, 1);
  assert.equal(threads[0].thread_id, THREAD_ID);
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /from chat_threads/);
  assert.match(queries[0].text, /where user_id = \$1::uuid\s+and archived_at is null/);
  assert.match(queries[0].text, /order by updated_at desc/);
  assert.deepEqual(queries[0].values, [USER_ID]);
});

test("listThreads with includeArchived omits the archived_at filter", async () => {
  const { db, queries } = fakeDb(() => []);
  await listThreads(db, USER_ID, { includeArchived: true });
  assert.doesNotMatch(queries[0].text, /archived_at is null/);
});

test("listThreads rejects malformed user ids before any query", async () => {
  const { db, queries } = fakeDb(() => {
    throw new Error("query must not be called");
  });
  await assert.rejects(() => listThreads(db, "not-a-uuid"), ChatThreadValidationError);
  assert.equal(queries.length, 0);
});

test("listThreads maps subject ref columns into a single primary_subject_ref object", async () => {
  const { db } = fakeDb(() => [
    buildRow({ primary_subject_kind: "issuer", primary_subject_id: SUBJECT_ID }),
  ]);
  const [thread] = await listThreads(db, USER_ID);
  assert.deepEqual(thread.primary_subject_ref, { kind: "issuer", id: SUBJECT_ID });
});

test("listThreads returns null primary_subject_ref when only one half is present", async () => {
  const { db } = fakeDb(() => [buildRow({ primary_subject_kind: "issuer", primary_subject_id: null })]);
  const [thread] = await listThreads(db, USER_ID);
  assert.equal(thread.primary_subject_ref, null);
});

test("createThread inserts with normalized title and subject ref", async () => {
  const { db, queries } = fakeDb(() => [
    buildRow({ title: "My thread", primary_subject_kind: "issuer", primary_subject_id: SUBJECT_ID }),
  ]);

  const thread = await createThread(db, USER_ID, {
    title: "  My thread  ",
    primary_subject_ref: { kind: "issuer", id: SUBJECT_ID },
  });

  assert.equal(thread.title, "My thread");
  assert.deepEqual(thread.primary_subject_ref, { kind: "issuer", id: SUBJECT_ID });
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /insert into chat_threads/);
  assert.deepEqual(queries[0].values, [USER_ID, "issuer", SUBJECT_ID, "My thread"]);
});

test("createThread defaults to nulls when neither title nor subject is provided", async () => {
  const { db, queries } = fakeDb(() => [buildRow()]);
  await createThread(db, USER_ID);
  assert.deepEqual(queries[0].values, [USER_ID, null, null, null]);
});

test("createThread treats whitespace-only titles as null", async () => {
  const { db, queries } = fakeDb(() => [buildRow()]);
  await createThread(db, USER_ID, { title: "   " });
  assert.deepEqual(queries[0].values?.[3], null);
});

test("createThread rejects oversize titles", async () => {
  const { db, queries } = fakeDb(() => {
    throw new Error("query must not be called");
  });
  const tooLong = "x".repeat(241);
  await assert.rejects(
    () => createThread(db, USER_ID, { title: tooLong }),
    ChatThreadValidationError,
  );
  assert.equal(queries.length, 0);
});

test("createThread rejects unknown subject kind", async () => {
  const { db, queries } = fakeDb(() => {
    throw new Error("query must not be called");
  });
  await assert.rejects(
    () => createThread(db, USER_ID, { primary_subject_ref: { kind: "bogus" as never, id: SUBJECT_ID } }),
    ChatThreadValidationError,
  );
  assert.equal(queries.length, 0);
});

test("createThread rejects subject id that is not a UUID", async () => {
  const { db, queries } = fakeDb(() => {
    throw new Error("query must not be called");
  });
  await assert.rejects(
    () => createThread(db, USER_ID, { primary_subject_ref: { kind: "issuer", id: "not-uuid" } }),
    ChatThreadValidationError,
  );
  assert.equal(queries.length, 0);
});

test("getThread scopes by user id and throws NotFound on miss", async () => {
  const { db, queries } = fakeDb(() => []);
  await assert.rejects(
    () => getThread(db, USER_ID, THREAD_ID),
    ChatThreadNotFoundError,
  );
  assert.match(queries[0].text, /where user_id = \$1::uuid and thread_id = \$2::uuid/);
  assert.deepEqual(queries[0].values, [USER_ID, THREAD_ID]);
});

test("getThread returns the row when present", async () => {
  const { db } = fakeDb(() => [buildRow({ latest_snapshot_id: SNAPSHOT_ID })]);
  const thread = await getThread(db, USER_ID, THREAD_ID);
  assert.equal(thread.thread_id, THREAD_ID);
  assert.equal(thread.latest_snapshot_id, SNAPSHOT_ID);
});

test("updateThreadTitle bumps updated_at and scopes by user id", async () => {
  const { db, queries } = fakeDb(() => [buildRow({ title: "renamed" })]);
  const thread = await updateThreadTitle(db, USER_ID, THREAD_ID, { title: "renamed" });
  assert.equal(thread.title, "renamed");
  assert.match(queries[0].text, /update chat_threads/);
  assert.match(queries[0].text, /set title = \$3,\s+updated_at = now\(\)/);
  assert.match(queries[0].text, /where user_id = \$1::uuid and thread_id = \$2::uuid/);
  assert.deepEqual(queries[0].values, [USER_ID, THREAD_ID, "renamed"]);
});

test("updateThreadTitle accepts null to clear the title", async () => {
  const { db, queries } = fakeDb(() => [buildRow({ title: null })]);
  await updateThreadTitle(db, USER_ID, THREAD_ID, { title: null });
  assert.equal(queries[0].values?.[2], null);
});

test("updateThreadTitle throws NotFound when no rows match (missing or wrong user)", async () => {
  const { db } = fakeDb(() => []);
  await assert.rejects(
    () => updateThreadTitle(db, USER_ID, THREAD_ID, { title: "x" }),
    ChatThreadNotFoundError,
  );
});

test("archiveThread stamps archived_at via coalesce so repeat archives are idempotent", async () => {
  const { db, queries } = fakeDb(() => [
    buildRow({ archived_at: "2026-04-30T12:00:00.000Z" }),
  ]);
  const thread = await archiveThread(db, USER_ID, THREAD_ID);
  assert.equal(thread.archived_at, "2026-04-30T12:00:00.000Z");
  assert.match(queries[0].text, /set archived_at = coalesce\(archived_at, now\(\)\)/);
  assert.match(queries[0].text, /updated_at = case when archived_at is null then now\(\) else updated_at end/);
  assert.deepEqual(queries[0].values, [USER_ID, THREAD_ID]);
});

test("archiveThread throws NotFound when no rows match", async () => {
  const { db } = fakeDb(() => []);
  await assert.rejects(
    () => archiveThread(db, USER_ID, THREAD_ID),
    ChatThreadNotFoundError,
  );
});
