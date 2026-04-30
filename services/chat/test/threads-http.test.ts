import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import { createChatServer } from "../src/http.ts";
import type { ChatThreadsDb } from "../src/threads-repo.ts";

const USER_ID = "11111111-1111-4111-a111-111111111111";
const THREAD_ID = "22222222-2222-4222-a222-222222222222";
const SUBJECT_ID = "44444444-4444-4444-a444-444444444444";

type RecordedQuery = { text: string; values?: unknown[] };

function fakeDb(handler: (query: RecordedQuery) => unknown[]): {
  db: ChatThreadsDb;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const db: ChatThreadsDb = {
    async query(text: string, values?: unknown[]) {
      const query = { text, values };
      queries.push(query);
      const rows = handler(query);
      return { rows: rows as Record<string, unknown>[], rowCount: rows.length };
    },
  };
  return { db, queries };
}

function buildRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    thread_id: THREAD_ID,
    user_id: USER_ID,
    primary_subject_kind: null,
    primary_subject_id: null,
    title: null,
    latest_snapshot_id: null,
    archived_at: null,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

async function startServer(
  t: TestContext,
  db: ChatThreadsDb,
): Promise<string> {
  const server = createChatServer({ threadsDb: db });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

test("GET /v1/chat/threads returns 401 without an x-user-id header", async (t) => {
  const { db } = fakeDb(() => {
    throw new Error("query must not be called");
  });
  const base = await startServer(t, db);

  const response = await fetch(`${base}/v1/chat/threads`);
  assert.equal(response.status, 401);
  const body = (await response.json()) as { error?: string };
  assert.match(body.error ?? "", /x-user-id/);
});

test("GET /v1/chat/threads returns 401 when x-user-id is malformed", async (t) => {
  const { db } = fakeDb(() => {
    throw new Error("query must not be called");
  });
  const base = await startServer(t, db);

  const response = await fetch(`${base}/v1/chat/threads`, {
    headers: { "x-user-id": "not-a-uuid" },
  });
  assert.equal(response.status, 401);
});

test("GET /v1/chat/threads returns scoped active threads in updated_at desc order", async (t) => {
  const { db, queries } = fakeDb(() => [
    buildRow({ thread_id: THREAD_ID, title: "alpha", updated_at: "2026-04-30T00:00:00.000Z" }),
  ]);
  const base = await startServer(t, db);

  const response = await fetch(`${base}/v1/chat/threads`, {
    headers: { "x-user-id": USER_ID },
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { threads: { thread_id: string; title: string }[] };
  assert.equal(body.threads.length, 1);
  assert.equal(body.threads[0].thread_id, THREAD_ID);
  assert.equal(body.threads[0].title, "alpha");
  assert.match(queries[0].text, /and archived_at is null/);
  assert.deepEqual(queries[0].values, [USER_ID]);
});

test("GET /v1/chat/threads?include_archived=true drops the archived filter", async (t) => {
  const { db, queries } = fakeDb(() => []);
  const base = await startServer(t, db);

  const response = await fetch(`${base}/v1/chat/threads?include_archived=true`, {
    headers: { "x-user-id": USER_ID },
  });
  assert.equal(response.status, 200);
  assert.doesNotMatch(queries[0].text, /archived_at is null/);
});

test("POST /v1/chat/threads creates and returns 201 with the new thread", async (t) => {
  const { db, queries } = fakeDb(() => [buildRow({ title: "research" })]);
  const base = await startServer(t, db);

  const response = await fetch(`${base}/v1/chat/threads`, {
    method: "POST",
    headers: { "x-user-id": USER_ID, "content-type": "application/json" },
    body: JSON.stringify({ title: "research" }),
  });

  assert.equal(response.status, 201);
  const body = (await response.json()) as { thread_id: string; title: string };
  assert.equal(body.thread_id, THREAD_ID);
  assert.equal(body.title, "research");
  assert.deepEqual(queries[0].values, [USER_ID, null, null, "research"]);
});

test("POST /v1/chat/threads accepts an empty body and creates a blank thread", async (t) => {
  const { db, queries } = fakeDb(() => [buildRow()]);
  const base = await startServer(t, db);

  const response = await fetch(`${base}/v1/chat/threads`, {
    method: "POST",
    headers: { "x-user-id": USER_ID },
  });
  assert.equal(response.status, 201);
  assert.deepEqual(queries[0].values, [USER_ID, null, null, null]);
});

test("POST /v1/chat/threads rejects malformed JSON with 400", async (t) => {
  const { db } = fakeDb(() => {
    throw new Error("query must not be called");
  });
  const base = await startServer(t, db);

  const response = await fetch(`${base}/v1/chat/threads`, {
    method: "POST",
    headers: { "x-user-id": USER_ID, "content-type": "application/json" },
    body: "{not json",
  });
  assert.equal(response.status, 400);
});

test("POST /v1/chat/threads rejects invalid subject kind with 400", async (t) => {
  const { db } = fakeDb(() => {
    throw new Error("query must not be called");
  });
  const base = await startServer(t, db);

  const response = await fetch(`${base}/v1/chat/threads`, {
    method: "POST",
    headers: { "x-user-id": USER_ID, "content-type": "application/json" },
    body: JSON.stringify({ primary_subject_ref: { kind: "bogus", id: SUBJECT_ID } }),
  });
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error?: string };
  assert.match(body.error ?? "", /primary_subject_ref\.kind/);
});

test("PATCH /v1/chat/threads/:id updates the title and returns the row", async (t) => {
  const { db, queries } = fakeDb(() => [buildRow({ title: "renamed" })]);
  const base = await startServer(t, db);

  const response = await fetch(`${base}/v1/chat/threads/${THREAD_ID}`, {
    method: "PATCH",
    headers: { "x-user-id": USER_ID, "content-type": "application/json" },
    body: JSON.stringify({ title: "renamed" }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { title: string };
  assert.equal(body.title, "renamed");
  assert.deepEqual(queries[0].values, [USER_ID, THREAD_ID, "renamed"]);
});

test("PATCH /v1/chat/threads/:id rejects body without 'title' field with 400", async (t) => {
  const { db } = fakeDb(() => {
    throw new Error("query must not be called");
  });
  const base = await startServer(t, db);

  const response = await fetch(`${base}/v1/chat/threads/${THREAD_ID}`, {
    method: "PATCH",
    headers: { "x-user-id": USER_ID, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 400);
});

test("PATCH /v1/chat/threads/:id returns 404 when no row matches the user", async (t) => {
  const { db } = fakeDb(() => []);
  const base = await startServer(t, db);

  const response = await fetch(`${base}/v1/chat/threads/${THREAD_ID}`, {
    method: "PATCH",
    headers: { "x-user-id": USER_ID, "content-type": "application/json" },
    body: JSON.stringify({ title: "x" }),
  });
  assert.equal(response.status, 404);
});

test("DELETE /v1/chat/threads/:id archives and returns 204", async (t) => {
  const { db, queries } = fakeDb(() => [
    buildRow({ archived_at: "2026-04-30T12:00:00.000Z" }),
  ]);
  const base = await startServer(t, db);

  const response = await fetch(`${base}/v1/chat/threads/${THREAD_ID}`, {
    method: "DELETE",
    headers: { "x-user-id": USER_ID },
  });
  assert.equal(response.status, 204);
  assert.match(queries[0].text, /coalesce\(archived_at, now\(\)\)/);
  assert.deepEqual(queries[0].values, [USER_ID, THREAD_ID]);
});

test("DELETE /v1/chat/threads/:id returns 404 when no row matches", async (t) => {
  const { db } = fakeDb(() => []);
  const base = await startServer(t, db);

  const response = await fetch(`${base}/v1/chat/threads/${THREAD_ID}`, {
    method: "DELETE",
    headers: { "x-user-id": USER_ID },
  });
  assert.equal(response.status, 404);
});

test("DELETE /v1/chat/threads/:id rejects non-UUID thread ids with 400", async (t) => {
  const { db } = fakeDb(() => {
    throw new Error("query must not be called");
  });
  const base = await startServer(t, db);

  const response = await fetch(`${base}/v1/chat/threads/not-a-uuid`, {
    method: "DELETE",
    headers: { "x-user-id": USER_ID },
  });
  assert.equal(response.status, 400);
});

test("threads CRUD does not interfere with the SSE stream route", async (t) => {
  // Even with threadsDb wired, the stream route (different path shape) should
  // continue to be handled by the existing SSE handler — including its 400
  // for missing run_id.
  const { db } = fakeDb(() => []);
  const base = await startServer(t, db);

  const response = await fetch(`${base}/v1/chat/threads/${THREAD_ID}/stream`);
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error?: string };
  assert.equal(body.error, "'run_id' is required");
});
