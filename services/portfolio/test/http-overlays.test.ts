import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { addHolding, createPortfolioFor, seedUser, startServer, withUser } from "./helpers.ts";

const APPLE_INSTRUMENT = "11111111-1111-4111-a111-111111111111";
const MSFT_INSTRUMENT = "22222222-2222-4222-a222-222222222222";

type OverlayResponse = {
  overlays: Array<{
    subject_ref: { kind: string; id: string };
    contributions: Array<{
      portfolio_id: string;
      portfolio_name: string;
      base_currency: string;
      quantity: number;
      cost_basis: number | null;
      held_state: "open" | "closed";
      opened_at: string | null;
      closed_at: string | null;
    }>;
  }>;
};

test("overlays: USD and EUR portfolios holding the same subject contribute separately", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-3");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "overlay-distinct-fx@example.test");
  const base = await startServer(t, client);

  const [usdPid, eurPid] = await Promise.all([
    createPortfolioFor(base, userId, { name: "Core USD", base_currency: "USD" }),
    createPortfolioFor(base, userId, { name: "Core EUR", base_currency: "EUR" }),
  ]);
  await Promise.all([
    addHolding(base, userId, usdPid, {
      subject_ref: { kind: "instrument", id: APPLE_INSTRUMENT },
      quantity: 100,
      cost_basis: 17500,
    }),
    addHolding(base, userId, eurPid, {
      subject_ref: { kind: "instrument", id: APPLE_INSTRUMENT },
      quantity: 50,
      cost_basis: 8200,
    }),
  ]);

  const res = await fetch(
    `${base}/v1/portfolios/overlays`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject_refs: [{ kind: "instrument", id: APPLE_INSTRUMENT }],
      }),
    }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as OverlayResponse;

  assert.equal(body.overlays.length, 1);
  assert.deepEqual(body.overlays[0].subject_ref, { kind: "instrument", id: APPLE_INSTRUMENT });
  assert.equal(body.overlays[0].contributions.length, 2);

  const byCurrency = new Map(body.overlays[0].contributions.map((c) => [c.base_currency, c]));
  const usd = byCurrency.get("USD");
  const eur = byCurrency.get("EUR");
  assert.ok(usd, "USD contribution missing");
  assert.ok(eur, "EUR contribution missing");
  assert.equal(usd.quantity, 100);
  assert.equal(usd.cost_basis, 17500);
  assert.equal(usd.portfolio_id, usdPid);
  assert.equal(eur.quantity, 50);
  assert.equal(eur.cost_basis, 8200);
  assert.equal(eur.portfolio_id, eurPid);
});

test("overlays: duplicate subject_refs do not multiply contributions (PR #28 review)", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-3");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "overlay-dup-refs@example.test");
  const base = await startServer(t, client);
  const pid = await createPortfolioFor(base, userId, { name: "Core", base_currency: "USD" });
  await addHolding(base, userId, pid, {
    subject_ref: { kind: "instrument", id: APPLE_INSTRUMENT },
    quantity: 100,
    cost_basis: 17500,
  });

  const res = await fetch(
    `${base}/v1/portfolios/overlays`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject_refs: [
          { kind: "instrument", id: APPLE_INSTRUMENT },
          { kind: "instrument", id: APPLE_INSTRUMENT },
        ],
      }),
    }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as OverlayResponse;
  // The response still mirrors caller order (one entry per requested subject_ref),
  // but each entry's contributions list reflects exactly one holding — not two.
  assert.equal(body.overlays.length, 2);
  for (const entry of body.overlays) {
    assert.equal(entry.contributions.length, 1, "duplicate input must not multiply contributions");
    assert.equal(entry.contributions[0].quantity, 100);
    assert.equal(entry.contributions[0].cost_basis, 17500);
  }
});

test("overlays: empty contributions for a subject with no holdings", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-3");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "overlay-empty@example.test");
  const base = await startServer(t, client);
  await createPortfolioFor(base, userId, { name: "Core", base_currency: "USD" });

  const res = await fetch(
    `${base}/v1/portfolios/overlays`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject_refs: [{ kind: "instrument", id: APPLE_INSTRUMENT }],
      }),
    }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as OverlayResponse;
  assert.equal(body.overlays.length, 1);
  assert.deepEqual(body.overlays[0].subject_ref, { kind: "instrument", id: APPLE_INSTRUMENT });
  assert.deepEqual(body.overlays[0].contributions, []);
});

