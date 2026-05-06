import assert from "node:assert/strict";
import test from "node:test";

import type { QueryExecutor } from "../src/types.ts";
import type { HomeQuoteProvider } from "../src/secondary-types.ts";
import {
  DEFAULT_HOME_WATCHLIST_MOVERS_LIMIT,
  MAX_HOME_WATCHLIST_MOVERS_LIMIT,
  getHomeWatchlistMovers,
} from "../src/watchlist-movers.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SOURCE_ID = "22222222-2222-4222-a222-222222222222";
const LISTING_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const LISTING_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const LISTING_C = "cccccccc-cccc-4ccc-accc-cccccccccccc";
const LISTING_D = "dddddddd-dddd-4ddd-bddd-dddddddddddd";

type Row = Record<string, unknown>;

// The production query uses a CTE that returns:
//   - `has_watchlist=false` sentinel rows when the user has no manual watchlist;
//   - `has_watchlist=true` rows (one per listing member, or a single null-id row
//     when there are no listing members).
function fakeDb(opts: {
  hasWatchlist: boolean;
  listingIds?: ReadonlyArray<string>;
}): { db: QueryExecutor; calls: { text: string; values?: unknown[] }[] } {
  const calls: { text: string; values?: unknown[] }[] = [];
  return {
    calls,
    db: {
      async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
        calls.push({ text, values });
        let rows: Row[];
        if (!opts.hasWatchlist) {
          rows = [{ subject_id: null, has_watchlist: false }];
        } else if (!opts.listingIds || opts.listingIds.length === 0) {
          rows = [{ subject_id: null, has_watchlist: true }];
        } else {
          rows = opts.listingIds.map((id) => ({ subject_id: id, has_watchlist: true }));
        }
        return {
          rows: rows as R[],
          command: "SELECT",
          rowCount: rows.length,
          oid: 0,
          fields: [],
        };
      },
    },
  };
}

function quote(id: string, price: number, prev: number) {
  return Object.freeze({
    quote: Object.freeze({
      listing: { kind: "listing" as const, id },
      price,
      prev_close: prev,
      change_abs: price - prev,
      change_pct: (price - prev) / prev,
      session_state: "regular" as const,
      as_of: "2026-05-05T15:30:00.000Z",
      delay_class: "delayed_15m" as const,
      currency: "USD",
      source_id: SOURCE_ID,
    }),
    listing_context: Object.freeze({
      ticker: `T-${id.slice(0, 4)}`,
      mic: "XNAS",
      timezone: "America/New_York",
    }),
  });
}

function provider(rows: ReadonlyArray<ReturnType<typeof quote>>): HomeQuoteProvider {
  return async () => rows;
}

test("getHomeWatchlistMovers reports no_default_watchlist when the user has none", async () => {
  const { db } = fakeDb({ hasWatchlist: false });
  const result = await getHomeWatchlistMovers(db, {
    user_id: USER_ID,
    quoteProvider: provider([]),
  });
  assert.equal(result.reason, "no_default_watchlist");
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.omitted, []);
});

test("getHomeWatchlistMovers reports empty_watchlist when the list has no listing members", async () => {
  const { db } = fakeDb({ hasWatchlist: true, listingIds: [] });
  const result = await getHomeWatchlistMovers(db, {
    user_id: USER_ID,
    quoteProvider: provider([]),
  });
  assert.equal(result.reason, "empty_watchlist");
  assert.deepEqual(result.rows, []);
});

test("getHomeWatchlistMovers issues a single round-trip query that filters to listing-kind members", async () => {
  const { db, calls } = fakeDb({ hasWatchlist: true, listingIds: [LISTING_A] });
  await getHomeWatchlistMovers(db, {
    user_id: USER_ID,
    quoteProvider: provider([quote(LISTING_A, 110, 100)]),
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /is_default/i);
  assert.match(calls[0].text, /watchlist_members/i);
  assert.match(calls[0].text, /subject_kind = 'listing'/i);
});

test("getHomeWatchlistMovers sorts by abs(change_pct) desc and keeps signed deltas", async () => {
  const { db } = fakeDb({ hasWatchlist: true, listingIds: [LISTING_A, LISTING_B, LISTING_C] });
  const result = await getHomeWatchlistMovers(db, {
    user_id: USER_ID,
    quoteProvider: provider([
      quote(LISTING_A, 102, 100), //  +2%
      quote(LISTING_B, 95, 100), //   -5%
      quote(LISTING_C, 103, 100), //  +3%
    ]),
  });
  assert.deepEqual(
    result.rows.map((r) => r.listing.id),
    [LISTING_B, LISTING_C, LISTING_A],
  );
  assert.ok(result.rows[0].change_pct < 0);
  assert.ok(result.rows[1].change_pct > 0);
});

test("getHomeWatchlistMovers ties at equal magnitude prefer the positive mover", async () => {
  const { db } = fakeDb({ hasWatchlist: true, listingIds: [LISTING_A, LISTING_B] });
  const result = await getHomeWatchlistMovers(db, {
    user_id: USER_ID,
    quoteProvider: provider([
      quote(LISTING_A, 95, 100), //  -5%
      quote(LISTING_B, 105, 100), // +5%
    ]),
  });
  assert.equal(result.rows[0].listing.id, LISTING_B);
  assert.equal(result.rows[1].listing.id, LISTING_A);
});

test("getHomeWatchlistMovers truncates to limit and clamps the upper bound", async () => {
  const ids = [LISTING_A, LISTING_B, LISTING_C, LISTING_D];
  const { db } = fakeDb({ hasWatchlist: true, listingIds: ids });

  const result = await getHomeWatchlistMovers(db, {
    user_id: USER_ID,
    quoteProvider: provider([
      quote(LISTING_A, 101, 100),
      quote(LISTING_B, 102, 100),
      quote(LISTING_C, 103, 100),
      quote(LISTING_D, 104, 100),
    ]),
    limit: 2,
  });
  assert.equal(result.rows.length, 2);

  await assert.rejects(
    getHomeWatchlistMovers(db, {
      user_id: USER_ID,
      quoteProvider: provider([]),
      limit: 0,
    }),
    /limit/i,
  );
  await assert.rejects(
    getHomeWatchlistMovers(db, {
      user_id: USER_ID,
      quoteProvider: provider([]),
      limit: 1.5,
    }),
    /limit/i,
  );
  assert.equal(MAX_HOME_WATCHLIST_MOVERS_LIMIT, 20);
  assert.equal(DEFAULT_HOME_WATCHLIST_MOVERS_LIMIT, 5);
});

test("getHomeWatchlistMovers reports unpriced listings in omitted", async () => {
  const { db } = fakeDb({ hasWatchlist: true, listingIds: [LISTING_A, LISTING_B] });
  const result = await getHomeWatchlistMovers(db, {
    user_id: USER_ID,
    quoteProvider: provider([quote(LISTING_A, 105, 100)]),
  });
  assert.deepEqual(result.rows.map((r) => r.listing.id), [LISTING_A]);
  assert.deepEqual(result.omitted.map((o) => o.listing.id), [LISTING_B]);
  assert.equal(result.omitted[0].reason, "no_quote");
});

test("getHomeWatchlistMovers rejects malformed user_id", async () => {
  const { db } = fakeDb({ hasWatchlist: false });
  await assert.rejects(
    getHomeWatchlistMovers(db, {
      user_id: "not-a-uuid",
      quoteProvider: provider([]),
    }),
    /user_id/i,
  );
});
