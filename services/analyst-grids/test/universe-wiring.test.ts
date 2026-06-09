import test from "node:test";
import assert from "node:assert/strict";
import type { QueryResult } from "pg";

import { createUniverseResolverDeps } from "../src/universe-wiring.ts";
import type { QueryExecutor } from "../src/types.ts";

const USER_ID = "11111111-1111-4111-a111-111111111111";

function fakeDb(responder: (text: string) => unknown[]): QueryExecutor {
  return {
    async query<R extends Record<string, unknown>>(text: string) {
      return { rows: responder(text) as R[], rowCount: 0, command: "", oid: 0, fields: [] } satisfies QueryResult<R>;
    },
  };
}

test("resolveWatchlist reads watchlist_members as subject refs", async () => {
  const db = fakeDb((text) =>
    text.includes("watchlist_members")
      ? [{ subject_kind: "issuer", subject_id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", created_at: "2026-06-09T00:00:00.000Z" }]
      : [],
  );
  const deps = createUniverseResolverDeps(db);
  const refs = await deps.resolveWatchlist(USER_ID, "w1");
  assert.equal(refs[0].kind, "issuer");
});

test("resolvePortfolio maps holdings to subject refs", async () => {
  const db = fakeDb((text) =>
    text.includes("portfolio_holdings")
      ? [{ portfolio_holding_id: "h1", portfolio_id: "p1", subject_kind: "instrument", subject_id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", quantity: 1, cost_basis: null, opened_at: null, closed_at: null, created_at: "x", updated_at: "x" }]
      : [],
  );
  const deps = createUniverseResolverDeps(db);
  const refs = await deps.resolvePortfolio(USER_ID, "p1");
  assert.equal(refs[0].kind, "instrument");
});
