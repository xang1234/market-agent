import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { seedUser, startServer, withUser } from "./helpers.ts";
import { signTrustedUserId } from "../../shared/src/request-auth.ts";

const TRUSTED_PROXY_SECRET = "portfolio-test-secret";

test("server: missing x-user-id header returns 401", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-1");
  const client = await connectedClient(t, databaseUrl);
  const base = await startServer(t, client);

  const res = await fetch(`${base}/v1/portfolios`);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "'x-user-id' header is required" });
});

test("server: malformed x-user-id returns 401", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-1");
  const client = await connectedClient(t, databaseUrl);
  const base = await startServer(t, client);

  const res = await fetch(`${base}/v1/portfolios`, withUser("not-a-uuid"));
  assert.equal(res.status, 401);
});

test("server: GET /v1/portfolios is empty for a fresh user", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-1");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "list-empty@example.test");
  const base = await startServer(t, client);

  const res = await fetch(`${base}/v1/portfolios`, withUser(userId));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { portfolios: [] });
});

test("server: trusted-proxy auth scopes portfolios from server-derived identity, not x-user-id", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-1");
  const client = await connectedClient(t, databaseUrl);
  const userA = await seedUser(client, "trusted-a@example.test");
  const userB = await seedUser(client, "trusted-b@example.test");
  const base = await startServer(t, client, {
    auth: { mode: "trusted_proxy", trustedProxySecret: TRUSTED_PROXY_SECRET },
  });

  const create = await fetch(`${base}/v1/portfolios`, {
    method: "POST",
    headers: {
      "x-authenticated-user-id": userA,
      "x-authenticated-user-signature": signTrustedUserId(userA, TRUSTED_PROXY_SECRET),
      "x-user-id": userB,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "Trusted", base_currency: "USD" }),
  });

  assert.equal(create.status, 201);
  const createBody = (await create.json()) as { portfolio: { user_id: string } };
  assert.equal(createBody.portfolio.user_id, userA);

  const listB = await fetch(`${base}/v1/portfolios`, {
    headers: {
      "x-authenticated-user-id": userB,
      "x-authenticated-user-signature": signTrustedUserId(userB, TRUSTED_PROXY_SECRET),
      "x-user-id": userA,
    },
  });
  assert.equal(listB.status, 200);
  assert.deepEqual(await listB.json(), { portfolios: [] });

  const unsignedCreate = await fetch(`${base}/v1/portfolios`, {
    method: "POST",
    headers: {
      "x-authenticated-user-id": userA,
      "x-user-id": userB,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "Unsigned", base_currency: "USD" }),
  });
  assert.equal(unsignedCreate.status, 401);

  const invalidList = await fetch(`${base}/v1/portfolios`, {
    headers: {
      "x-authenticated-user-id": userB,
      "x-authenticated-user-signature": "0".repeat(64),
      "x-user-id": userA,
    },
  });
  assert.equal(invalidList.status, 401);
});

test("server: POST creates a portfolio with required base_currency", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-1");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "create-ok@example.test");
  const base = await startServer(t, client);

  const res = await fetch(
    `${base}/v1/portfolios`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Core US", base_currency: "USD" }),
    }),
  );
  assert.equal(res.status, 201);
  const body = (await res.json()) as { portfolio: Record<string, unknown> };
  assert.equal(body.portfolio.name, "Core US");
  assert.equal(body.portfolio.base_currency, "USD");
  assert.equal(body.portfolio.user_id, userId);
  assert.match(body.portfolio.portfolio_id as string, /^[0-9a-f-]{36}$/);
});

test("server: POST without base_currency returns 400", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-1");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "create-no-ccy@example.test");
  const base = await startServer(t, client);

  const res = await fetch(
    `${base}/v1/portfolios`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Core" }),
    }),
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /base_currency/);
});

test("server: POST with malformed base_currency returns 400", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-1");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "create-bad-ccy@example.test");
  const base = await startServer(t, client);

  const res = await fetch(
    `${base}/v1/portfolios`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Core", base_currency: "usd" }),
    }),
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /base_currency/);
});

test("server: POST with missing name returns 400", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-1");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "create-no-name@example.test");
  const base = await startServer(t, client);

  const res = await fetch(
    `${base}/v1/portfolios`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ base_currency: "USD" }),
    }),
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /portfolio\.name/);
});

