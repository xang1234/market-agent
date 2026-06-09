import test from "node:test";
import assert from "node:assert/strict";
import type { QueryResult } from "pg";

import { createUniverseResolverDeps } from "../src/universe-wiring.ts";
import { GridValidationError } from "../src/types.ts";
import type { QueryExecutor } from "../src/types.ts";

const USER_ID = "11111111-1111-4111-a111-111111111111";

function fakeDb(responder: (text: string) => unknown[]): QueryExecutor {
  return {
    async query<R extends Record<string, unknown>>(text: string) {
      const rows = responder(text) as R[];
      return { rows, rowCount: rows.length, command: "", oid: 0, fields: [] } satisfies QueryResult<R>;
    },
  };
}

const WATCHLIST_MEMBER = {
  subject_kind: "issuer",
  subject_id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  created_at: "2026-06-09T00:00:00.000Z",
};
const HOLDING = {
  portfolio_holding_id: "h1",
  portfolio_id: "p1",
  subject_kind: "instrument",
  subject_id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
  quantity: 1,
  cost_basis: null,
  opened_at: null,
  closed_at: null,
  created_at: "x",
  updated_at: "x",
};
const PORTFOLIO = {
  portfolio_id: "p1",
  user_id: USER_ID,
  name: "p",
  base_currency: "USD",
  created_at: "x",
  updated_at: "x",
};
const WATCHLIST = {
  watchlist_id: "w1",
  user_id: USER_ID,
  name: "wl",
  mode: "manual",
  is_default: false,
  membership_spec: null,
  created_at: "x",
  updated_at: "x",
};

test("resolveWatchlist reads watchlist_members as subject refs when the user owns the list", async () => {
  const db = fakeDb((text) =>
    text.includes("watchlist_members")
      ? [WATCHLIST_MEMBER]
      : text.includes("from watchlists") // getWatchlist ownership check
        ? [WATCHLIST]
        : [],
  );
  const deps = createUniverseResolverDeps(db);
  const refs = await deps.resolveWatchlist(USER_ID, "w1");
  assert.equal(refs[0].kind, "issuer");
});

test("resolveWatchlist rejects a watchlist the user does not own", async () => {
  // getWatchlist finds no owned row -> denied as GridValidationError before reading members.
  const db = fakeDb((text) => (text.includes("watchlist_members") ? [WATCHLIST_MEMBER] : []));
  const deps = createUniverseResolverDeps(db);
  await assert.rejects(() => deps.resolveWatchlist(USER_ID, "w-other"), GridValidationError);
});

test("resolvePortfolio maps holdings to subject refs when the user owns the portfolio", async () => {
  const db = fakeDb((text) =>
    text.includes("portfolio_holdings")
      ? [HOLDING]
      : text.includes("from portfolios") // getPortfolio ownership check
        ? [PORTFOLIO]
        : [],
  );
  const deps = createUniverseResolverDeps(db);
  const refs = await deps.resolvePortfolio(USER_ID, "p1");
  assert.equal(refs[0].kind, "instrument");
});

test("resolvePortfolio rejects a portfolio the user does not own", async () => {
  // getPortfolio finds no owned row -> denied as GridValidationError before reading holdings.
  const db = fakeDb((text) => (text.includes("portfolio_holdings") ? [HOLDING] : []));
  const deps = createUniverseResolverDeps(db);
  await assert.rejects(() => deps.resolvePortfolio(USER_ID, "p-other"), GridValidationError);
});
