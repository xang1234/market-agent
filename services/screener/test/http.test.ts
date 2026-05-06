import test from "node:test";
import assert from "node:assert/strict";
import { type AddressInfo } from "node:net";
import { createInMemoryCandidateRepository } from "../src/candidate.ts";
import { DEV_SCREENER_CANDIDATES } from "../src/dev-candidates.ts";
import { createScreenerServer, type ScreenerServerDeps } from "../src/http.ts";
import { createInMemoryScreenRepository } from "../src/screen-repository.ts";
import type { ScreenerQuery } from "../src/query.ts";
import type { ScreenerResponse } from "../src/result.ts";
import type { ScreenSubject } from "../src/screen-subject.ts";
import { signTrustedUserId } from "../../shared/src/request-auth.ts";

const FIXED_NOW = new Date("2026-04-22T15:30:00.000Z");
const USER_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const TRUSTED_PROXY_SECRET = "screener-test-secret";
const TRUSTED_PROXY_NOW = new Date("2026-05-06T00:00:00.000Z");

function withUser(userId = USER_A): HeadersInit {
  return { "x-user-id": userId };
}

async function withServer<T>(
  overrides: Partial<ScreenerServerDeps> = {},
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const deps: ScreenerServerDeps = {
    candidates:
      overrides.candidates ??
      createInMemoryCandidateRepository(DEV_SCREENER_CANDIDATES),
    screens: overrides.screens ?? createInMemoryScreenRepository(),
    clock: overrides.clock ?? (() => FIXED_NOW),
    auth: overrides.auth,
  };
  const server = createScreenerServer(deps);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function baseQuery(overrides: Partial<ScreenerQuery> = {}): ScreenerQuery {
  return {
    universe: [],
    market: [],
    fundamentals: [],
    sort: [{ field: "market_cap", direction: "desc" }],
    page: { limit: 50 },
    ...overrides,
  };
}

test("GET /healthz returns 200 with service identity", async () => {
  await withServer({}, async (baseUrl) => {
    const r = await fetch(`${baseUrl}/healthz`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { status: "ok", service: "screener" });
  });
});

test("POST /v1/screener/search runs a valid query and returns a typed response", async () => {
  await withServer({}, async (baseUrl) => {
    const r = await fetch(`${baseUrl}/v1/screener/search`, {
      method: "POST",
      headers: { ...withUser(), "content-type": "application/json" },
      body: JSON.stringify(baseQuery()),
    });
    assert.equal(r.status, 200);
    const body = (await r.json()) as ScreenerResponse;
    assert.equal(body.total_count, 5);
    assert.equal(body.rows.length, 5);
    // Ranked desc by market_cap: MSFT(3.08T) > AAPL(2.98T) > NVDA(2.28T) > GOOGL(2.21T) > TSLA(0.79T)
    assert.deepEqual(
      body.rows.map((row) => row.display.ticker),
      ["MSFT", "AAPL", "NVDA", "GOOGL", "TSLA"],
    );
    assert.equal(body.as_of, FIXED_NOW.toISOString());
  });
});

test("POST /v1/screener/search rejects an unknown screener field with structured 400", async () => {
  await withServer({}, async (baseUrl) => {
    const r = await fetch(`${baseUrl}/v1/screener/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...baseQuery(),
        market: [{ field: "polygon.lastTrade.p", min: 5 }],
      }),
    });
    assert.equal(r.status, 400);
    const body = (await r.json()) as { error: string };
    assert.match(body.error, /unknown screener field/);
  });
});

test("POST /v1/screener/search rejects an empty body", async () => {
  await withServer({}, async (baseUrl) => {
    const r = await fetch(`${baseUrl}/v1/screener/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    assert.equal(r.status, 400);
    assert.match((await r.json() as { error: string }).error, /body is empty/);
  });
});

test("POST /v1/screener/search rejects non-JSON content-type", async () => {
  await withServer({}, async (baseUrl) => {
    const r = await fetch(`${baseUrl}/v1/screener/search`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "hello",
    });
    assert.equal(r.status, 415);
  });
});

test("POST /v1/screener/screens creates a saved screen and returns 201 with server-generated id", async () => {
  await withServer({}, async (baseUrl) => {
    const r = await fetch(`${baseUrl}/v1/screener/screens`, {
      method: "POST",
      headers: { ...withUser(), "content-type": "application/json" },
      body: JSON.stringify({ name: "Large-cap tech", definition: baseQuery() }),
    });
    assert.equal(r.status, 201);
    const body = (await r.json()) as { status: string; screen: ScreenSubject };
    assert.equal(body.status, "created");
    assert.equal(body.screen.name, "Large-cap tech");
    assert.equal(body.screen.user_id, USER_A);
    assert.match(body.screen.screen_id, /^[0-9a-f-]{36}$/);
    assert.equal(body.screen.created_at, FIXED_NOW.toISOString());
    assert.equal(body.screen.updated_at, FIXED_NOW.toISOString());
  });
});

test("trusted-proxy auth stamps saved screens from server-derived identity, not x-user-id", async () => {
  await withServer({
    auth: { mode: "trusted_proxy", trustedProxySecret: TRUSTED_PROXY_SECRET },
  }, async (baseUrl) => {
    const r = await fetch(`${baseUrl}/v1/screener/screens`, {
      method: "POST",
      headers: {
        "x-authenticated-user-id": USER_A,
        "x-authenticated-user-signature": signTrustedUserId(USER_A, TRUSTED_PROXY_SECRET),
        "x-user-id": USER_B,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Trusted screen", definition: baseQuery() }),
    });

    assert.equal(r.status, 201);
    const body = (await r.json()) as { screen: ScreenSubject };
    assert.equal(body.screen.user_id, USER_A);
  });
});

test("trusted-proxy auth rejects expired and tampered signatures at the endpoint", async () => {
  await withServer({
    auth: {
      mode: "trusted_proxy",
      trustedProxySecret: TRUSTED_PROXY_SECRET,
      trustedProxyClock: () => TRUSTED_PROXY_NOW,
    },
  }, async (baseUrl) => {
    const fresh = signTrustedUserId(USER_A, TRUSTED_PROXY_SECRET, { issuedAt: TRUSTED_PROXY_NOW });
    const tamperedTimestamp = fresh.replace(":1778025600000:", ":1778022000000:");
    const expired = signTrustedUserId(USER_A, TRUSTED_PROXY_SECRET, {
      issuedAt: new Date("2026-05-05T23:54:00.000Z"),
    });

    for (const signature of [tamperedTimestamp, expired]) {
      const r = await fetch(`${baseUrl}/v1/screener/screens`, {
        method: "POST",
        headers: {
          "x-authenticated-user-id": USER_A,
          "x-authenticated-user-signature": signature,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Rejected screen", definition: baseQuery() }),
      });
      assert.equal(r.status, 401);
    }
  });
});

test("POST /v1/screener/screens rejects an invalid query definition with 400", async () => {
  await withServer({}, async (baseUrl) => {
    const r = await fetch(`${baseUrl}/v1/screener/screens`, {
      method: "POST",
      headers: { ...withUser(), "content-type": "application/json" },
      body: JSON.stringify({
        name: "broken",
        definition: { ...baseQuery(), sort: [] },
      }),
    });
    assert.equal(r.status, 400);
    assert.match(
      (await r.json() as { error: string }).error,
      /sort/,
    );
  });
});

test("POST /v1/screener/screens with the same screen_id replaces and returns 200", async () => {
  await withServer({}, async (baseUrl) => {
    const first = await fetch(`${baseUrl}/v1/screener/screens`, {
      method: "POST",
      headers: { ...withUser(), "content-type": "application/json" },
      body: JSON.stringify({ name: "v1", definition: baseQuery() }),
    });
    const created = (await first.json()) as { screen: ScreenSubject };
    const screen_id = created.screen.screen_id;

    const second = await fetch(`${baseUrl}/v1/screener/screens`, {
      method: "POST",
      headers: { ...withUser(), "content-type": "application/json" },
      body: JSON.stringify({
        screen_id,
        name: "v2",
        definition: baseQuery(),
        created_at: created.screen.created_at,
      }),
    });
    assert.equal(second.status, 200);
    const body = (await second.json()) as { status: string; screen: ScreenSubject };
    assert.equal(body.status, "replaced");
    assert.equal(body.screen.name, "v2");
  });
});

test("POST /v1/screener/screens replace preserves original created_at even when client omits it", async () => {
  // Server is authoritative for created_at — a PUT-shaped replace body
  // without timestamps must NOT rewrite the screen's birth time. The
  // updated_at clock advances; created_at stays.
  let now = new Date("2026-04-22T15:30:00.000Z");
  const clock = () => now;

  await withServer({ clock }, async (baseUrl) => {
    const created = (await (
      await fetch(`${baseUrl}/v1/screener/screens`, {
        method: "POST",
        headers: { ...withUser(), "content-type": "application/json" },
        body: JSON.stringify({ name: "v1", definition: baseQuery() }),
      })
    ).json()) as { screen: ScreenSubject };
    const original_created_at = created.screen.created_at;

    now = new Date("2026-05-01T10:00:00.000Z");
    const replaced = (await (
      await fetch(`${baseUrl}/v1/screener/screens`, {
        method: "POST",
        headers: { ...withUser(), "content-type": "application/json" },
        // Deliberately omit created_at — the server must look up the
        // existing record and preserve it rather than defaulting to now.
        body: JSON.stringify({
          screen_id: created.screen.screen_id,
          name: "v2",
          definition: baseQuery(),
        }),
      })
    ).json()) as { status: string; screen: ScreenSubject };

    assert.equal(replaced.status, "replaced");
    assert.equal(replaced.screen.created_at, original_created_at);
    assert.equal(replaced.screen.updated_at, "2026-05-01T10:00:00.000Z");
  });
});

test("GET /v1/screener/screens lists saved screens", async () => {
  await withServer({}, async (baseUrl) => {
    await fetch(`${baseUrl}/v1/screener/screens`, {
      method: "POST",
      headers: { ...withUser(), "content-type": "application/json" },
      body: JSON.stringify({ name: "first", definition: baseQuery() }),
    });
    await fetch(`${baseUrl}/v1/screener/screens`, {
      method: "POST",
      headers: { ...withUser(), "content-type": "application/json" },
      body: JSON.stringify({ name: "second", definition: baseQuery() }),
    });
    const r = await fetch(`${baseUrl}/v1/screener/screens`, { headers: withUser() });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { screens: ScreenSubject[] };
    assert.equal(body.screens.length, 2);
  });
});

test("GET /v1/screener/screens lists only the requesting user's saved screens", async () => {
  await withServer({}, async (baseUrl) => {
    await fetch(`${baseUrl}/v1/screener/screens`, {
      method: "POST",
      headers: { ...withUser(USER_A), "content-type": "application/json" },
      body: JSON.stringify({ name: "alice", definition: baseQuery() }),
    });
    await fetch(`${baseUrl}/v1/screener/screens`, {
      method: "POST",
      headers: { ...withUser(USER_B), "content-type": "application/json" },
      body: JSON.stringify({ name: "bob", definition: baseQuery() }),
    });

    const r = await fetch(`${baseUrl}/v1/screener/screens`, {
      headers: withUser(USER_A),
    });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { screens: ScreenSubject[] };
    assert.deepEqual(body.screens.map((screen) => screen.name), ["alice"]);
  });
});

test("GET /v1/screener/screens/:id returns 404 for unknown id", async () => {
  await withServer({}, async (baseUrl) => {
    const r = await fetch(
      `${baseUrl}/v1/screener/screens/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa`,
      { headers: withUser() },
    );
    assert.equal(r.status, 404);
  });
});

test("GET /v1/screener/screens/:id with malformed id returns 404 (no route match)", async () => {
  await withServer({}, async (baseUrl) => {
    const r = await fetch(`${baseUrl}/v1/screener/screens/not-a-uuid`);
    assert.equal(r.status, 404);
  });
});

test("DELETE /v1/screener/screens/:id removes the screen and returns 204", async () => {
  await withServer({}, async (baseUrl) => {
    const created = (await (
      await fetch(`${baseUrl}/v1/screener/screens`, {
        method: "POST",
        headers: { ...withUser(), "content-type": "application/json" },
        body: JSON.stringify({ name: "doomed", definition: baseQuery() }),
      })
    ).json()) as { screen: ScreenSubject };

    const del = await fetch(
      `${baseUrl}/v1/screener/screens/${created.screen.screen_id}`,
      { method: "DELETE", headers: withUser() },
    );
    assert.equal(del.status, 204);

    // Subsequent GET → 404.
    const get = await fetch(
      `${baseUrl}/v1/screener/screens/${created.screen.screen_id}`,
      { headers: withUser() },
    );
    assert.equal(get.status, 404);

    // Second DELETE → 404 (idempotent path returns not-found rather than
    // a confusing 204 on a no-op).
    const del2 = await fetch(
      `${baseUrl}/v1/screener/screens/${created.screen.screen_id}`,
      { method: "DELETE", headers: withUser() },
    );
    assert.equal(del2.status, 404);
  });
});

test("saved-screen detail, replay, delete, and replace are scoped to the requesting user", async () => {
  await withServer({}, async (baseUrl) => {
    const created = (await (
      await fetch(`${baseUrl}/v1/screener/screens`, {
        method: "POST",
        headers: { ...withUser(USER_A), "content-type": "application/json" },
        body: JSON.stringify({ name: "alice private", definition: baseQuery() }),
      })
    ).json()) as { screen: ScreenSubject };
    const screenUrl = `${baseUrl}/v1/screener/screens/${created.screen.screen_id}`;

    const bobGet = await fetch(screenUrl, { headers: withUser(USER_B) });
    assert.equal(bobGet.status, 404);

    const bobReplay = await fetch(`${screenUrl}/replay`, {
      method: "POST",
      headers: withUser(USER_B),
    });
    assert.equal(bobReplay.status, 404);

    const bobDelete = await fetch(screenUrl, {
      method: "DELETE",
      headers: withUser(USER_B),
    });
    assert.equal(bobDelete.status, 404);

    const bobReplace = await fetch(`${baseUrl}/v1/screener/screens`, {
      method: "POST",
      headers: { ...withUser(USER_B), "content-type": "application/json" },
      body: JSON.stringify({
        screen_id: created.screen.screen_id,
        name: "bob takeover",
        definition: baseQuery(),
      }),
    });
    assert.equal(bobReplace.status, 404);

    const aliceGet = await fetch(screenUrl, { headers: withUser(USER_A) });
    assert.equal(aliceGet.status, 200);
    const body = (await aliceGet.json()) as { screen: ScreenSubject };
    assert.equal(body.screen.name, "alice private");
    assert.equal(body.screen.user_id, USER_A);
  });
});

test("POST /v1/screener/screens/:id/replay yields fresh execution (verification target)", async () => {
  // The save → reopen → execute round-trip is the bead's verification
  // target: a saved screen, replayed, must produce rows from current
  // service data (different `as_of`), not stored rows from save time.
  let now = new Date("2026-04-22T15:30:00.000Z");
  const clock = () => now;

  await withServer({ clock }, async (baseUrl) => {
    const created = (await (
      await fetch(`${baseUrl}/v1/screener/screens`, {
        method: "POST",
        headers: { ...withUser(), "content-type": "application/json" },
        body: JSON.stringify({ name: "replayable", definition: baseQuery() }),
      })
    ).json()) as { screen: ScreenSubject };

    const firstReplay = (await (
      await fetch(
        `${baseUrl}/v1/screener/screens/${created.screen.screen_id}/replay`,
        { method: "POST", headers: withUser() },
      )
    ).json()) as ScreenerResponse;
    assert.equal(firstReplay.as_of, "2026-04-22T15:30:00.000Z");

    // Advance the clock; replay again. Same query, same rows (fixture
    // candidates haven't moved), but `as_of` reflects the new replay
    // moment — proof that replay re-runs through the executor instead
    // of caching the first response.
    now = new Date("2026-04-30T10:00:00.000Z");
    const secondReplay = (await (
      await fetch(
        `${baseUrl}/v1/screener/screens/${created.screen.screen_id}/replay`,
        { method: "POST", headers: withUser() },
      )
    ).json()) as ScreenerResponse;
    assert.equal(secondReplay.as_of, "2026-04-30T10:00:00.000Z");

    assert.notEqual(firstReplay.as_of, secondReplay.as_of);
    assert.deepEqual(
      firstReplay.rows.map((r) => r.subject_ref.id),
      secondReplay.rows.map((r) => r.subject_ref.id),
    );
  });
});

test("POST /v1/screener/screens/:id/replay returns 404 for an unknown screen", async () => {
  await withServer({}, async (baseUrl) => {
    const r = await fetch(
      `${baseUrl}/v1/screener/screens/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/replay`,
      { method: "POST", headers: withUser() },
    );
    assert.equal(r.status, 404);
  });
});

test("unknown methods on /v1/screener/screens/:id paths return 404 (no method dispatch)", async () => {
  await withServer({}, async (baseUrl) => {
    const r = await fetch(
      `${baseUrl}/v1/screener/screens/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa`,
      { method: "PATCH" },
    );
    assert.equal(r.status, 404);
  });
});

test("GET on POST-only routes returns 404", async () => {
  await withServer({}, async (baseUrl) => {
    const r = await fetch(`${baseUrl}/v1/screener/search`);
    assert.equal(r.status, 404);
  });
});