test("server: POST with invalid JSON returns 400", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-1");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "create-bad-json@example.test");
  const base = await startServer(t, client);

  const res = await fetch(
    `${base}/v1/portfolios`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not valid json",
    }),
  );
  assert.equal(res.status, 400);
});

test("server: GET /v1/portfolios/:id returns the portfolio", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-1");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "get-one@example.test");
  const base = await startServer(t, client);

  const created = await fetch(
    `${base}/v1/portfolios`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "EU Sleeve", base_currency: "EUR" }),
    }),
  );
  const createdBody = (await created.json()) as { portfolio: { portfolio_id: string } };

  const res = await fetch(
    `${base}/v1/portfolios/${createdBody.portfolio.portfolio_id}`,
    withUser(userId),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { portfolio: Record<string, unknown> };
  assert.equal(body.portfolio.portfolio_id, createdBody.portfolio.portfolio_id);
  assert.equal(body.portfolio.base_currency, "EUR");
});

test("server: GET /v1/portfolios/:id with another user's id returns 404", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-1");
  const client = await connectedClient(t, databaseUrl);
  const alice = await seedUser(client, "alice-pf@example.test");
  const bob = await seedUser(client, "bob-pf@example.test");
  const base = await startServer(t, client);

  const created = await fetch(
    `${base}/v1/portfolios`,
    withUser(alice, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alice", base_currency: "USD" }),
    }),
  );
  const createdBody = (await created.json()) as { portfolio: { portfolio_id: string } };

  const res = await fetch(
    `${base}/v1/portfolios/${createdBody.portfolio.portfolio_id}`,
    withUser(bob),
  );
  assert.equal(res.status, 404);
});

test("server: GET /v1/portfolios returns only the caller's portfolios", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-1");
  const client = await connectedClient(t, databaseUrl);
  const alice = await seedUser(client, "alice-list@example.test");
  const bob = await seedUser(client, "bob-list@example.test");
  const base = await startServer(t, client);

  await fetch(
    `${base}/v1/portfolios`,
    withUser(alice, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alice US", base_currency: "USD" }),
    }),
  );
  await fetch(
    `${base}/v1/portfolios`,
    withUser(bob, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Bob EU", base_currency: "EUR" }),
    }),
  );

  const aliceList = (await (
    await fetch(`${base}/v1/portfolios`, withUser(alice))
  ).json()) as { portfolios: Array<{ name: string }> };
  const bobList = (await (
    await fetch(`${base}/v1/portfolios`, withUser(bob))
  ).json()) as { portfolios: Array<{ name: string }> };

  assert.equal(aliceList.portfolios.length, 1);
  assert.equal(aliceList.portfolios[0].name, "Alice US");
  assert.equal(bobList.portfolios.length, 1);
  assert.equal(bobList.portfolios[0].name, "Bob EU");
});

test("server: DELETE removes a portfolio; second delete returns 404", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-1");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "delete-pf@example.test");
  const base = await startServer(t, client);

  const created = await fetch(
    `${base}/v1/portfolios`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "To Delete", base_currency: "USD" }),
    }),
  );
  const createdBody = (await created.json()) as { portfolio: { portfolio_id: string } };

  const first = await fetch(
    `${base}/v1/portfolios/${createdBody.portfolio.portfolio_id}`,
    withUser(userId, { method: "DELETE" }),
  );
  assert.equal(first.status, 204);

  const list = (await (
    await fetch(`${base}/v1/portfolios`, withUser(userId))
  ).json()) as { portfolios: unknown[] };
  assert.equal(list.portfolios.length, 0);

  const second = await fetch(
    `${base}/v1/portfolios/${createdBody.portfolio.portfolio_id}`,
    withUser(userId, { method: "DELETE" }),
  );
  assert.equal(second.status, 404);
});

test("server: GET with non-UUID portfolio id returns 404", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-1");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "bad-id@example.test");
  const base = await startServer(t, client);

  const res = await fetch(`${base}/v1/portfolios/not-a-uuid`, withUser(userId));
  assert.equal(res.status, 404);
});

test("server: unknown path returns 404", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-1");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "unknown-pf-path@example.test");
  const base = await startServer(t, client);

  const res = await fetch(`${base}/v1/wat`, withUser(userId));
  assert.equal(res.status, 404);
});
