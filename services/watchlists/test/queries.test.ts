import test from "node:test";
import assert from "node:assert/strict";
import type { QueryResult } from "pg";

import {
  DefaultWatchlistDeleteError,
  WatchlistNotFoundError,
  WatchlistValidationError,
  createWatchlist,
  deleteWatchlist,
  listWatchlists,
  renameWatchlist,
  type QueryExecutor,
} from "../src/queries.ts";

const USER_ID = "11111111-1111-4111-a111-111111111111";
const WATCHLIST_ID = "22222222-2222-4222-a222-222222222222";
const DEFAULT_WATCHLIST_ID = "33333333-3333-4333-a333-333333333333";
const FIXED_NOW = "2026-05-06T00:00:00.000Z";

type Captured = { text: string; values?: unknown[] };

function fakeDb(
  responder: (text: string, values?: unknown[]) => unknown[],
): { db: QueryExecutor; queries: Captured[] } {
  const queries: Captured[] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<QueryResult<R>> {
      queries.push({ text, values });
      const rows = responder(text, values) as R[];
      return {
        rows,
        rowCount: rows.length,
        command: "",
        oid: 0,
        fields: [],
      };
    },
  };
  return { db, queries };
}

function watchlistRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    watchlist_id: WATCHLIST_ID,
    user_id: USER_ID,
    name: "Earnings Watch",
    mode: "manual",
    is_default: false,
    membership_spec: null,
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    ...overrides,
  };
}

test("listWatchlists returns all user-owned lists with the implicit default first", async () => {
  const { db, queries } = fakeDb(() => [
    watchlistRow({ watchlist_id: DEFAULT_WATCHLIST_ID, name: "Watchlist", is_default: true }),
    watchlistRow(),
  ]);

  const rows = await listWatchlists(db, USER_ID);

  assert.deepEqual(
    rows.map((row) => row.watchlist_id),
    [DEFAULT_WATCHLIST_ID, WATCHLIST_ID],
  );
  assert.equal(rows[0].is_default, true);
  assert.match(queries[0].text, /where user_id = \$1/);
  assert.match(queries[0].text, /order by is_default desc/i);
  assert.deepEqual(queries[0].values, [USER_ID]);
});

test("createWatchlist creates a named manual non-default list for the user", async () => {
  const { db, queries } = fakeDb(() => [watchlistRow({ name: "Semis", mode: "manual" })]);

  const row = await createWatchlist(db, USER_ID, {
    name: "Semis",
    mode: "manual",
  });

  assert.equal(row.name, "Semis");
  assert.equal(row.mode, "manual");
  assert.equal(row.is_default, false);
  assert.match(queries[0].text, /insert into watchlists/i);
  assert.equal(queries[0].values?.[0], USER_ID);
  assert.equal(queries[0].values?.[1], "Semis");
  assert.equal(queries[0].values?.[2], "manual");
  assert.equal(queries[0].values?.[4], false);
});

test("createWatchlist validates dynamic mode membership_spec before inserting", async () => {
  for (const [mode, key] of [
    ["screen", "screen_id"],
    ["agent", "agent_id"],
    ["theme", "theme_id"],
    ["portfolio", "portfolio_id"],
  ] as const) {
    const { db, queries } = fakeDb(() => []);
    await assert.rejects(
      createWatchlist(db, USER_ID, {
        name: `${mode} list`,
        mode,
        membership_spec: null,
      }),
      (err: Error) =>
        err instanceof WatchlistValidationError &&
        err.message === `membership_spec.${key}: must be a non-empty string`,
    );
    assert.equal(queries.length, 0);
  }
});

test("renameWatchlist scopes by user and returns the renamed row", async () => {
  const { db, queries } = fakeDb(() => [watchlistRow({ name: "Renamed" })]);

  const row = await renameWatchlist(db, USER_ID, WATCHLIST_ID, "Renamed");

  assert.equal(row.name, "Renamed");
  assert.match(queries[0].text, /where watchlist_id = \$1 and user_id = \$2/);
  assert.deepEqual(queries[0].values?.slice(0, 3), [WATCHLIST_ID, USER_ID, "Renamed"]);
});

test("deleteWatchlist deletes non-default lists and relies on member cascade", async () => {
  let call = 0;
  const { db, queries } = fakeDb(() => {
    call += 1;
    return call === 1 ? [watchlistRow()] : [];
  });

  await deleteWatchlist(db, USER_ID, WATCHLIST_ID);

  assert.equal(queries.length, 2);
  assert.match(queries[1].text, /delete from watchlists/i);
  assert.match(queries[1].text, /where watchlist_id = \$1 and user_id = \$2/);
  assert.deepEqual(queries[1].values, [WATCHLIST_ID, USER_ID]);
});

test("deleteWatchlist rejects the implicit default list with a typed error", async () => {
  const { db, queries } = fakeDb(() => [
    watchlistRow({ watchlist_id: DEFAULT_WATCHLIST_ID, is_default: true }),
  ]);

  await assert.rejects(
    deleteWatchlist(db, USER_ID, DEFAULT_WATCHLIST_ID),
    (err: Error) => err instanceof DefaultWatchlistDeleteError,
  );
  assert.equal(queries.length, 1, "default delete must fail before delete SQL");
});

test("renameWatchlist and deleteWatchlist report missing user-owned rows", async () => {
  const { db } = fakeDb(() => []);

  await assert.rejects(
    renameWatchlist(db, USER_ID, WATCHLIST_ID, "Nope"),
    (err: Error) => err instanceof WatchlistNotFoundError,
  );
  await assert.rejects(
    deleteWatchlist(db, USER_ID, WATCHLIST_ID),
    (err: Error) => err instanceof WatchlistNotFoundError,
  );
});
