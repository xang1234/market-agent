import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";

import type { ChatThreadsDb } from "../src/threads-repo.ts";
import { signTrustedUserId, type RequestAuthConfig } from "../../shared/src/request-auth.ts";
import { startChatTestServer } from "./sse-helpers.ts";
import {
  buildRow,
  fakeDb,
  SUBJECT_ID,
  THREAD_ID,
  USER_ID,
} from "./threads-fixtures.ts";

const USER_B = "55555555-5555-4555-8555-555555555555";
const TRUSTED_PROXY_SECRET = "thread-test-secret";
const TRUSTED_PROXY_NOW = new Date("2026-05-06T00:00:00.000Z");

function startServer(
  t: TestContext,
  db: ChatThreadsDb,
  options: { auth?: RequestAuthConfig } = {},
): Promise<string> {
  return startChatTestServer(t, { threadsDb: db, auth: options.auth });
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

test("trusted-proxy auth scopes chat threads from server-derived identity, not x-user-id", async (t) => {
  const { db, queries } = fakeDb(() => [
    buildRow({ thread_id: THREAD_ID, title: "trusted" }),
  ]);
  const base = await startServer(t, db, {
    auth: { mode: "trusted_proxy", trustedProxySecret: TRUSTED_PROXY_SECRET },
  });

  const response = await fetch(`${base}/v1/chat/threads`, {
    headers: {
      "x-authenticated-user-id": USER_ID,
      "x-authenticated-user-signature": signTrustedUserId(USER_ID, TRUSTED_PROXY_SECRET),
      "x-user-id": USER_B,
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(queries[0].values, [USER_ID]);
});

test("trusted-proxy auth rejects unsigned server-derived identity headers", async (t) => {
  const { db } = fakeDb(() => {
    throw new Error("query must not be called");
  });
  const base = await startServer(t, db, {
    auth: { mode: "trusted_proxy", trustedProxySecret: TRUSTED_PROXY_SECRET },
  });

  const response = await fetch(`${base}/v1/chat/threads`, {
    headers: { "x-authenticated-user-id": USER_ID },
  });

  assert.equal(response.status, 401);
});

test("trusted-proxy auth rejects expired and tampered server-derived signatures", async (t) => {
  const { db } = fakeDb(() => {
    throw new Error("query must not be called");
  });
  const base = await startServer(t, db, {
    auth: {
      mode: "trusted_proxy",
      trustedProxySecret: TRUSTED_PROXY_SECRET,
      trustedProxyClock: () => TRUSTED_PROXY_NOW,
    },
  });
  const fresh = signTrustedUserId(USER_ID, TRUSTED_PROXY_SECRET, { issuedAt: TRUSTED_PROXY_NOW });
  const tamperedTimestamp = fresh.replace(":1778025600000:", ":1778022000000:");
  const expired = signTrustedUserId(USER_ID, TRUSTED_PROXY_SECRET, {
    issuedAt: new Date("2026-05-05T23:54:00.000Z"),
  });

  for (const signature of [tamperedTimestamp, expired]) {
    const response = await fetch(`${base}/v1/chat/threads`, {
      headers: {
        "x-authenticated-user-id": USER_ID,
        "x-authenticated-user-signature": signature,
      },
    });
    assert.equal(response.status, 401);
  }
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

test("PATCH /v1/chat/threads/:id rejects an entirely empty body with 400", async (t) => {
  const { db } = fakeDb(() => {
    throw new Error("query must not be called");
  });
  const base = await startServer(t, db);

  const response = await fetch(`${base}/v1/chat/threads/${THREAD_ID}`, {
    method: "PATCH",
    headers: { "x-user-id": USER_ID },
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
  const { db } = fakeDb(() => []);
  const base = await startServer(t, db);

  const response = await fetch(`${base}/v1/chat/threads/${THREAD_ID}/stream`);
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error?: string };
  assert.equal(body.error, "'run_id' is required");
});
