import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Client } from "pg";
import { bootstrapDatabase, connectedClient, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { createWatchlistsServer } from "../src/http.ts";

// bootstrapDatabase applies the base schema pack only; 0003 adds the
// trigger + unique index that provision the implicit default manual
// watchlist. Apply it explicitly so these service tests exercise the
// same DB state the migration produces.
const defaultManualWatchlistMigrationSql = readFileSync(
  join(workspaceRoot, "db", "migrations", "0003_default_manual_watchlist.up.sql"),
  "utf8",
);

async function applyDefaultManualWatchlistMigration(client: Client): Promise<void> {
  await client.query(defaultManualWatchlistMigrationSql);
}

async function startServer(t: TestContext, db: Parameters<typeof createWatchlistsServer>[0]): Promise<string> {
  const server = createWatchlistsServer(db);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

const APPLE_LISTING = { kind: "listing", id: "11111111-1111-4111-a111-111111111111" } as const;
const MSFT_LISTING = { kind: "listing", id: "22222222-2222-4222-a222-222222222222" } as const;

async function seedUser(client: Client, email: string): Promise<string> {
  const result = await client.query<{ user_id: string }>(
    `insert into users (email) values ($1) returning user_id`,
    [email],
  );
  return result.rows[0].user_id;
}

function withUser(userId: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "x-user-id": userId,
    },
  };
}

test("server: missing x-user-id header returns 401", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for watchlists coverage");
    return;
  }
  const { client, base } = await setupWatchlistsServer(t);

  const res = await fetch(`${base}/v1/watchlists/default/members`);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "'x-user-id' header is required" });
});

test("server: malformed x-user-id returns 401", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for watchlists coverage");
    return;
  }
  const { client, base } = await setupWatchlistsServer(t);

  const res = await fetch(
    `${base}/v1/watchlists/default/members`,
    withUser("not-a-uuid"),
  );
  assert.equal(res.status, 401);
});

test("server: GET /v1/watchlists/default/members returns empty list for fresh user", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for watchlists coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-6-1");
  const client = await connectedClient(t, databaseUrl);
  await applyDefaultManualWatchlistMigration(client);
  const userId = await seedUser(client, "list-empty@example.test");
  const base = await startServer(t, client);

  const res = await fetch(`${base}/v1/watchlists/default/members`, withUser(userId));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { members: [] });
});

test("server: POST adds a member, GET returns it, idempotent on repeat", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for watchlists coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-6-1");
  const client = await connectedClient(t, databaseUrl);
  await applyDefaultManualWatchlistMigration(client);
  const userId = await seedUser(client, "list-add@example.test");
  const base = await startServer(t, client);

  const addFirst = await fetch(
    `${base}/v1/watchlists/default/members`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject_ref: APPLE_LISTING }),
    }),
  );
  assert.equal(addFirst.status, 201);
  const firstBody = (await addFirst.json()) as { status: string; member: { subject_ref: unknown } };
  assert.equal(firstBody.status, "created");
  assert.deepEqual(firstBody.member.subject_ref, APPLE_LISTING);

  const addSecond = await fetch(
    `${base}/v1/watchlists/default/members`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject_ref: APPLE_LISTING }),
    }),
  );
  assert.equal(addSecond.status, 200);
  const secondBody = (await addSecond.json()) as { status: string };
  assert.equal(secondBody.status, "already_present");

  const listRes = await fetch(`${base}/v1/watchlists/default/members`, withUser(userId));
  assert.equal(listRes.status, 200);
  const listBody = (await listRes.json()) as { members: Array<{ subject_ref: unknown }> };
  assert.equal(listBody.members.length, 1);
  assert.deepEqual(listBody.members[0].subject_ref, APPLE_LISTING);
});

test("server: DELETE removes a member, returns 204; second delete returns 404", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for watchlists coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-6-1");
  const client = await connectedClient(t, databaseUrl);
  await applyDefaultManualWatchlistMigration(client);
  const userId = await seedUser(client, "list-delete@example.test");
  const base = await startServer(t, client);

  await fetch(
    `${base}/v1/watchlists/default/members`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject_ref: MSFT_LISTING }),
    }),
  );

  const deleteFirst = await fetch(
    `${base}/v1/watchlists/default/members/${MSFT_LISTING.kind}/${MSFT_LISTING.id}`,
    withUser(userId, { method: "DELETE" }),
  );
  assert.equal(deleteFirst.status, 204);

  const listRes = await fetch(`${base}/v1/watchlists/default/members`, withUser(userId));
  const listBody = (await listRes.json()) as { members: unknown[] };
  assert.equal(listBody.members.length, 0);

  const deleteAgain = await fetch(
    `${base}/v1/watchlists/default/members/${MSFT_LISTING.kind}/${MSFT_LISTING.id}`,
    withUser(userId, { method: "DELETE" }),
  );
  assert.equal(deleteAgain.status, 404);
});

test("server: POST with missing or malformed subject_ref returns 400", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for watchlists coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-6-1");
  const client = await connectedClient(t, databaseUrl);
  await applyDefaultManualWatchlistMigration(client);
  const userId = await seedUser(client, "list-validate@example.test");
  const base = await startServer(t, client);

  const missing = await fetch(
    `${base}/v1/watchlists/default/members`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
  );
  assert.equal(missing.status, 400);

  const badKind = await fetch(
    `${base}/v1/watchlists/default/members`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject_ref: { kind: "ticker", id: APPLE_LISTING.id } }),
    }),
  );
  assert.equal(badKind.status, 400);

  const emptyId = await fetch(
    `${base}/v1/watchlists/default/members`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject_ref: { kind: "listing", id: "" } }),
    }),
  );
  assert.equal(emptyId.status, 400);

  const notJson = await fetch(
    `${base}/v1/watchlists/default/members`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not valid json",
    }),
  );
  assert.equal(notJson.status, 400);
});

test("server: DELETE with invalid subject_kind path returns 404", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for watchlists coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-6-1");
  const client = await connectedClient(t, databaseUrl);
  await applyDefaultManualWatchlistMigration(client);
  const userId = await seedUser(client, "list-bad-path@example.test");
  const base = await startServer(t, client);

  const res = await fetch(
    `${base}/v1/watchlists/default/members/ticker/${APPLE_LISTING.id}`,
    withUser(userId, { method: "DELETE" }),
  );
  assert.equal(res.status, 404);
});

test("server: members from one user are isolated from another user", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for watchlists coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-6-1");
  const client = await connectedClient(t, databaseUrl);
  await applyDefaultManualWatchlistMigration(client);
  const alice = await seedUser(client, "alice@example.test");
  const bob = await seedUser(client, "bob@example.test");
  const base = await startServer(t, client);

  await fetch(
    `${base}/v1/watchlists/default/members`,
    withUser(alice, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject_ref: APPLE_LISTING }),
    }),
  );

  const aliceList = (await (await fetch(`${base}/v1/watchlists/default/members`, withUser(alice))).json()) as {
    members: unknown[];
  };
  const bobList = (await (await fetch(`${base}/v1/watchlists/default/members`, withUser(bob))).json()) as {
    members: unknown[];
  };

  assert.equal(aliceList.members.length, 1);
  assert.equal(bobList.members.length, 0);
});

test("server: unknown path returns 404", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for watchlists coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-6-1");
  const client = await connectedClient(t, databaseUrl);
  await applyDefaultManualWatchlistMigration(client);
  const userId = await seedUser(client, "unknown-path@example.test");
  const base = await startServer(t, client);

  const res = await fetch(`${base}/v1/watchlists`, withUser(userId));
  assert.equal(res.status, 404);
});
