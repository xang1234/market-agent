import test from "node:test";
import assert from "node:assert/strict";

import { fetchUniverseOptions } from "./universeOptions.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function routerFetch(overrides: Partial<Record<"watchlists" | "portfolios" | "screens", Response>> = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/v1/watchlists")) {
      return overrides.watchlists ?? json({ watchlists: [{ watchlist_id: "w1", name: "Tech names" }] });
    }
    if (url.includes("/v1/portfolios")) {
      return overrides.portfolios ?? json({ portfolios: [{ portfolio_id: "p1", name: "Main book" }] });
    }
    if (url.includes("/v1/screener/screens")) {
      return overrides.screens ?? json({ screens: [{ screen_id: "s1", name: "Value screen" }] });
    }
    return json({ error: "not found" }, 404);
  }) as typeof fetch;
}

test("fetchUniverseOptions maps the three list endpoints to {id, label} options", async () => {
  const options = await fetchUniverseOptions({ userId: USER_ID, fetchImpl: routerFetch() });
  assert.deepEqual(options, {
    watchlist: [{ id: "w1", label: "Tech names" }],
    portfolio: [{ id: "p1", label: "Main book" }],
    screen: [{ id: "s1", label: "Value screen" }],
  });
});

test("a failing source yields an empty list without sinking the others", async () => {
  const options = await fetchUniverseOptions({
    userId: USER_ID,
    fetchImpl: routerFetch({ portfolios: json({ error: "boom" }, 500) }),
  });
  assert.deepEqual(options.portfolio, []);
  assert.deepEqual(options.watchlist, [{ id: "w1", label: "Tech names" }]);
  assert.deepEqual(options.screen, [{ id: "s1", label: "Value screen" }]);
});
