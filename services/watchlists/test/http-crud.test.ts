import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { QueryResult } from "pg";

import { createWatchlistsServer } from "../src/http.ts";
import type { QueryExecutor } from "../src/queries.ts";

const USER_ID = "11111111-1111-4111-a111-111111111111";
const DEFAULT_WATCHLIST_ID = "22222222-2222-4222-a222-222222222222";
const NAMED_WATCHLIST_ID = "33333333-3333-4333-a333-333333333333";
const CREATED_WATCHLIST_ID = "44444444-4444-4444-a444-444444444444";
const FIXED_NOW = "2026-05-06T00:00:00.000Z";

type WatchlistRecord = {
  watchlist_id: string;
  user_id: string;
  name: string;
  mode: "manual" | "screen" | "agent" | "theme" | "portfolio";
  is_default: boolean;
  membership_spec: unknown;
  created_at: string;
  updated_at: string;
};

class MemoryWatchlistsDb implements QueryExecutor {
  watchlists: WatchlistRecord[] = [
    watchlistRow({ watchlist_id: DEFAULT_WATCHLIST_ID, name: "Watchlist", is_default: true }),
    watchlistRow({ watchlist_id: NAMED_WATCHLIST_ID, name: "Earnings Watch" }),
  ];

  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<R>> {
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();

    if (normalized.startsWith("select") && normalized.includes("order by is_default desc")) {
      const userId = String(values[0]);
      return result(
        this.watchlists
          .filter((row) => row.user_id === userId)
          .sort((a, b) => Number(b.is_default) - Number(a.is_default)),
      );
    }

    if (normalized.startsWith("insert into watchlists")) {
      const row = watchlistRow({
        watchlist_id: CREATED_WATCHLIST_ID,
        user_id: String(values[0]),
        name: String(values[1]),
        mode: values[2] as WatchlistRecord["mode"],
        membership_spec: values[3] === null ? null : JSON.parse(String(values[3])),
        is_default: Boolean(values[4]),
      });
      this.watchlists.push(row);
      return result([row]);
    }

    if (normalized.startsWith("update watchlists")) {
      const [watchlistId, userId, name] = values.map(String);
      const row = this.watchlists.find(
        (item) => item.watchlist_id === watchlistId && item.user_id === userId,
      );
      if (!row) return result([]);
      row.name = name;
      row.updated_at = FIXED_NOW;
      return result([row]);
    }

    if (normalized.startsWith("select") && normalized.includes("where watchlist_id = $1 and user_id = $2")) {
      const [watchlistId, userId] = values.map(String);
      return result(
        this.watchlists.filter(
          (row) => row.watchlist_id === watchlistId && row.user_id === userId,
        ),
      );
    }

    if (normalized.startsWith("delete from watchlists")) {
      const [watchlistId, userId] = values.map(String);
      this.watchlists = this.watchlists.filter(
        (row) => !(row.watchlist_id === watchlistId && row.user_id === userId),
      );
      return result([]);
    }

    throw new Error(`unexpected SQL in HTTP CRUD test: ${text}`);
  }
}

function watchlistRow(overrides: Partial<WatchlistRecord> = {}): WatchlistRecord {
  return {
    watchlist_id: NAMED_WATCHLIST_ID,
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

function result<R extends Record<string, unknown>>(rows: R[]): QueryResult<R> {
  return {
    rows,
    rowCount: rows.length,
    command: "",
    oid: 0,
    fields: [],
  };
}

async function startServer(t: TestContext, db: QueryExecutor): Promise<string> {
  const server = createWatchlistsServer(db);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function withUser(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "x-user-id": USER_ID,
    },
  };
}

test("HTTP list-management CRUD handles named manual lists and protects the default", async (t) => {
  const db = new MemoryWatchlistsDb();
  const base = await startServer(t, db);

  const listA = await fetch(`${base}/v1/watchlists`, withUser());
  assert.equal(listA.status, 200);
  const listABody = (await listA.json()) as { watchlists: Array<{ watchlist_id: string; is_default: boolean }> };
  assert.deepEqual(
    listABody.watchlists.map((row) => row.watchlist_id),
    [DEFAULT_WATCHLIST_ID, NAMED_WATCHLIST_ID],
  );
  assert.equal(listABody.watchlists[0].is_default, true);

  const create = await fetch(
    `${base}/v1/watchlists`,
    withUser({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Semis", mode: "manual" }),
    }),
  );
  assert.equal(create.status, 201);
  const created = (await create.json()) as { watchlist_id: string; name: string; is_default: boolean };
  assert.equal(created.watchlist_id, CREATED_WATCHLIST_ID);
  assert.equal(created.name, "Semis");
  assert.equal(created.is_default, false);

  const rename = await fetch(
    `${base}/v1/watchlists/${CREATED_WATCHLIST_ID}`,
    withUser({
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Semis Core" }),
    }),
  );
  assert.equal(rename.status, 200);
  assert.equal(((await rename.json()) as { name: string }).name, "Semis Core");

  const deleteNamed = await fetch(
    `${base}/v1/watchlists/${CREATED_WATCHLIST_ID}`,
    withUser({ method: "DELETE" }),
  );
  assert.equal(deleteNamed.status, 204);

  const deleteDefault = await fetch(
    `${base}/v1/watchlists/${DEFAULT_WATCHLIST_ID}`,
    withUser({ method: "DELETE" }),
  );
  assert.equal(deleteDefault.status, 409);
});