test("overlays: response preserves caller-supplied subject_ref order, even with empty contributions", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-3");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "overlay-order@example.test");
  const base = await startServer(t, client);
  const pid = await createPortfolioFor(base, userId, { name: "Core", base_currency: "USD" });
  await addHolding(base, userId, pid, {
    subject_ref: { kind: "instrument", id: MSFT_INSTRUMENT },
    quantity: 25,
  });

  const res = await fetch(
    `${base}/v1/portfolios/overlays`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject_refs: [
          { kind: "instrument", id: APPLE_INSTRUMENT },
          { kind: "instrument", id: MSFT_INSTRUMENT },
        ],
      }),
    }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as OverlayResponse;
  assert.equal(body.overlays.length, 2);
  assert.equal(body.overlays[0].subject_ref.id, APPLE_INSTRUMENT);
  assert.equal(body.overlays[0].contributions.length, 0);
  assert.equal(body.overlays[1].subject_ref.id, MSFT_INSTRUMENT);
  assert.equal(body.overlays[1].contributions.length, 1);
});

test("overlays: response is scoped to caller's portfolios — does not leak another user's holdings", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-3");
  const client = await connectedClient(t, databaseUrl);
  const alice = await seedUser(client, "alice-overlay@example.test");
  const bob = await seedUser(client, "bob-overlay@example.test");
  const base = await startServer(t, client);
  const alicePid = await createPortfolioFor(base, alice, { name: "Alice", base_currency: "USD" });
  await addHolding(base, alice, alicePid, {
    subject_ref: { kind: "instrument", id: APPLE_INSTRUMENT },
    quantity: 100,
  });

  const res = await fetch(
    `${base}/v1/portfolios/overlays`,
    withUser(bob, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject_refs: [{ kind: "instrument", id: APPLE_INSTRUMENT }],
      }),
    }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as OverlayResponse;
  assert.deepEqual(body.overlays[0].contributions, []);
});

test("overlays: held_state is 'closed' when closed_at is set, 'open' otherwise", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-3");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "overlay-held-state@example.test");
  const base = await startServer(t, client);
  const pid = await createPortfolioFor(base, userId, { name: "Core", base_currency: "USD" });

  await Promise.all([
    addHolding(base, userId, pid, {
      subject_ref: { kind: "instrument", id: APPLE_INSTRUMENT },
      quantity: 100,
      opened_at: "2025-01-15T00:00:00.000Z",
    }),
    addHolding(base, userId, pid, {
      subject_ref: { kind: "instrument", id: MSFT_INSTRUMENT },
      quantity: 50,
      opened_at: "2025-01-15T00:00:00.000Z",
      closed_at: "2025-12-31T00:00:00.000Z",
    }),
  ]);

  const res = await fetch(
    `${base}/v1/portfolios/overlays`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject_refs: [
          { kind: "instrument", id: APPLE_INSTRUMENT },
          { kind: "instrument", id: MSFT_INSTRUMENT },
        ],
      }),
    }),
  );
  const body = (await res.json()) as OverlayResponse;
  const apple = body.overlays.find((o) => o.subject_ref.id === APPLE_INSTRUMENT);
  const msft = body.overlays.find((o) => o.subject_ref.id === MSFT_INSTRUMENT);
  assert.equal(apple!.contributions[0].held_state, "open");
  assert.equal(apple!.contributions[0].closed_at, null);
  assert.equal(msft!.contributions[0].held_state, "closed");
  assert.ok(msft!.contributions[0].closed_at);
});

test("overlays: POST rejects every non-instrument/listing subject_kind with 400", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-3");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "overlay-bad-kind@example.test");
  const base = await startServer(t, client);

  for (const badKind of ["theme", "macro_topic", "portfolio", "screen", "issuer"] as const) {
    const res = await fetch(
      `${base}/v1/portfolios/overlays`,
      withUser(userId, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject_refs: [{ kind: badKind, id: APPLE_INSTRUMENT }],
        }),
      }),
    );
    assert.equal(res.status, 400, `expected 400 for kind=${badKind}`);
  }
});

test("overlays: POST rejects empty subject_refs with 400", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-3");
  const client = await connectedClient(t, databaseUrl);
  const userId = await seedUser(client, "overlay-empty-input@example.test");
  const base = await startServer(t, client);

  const res = await fetch(
    `${base}/v1/portfolios/overlays`,
    withUser(userId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject_refs: [] }),
    }),
  );
  assert.equal(res.status, 400);
});

test("overlays: POST without x-user-id returns 401", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for portfolio coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fra-cw0-9-3");
  const client = await connectedClient(t, databaseUrl);
  const base = await startServer(t, client);

  const res = await fetch(`${base}/v1/portfolios/overlays`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subject_refs: [{ kind: "instrument", id: APPLE_INSTRUMENT }],
    }),
  });
  assert.equal(res.status, 401);
});
