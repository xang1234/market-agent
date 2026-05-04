import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveDynamicWatchlistMembers,
  type DynamicWatchlistDeps,
} from "../src/dynamic-membership.ts";
import type { QueryExecutor } from "../src/queries.ts";

type QueryCall = {
  text: string;
  values: ReadonlyArray<unknown>;
};

class FakeDb implements QueryExecutor {
  readonly calls: QueryCall[] = [];

  watchlists = new Map<string, Record<string, unknown>>();
  manualMembers = new Map<string, ReadonlyArray<Record<string, unknown>>>();
  themeMembers = new Map<string, ReadonlyArray<Record<string, unknown>>>();
  portfolioHoldings = new Map<string, ReadonlyArray<Record<string, unknown>>>();

  async query<R>(
    text: string,
    values: ReadonlyArray<unknown> = [],
  ): Promise<{ rows: R[] }> {
    this.calls.push({ text, values });
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();

    if (normalized.startsWith("select") && normalized.includes("from watchlists")) {
      const watchlist = this.watchlists.get(String(values[0]));
      return { rows: watchlist ? [watchlist as R] : [] };
    }
    if (normalized.startsWith("select") && normalized.includes("from watchlist_members")) {
      return { rows: [...(this.manualMembers.get(String(values[0])) ?? [])] as R[] };
    }
    if (normalized.startsWith("select") && normalized.includes("from theme_memberships")) {
      const asOf = values[1] === undefined ? null : Date.parse(String(values[1]));
      const rows = [...(this.themeMembers.get(String(values[0])) ?? [])].filter((row) => {
        if (asOf === null) return true;
        const effectiveAt = Date.parse(String(row.effective_at));
        const expiresAt = row.expires_at === null || row.expires_at === undefined
          ? null
          : Date.parse(String(row.expires_at));
        return effectiveAt <= asOf && (expiresAt === null || expiresAt > asOf);
      });
      return { rows: rows as R[] };
    }
    if (normalized.startsWith("select") && normalized.includes("from portfolio_holdings")) {
      return { rows: [...(this.portfolioHoldings.get(String(values[0])) ?? [])] as R[] };
    }
    return { rows: [] };
  }

  writeCalls(): ReadonlyArray<QueryCall> {
    return this.calls.filter(({ text }) => /insert|update|delete/i.test(text));
  }
}

const USER_ID = "00000000-0000-4000-8000-000000000001";
const WATCHLIST_ID = "00000000-0000-4000-8000-000000000010";

test("screen watchlists replay the current screen definition on every resolve", async () => {
  const db = new FakeDb();
  db.watchlists.set(WATCHLIST_ID, {
    watchlist_id: WATCHLIST_ID,
    user_id: USER_ID,
    mode: "screen",
    membership_spec: { screen_id: "screen-growth" },
  });

  const screens = new Map<string, unknown>([
    ["screen-growth", { screen_id: "screen-growth", definition: { version: 1 } }],
  ]);
  const screenRows = new Map<number, ReadonlyArray<{ subject_ref: { kind: "instrument"; id: string } }>>([
    [1, [{ subject_ref: { kind: "instrument", id: "AAPL" } }]],
    [2, [{ subject_ref: { kind: "instrument", id: "MSFT" } }]],
  ]);
  const deps: DynamicWatchlistDeps = {
    db,
    screens: { find: async (screenId) => screens.get(screenId) },
    executeScreen: async (screen) => ({
      rows: screenRows.get((screen as { definition: { version: number } }).definition.version) ?? [],
    }),
    now: () => new Date("2026-05-04T00:00:00.000Z"),
  };

  const first = await resolveDynamicWatchlistMembers(deps, {
    user_id: USER_ID,
    watchlist_id: WATCHLIST_ID,
  });
  screens.set("screen-growth", { screen_id: "screen-growth", definition: { version: 2 } });
  const second = await resolveDynamicWatchlistMembers(deps, {
    user_id: USER_ID,
    watchlist_id: WATCHLIST_ID,
  });

  assert.deepEqual(first.members.map((member) => member.subject_ref.id), ["AAPL"]);
  assert.deepEqual(second.members.map((member) => member.subject_ref.id), ["MSFT"]);
  assert.equal(second.source.mode, "screen");
  assert.equal(second.source.id, "screen-growth");
  assert.equal(db.writeCalls().length, 0);
});

