import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createPortfolioFor, seedUser, startServer, withUser } from "./helpers.ts";

const APPLE_INSTRUMENT = "11111111-1111-4111-a111-111111111111";
const MSFT_LISTING = "22222222-2222-4222-a222-222222222222";

test("holdings: POST creates a holding bound to an instrument", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-2");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "create-holding-instr@example.test");
  const base = await startServer(t, client);
  const pid = await createPortfolioFor(base, userId, { name: "Core", base_currency: "USD" });

  const res = await fetch(
    `${base}/v1/portfolios/${pid}/holdings`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject_ref: { kind: "instrument", id: APPLE_INSTRUMENT },
        quantity: 100,
        cost_basis: 17500,
      }),
    }),
  );
  assert.equal(res.status, 201);
  const body = (await res.json()) as { holding: Record<string, unknown> };
  assert.equal((body.holding.subject_ref as { kind: string }).kind, "instrument");
  assert.equal((body.holding.subject_ref as { id: string }).id, APPLE_INSTRUMENT);
  assert.equal(body.holding.quantity, 100);
  assert.equal(body.holding.cost_basis, 17500);
  assert.equal(body.holding.portfolio_id, pid);
});

test("holdings: POST creates a holding bound to a listing", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-2");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "create-holding-listing@example.test");
  const base = await startServer(t, client);
  const pid = await createPortfolioFor(base, userId, { name: "Core", base_currency: "USD" });

  const res = await fetch(
    `${base}/v1/portfolios/${pid}/holdings`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject_ref: { kind: "listing", id: MSFT_LISTING },
        quantity: 25,
      }),
    }),
  );
  assert.equal(res.status, 201);
});

test("holdings: POST rejects every non-instrument/listing subject_kind with 400", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-2");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "create-holding-bad-kinds@example.test");
  const base = await startServer(t, client);
  const pid = await createPortfolioFor(base, userId, { name: "Core", base_currency: "USD" });

  const badKinds = ["theme", "macro_topic", "portfolio", "screen", "issuer"] as const;
  for (const badKind of badKinds) {
    const res = await fetch(
      `${base}/v1/portfolios/${pid}/holdings`,
      withUser(userId, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject_ref: { kind: badKind, id: APPLE_INSTRUMENT },
          quantity: 100,
        }),
      }),
    );
    assert.equal(res.status, 400, `expected 400 for kind=${badKind}`);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /subject_ref\.kind/, `expected subject_ref.kind in error for kind=${badKind}`);
  }
});

test("holdings: POST rejects raw ticker as subject_id", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-2");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "create-holding-ticker@example.test");
  const base = await startServer(t, client);
  const pid = await createPortfolioFor(base, userId, { name: "Core", base_currency: "USD" });

  const res = await fetch(
    `${base}/v1/portfolios/${pid}/holdings`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject_ref: { kind: "listing", id: "AAPL" },
        quantity: 100,
      }),
    }),
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /subject_ref\.id/);
});

test("holdings: POST rejects missing quantity with 400", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-2");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "create-holding-no-qty@example.test");
  const base = await startServer(t, client);
  const pid = await createPortfolioFor(base, userId, { name: "Core", base_currency: "USD" });

  const res = await fetch(
    `${base}/v1/portfolios/${pid}/holdings`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject_ref: { kind: "instrument", id: APPLE_INSTRUMENT },
      }),
    }),
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /quantity/);
});

test("holdings: GET lists holdings in a portfolio", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-2");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "list-holdings@example.test");
  const base = await startServer(t, client);
  const pid = await createPortfolioFor(base, userId, { name: "Core", base_currency: "USD" });

  await fetch(
    `${base}/v1/portfolios/${pid}/holdings`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject_ref: { kind: "instrument", id: APPLE_INSTRUMENT },
        quantity: 100,
      }),
    }),
  );
  await fetch(
    `${base}/v1/portfolios/${pid}/holdings`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject_ref: { kind: "listing", id: MSFT_LISTING },
        quantity: 50,
      }),
    }),
  );

  const res = await fetch(`${base}/v1/portfolios/${pid}/holdings`, withUser(userId));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { holdings: Array<{ subject_ref: { kind: string } }> };
  assert.equal(body.holdings.length, 2);
  const kinds = body.holdings.map((h) => h.subject_ref.kind).sort();
  assert.deepEqual(kinds, ["instrument", "listing"]);
});

test("holdings: GET on another user's portfolio returns 404", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-2");
  const client = await connectedClient(t, databaseUrl);
  const alice = await seedUser(client, "alice-h@example.test");
  const bob = await seedUser(client, "bob-h@example.test");
  const base = await startServer(t, client);
  const alicePid = await createPortfolioFor(base, alice, { name: "Alice", base_currency: "USD" });

  const res = await fetch(`${base}/v1/portfolios/${alicePid}/holdings`, withUser(bob));
  assert.equal(res.status, 404);
});

test("holdings: POST on another user's portfolio returns 404", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-2");
  const client = await connectedClient(t, databaseUrl);
  const alice = await seedUser(client, "alice-h-post@example.test");
  const bob = await seedUser(client, "bob-h-post@example.test");
  const base = await startServer(t, client);
  const alicePid = await createPortfolioFor(base, alice, { name: "Alice", base_currency: "USD" });

  const res = await fetch(
    `${base}/v1/portfolios/${alicePid}/holdings`,
    withUser(bob, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject_ref: { kind: "instrument", id: APPLE_INSTRUMENT },
        quantity: 100,
      }),
    }),
  );
  assert.equal(res.status, 404);
});

test("holdings: DELETE removes a holding; second delete returns 404", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-2");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "delete-holding@example.test");
  const base = await startServer(t, client);
  const pid = await createPortfolioFor(base, userId, { name: "Core", base_currency: "USD" });

  const created = await fetch(
    `${base}/v1/portfolios/${pid}/holdings`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject_ref: { kind: "instrument", id: APPLE_INSTRUMENT },
        quantity: 100,
      }),
    }),
  );
  const createdBody = (await created.json()) as { holding: { portfolio_holding_id: string } };
  const holdingId = createdBody.holding.portfolio_holding_id;

  const first = await fetch(
    `${base}/v1/portfolios/${pid}/holdings/${holdingId}`,
    withUser(userId, { method: "DELETE" }),
  );
  assert.equal(first.status, 204);

  const list = (await (
    await fetch(`${base}/v1/portfolios/${pid}/holdings`, withUser(userId))
  ).json()) as { holdings: unknown[] };
  assert.equal(list.holdings.length, 0);

  const second = await fetch(
    `${base}/v1/portfolios/${pid}/holdings/${holdingId}`,
    withUser(userId, { method: "DELETE" }),
  );
  assert.equal(second.status, 404);
});

test("holdings: deleting parent portfolio cascades to holdings", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-2");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "cascade-holdings@example.test");
  const base = await startServer(t, client);
  const pid = await createPortfolioFor(base, userId, { name: "Core", base_currency: "USD" });

  await fetch(
    `${base}/v1/portfolios/${pid}/holdings`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject_ref: { kind: "instrument", id: APPLE_INSTRUMENT },
        quantity: 100,
      }),
    }),
  );

  const del = await fetch(`${base}/v1/portfolios/${pid}`, withUser(userId, { method: "DELETE" }));
  assert.equal(del.status, 204);

  const remaining = await client.query<{ count: string }>(
    `select count(*)::text as count from portfolio_holdings where portfolio_id = $1`,
    [pid],
  );
  assert.equal(remaining.rows[0].count, "0");
});