test("theme and portfolio watchlists mirror source rows with deterministic ordering", async () => {
  const db = new FakeDb();
  db.watchlists.set("theme-watchlist", {
    watchlist_id: "theme-watchlist",
    user_id: USER_ID,
    mode: "theme",
    membership_spec: { theme_id: "theme-ai" },
  });
  db.themeMembers.set("theme-ai", [
    {
      subject_ref: { kind: "instrument", id: "MSFT" },
      effective_at: "2026-01-01T00:00:00.000Z",
      expires_at: null,
    },
    {
      subject_ref: { kind: "issuer", id: "apple-inc" },
      effective_at: "2026-01-01T00:00:00.000Z",
      expires_at: null,
    },
  ]);
  db.watchlists.set("portfolio-watchlist", {
    watchlist_id: "portfolio-watchlist",
    user_id: USER_ID,
    mode: "portfolio",
    membership_spec: { portfolio_id: "portfolio-main" },
  });
  db.portfolioHoldings.set("portfolio-main", [
    { subject_ref: { kind: "listing", id: "NASDAQ:AAPL" } },
    { subject_ref: { kind: "instrument", id: "AAPL" } },
  ]);

  const deps: DynamicWatchlistDeps = {
    db,
    now: () => new Date("2026-05-04T00:00:00.000Z"),
  };

  const theme = await resolveDynamicWatchlistMembers(deps, {
    user_id: USER_ID,
    watchlist_id: "theme-watchlist",
  });
  const portfolio = await resolveDynamicWatchlistMembers(deps, {
    user_id: USER_ID,
    watchlist_id: "portfolio-watchlist",
  });

  assert.deepEqual(
    theme.members.map((member) => member.subject_ref),
    [
      { kind: "instrument", id: "MSFT" },
      { kind: "issuer", id: "apple-inc" },
    ],
  );
  assert.deepEqual(
    portfolio.members.map((member) => member.subject_ref),
    [
      { kind: "instrument", id: "AAPL" },
      { kind: "listing", id: "NASDAQ:AAPL" },
    ],
  );
});

test("theme watchlists exclude future and expired memberships as of resolver time", async () => {
  const db = new FakeDb();
  db.watchlists.set(WATCHLIST_ID, {
    watchlist_id: WATCHLIST_ID,
    user_id: USER_ID,
    mode: "theme",
    membership_spec: { theme_id: "theme-windowed" },
  });
  db.themeMembers.set("theme-windowed", [
    {
      subject_ref: { kind: "instrument", id: "ACTIVE" },
      effective_at: "2026-01-01T00:00:00.000Z",
      expires_at: null,
    },
    {
      subject_ref: { kind: "instrument", id: "FUTURE" },
      effective_at: "2026-06-01T00:00:00.000Z",
      expires_at: null,
    },
    {
      subject_ref: { kind: "instrument", id: "EXPIRED" },
      effective_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2026-04-01T00:00:00.000Z",
    },
  ]);

  const result = await resolveDynamicWatchlistMembers(
    {
      db,
      now: () => new Date("2026-05-04T00:00:00.000Z"),
    },
    {
      user_id: USER_ID,
      watchlist_id: WATCHLIST_ID,
    },
  );

  assert.deepEqual(result.members.map((member) => member.subject_ref.id), ["ACTIVE"]);
  const themeQuery = db.calls.find((call) => call.text.includes("from theme_memberships"));
  assert.equal(themeQuery?.values[1], "2026-05-04T00:00:00.000Z");
});

test("agent watchlists mirror static agent universes without collapsing provenance", async () => {
  const db = new FakeDb();
  db.watchlists.set(WATCHLIST_ID, {
    watchlist_id: WATCHLIST_ID,
    user_id: USER_ID,
    mode: "agent",
    membership_spec: { agent_id: "agent-alpha" },
  });
  const deps: DynamicWatchlistDeps = {
    db,
    agents: {
      get: async (agentId, userId) => ({
        agent_id: agentId,
        user_id: userId,
        universe: {
          mode: "static",
          subject_refs: [
            { kind: "instrument", id: "TSLA" },
            { kind: "instrument", id: "AAPL" },
          ],
        },
      }),
    },
  };

  const result = await resolveDynamicWatchlistMembers(deps, {
    user_id: USER_ID,
    watchlist_id: WATCHLIST_ID,
  });

  assert.deepEqual(
    result.members.map((member) => member.subject_ref.id),
    ["AAPL", "TSLA"],
  );
  assert.deepEqual(
    result.members.map((member) => member.source),
    [
      { mode: "agent", id: "agent-alpha" },
      { mode: "agent", id: "agent-alpha" },
    ],
  );
});

test("agent watchlists reject agent rows owned by another user", async () => {
  const db = new FakeDb();
  db.watchlists.set(WATCHLIST_ID, {
    watchlist_id: WATCHLIST_ID,
    user_id: USER_ID,
    mode: "agent",
    membership_spec: { agent_id: "agent-other-user" },
  });

  await assert.rejects(
    () => resolveDynamicWatchlistMembers(
      {
        db,
        agents: {
          get: async (agentId) => ({
            agent_id: agentId,
            user_id: "00000000-0000-4000-8000-000000000999",
            universe: {
              mode: "static",
              subject_refs: [{ kind: "instrument", id: "AAPL" }],
            },
          }),
        },
      },
      {
        user_id: USER_ID,
        watchlist_id: WATCHLIST_ID,
      },
    ),
    /does not belong to user/,
  );
});
