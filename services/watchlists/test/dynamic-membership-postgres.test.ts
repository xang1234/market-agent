import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { Client } from "pg";

import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { resolveDynamicWatchlistMembers, type DynamicWatchlistDeps } from "../src/dynamic-membership.ts";
import type { QueryExecutor } from "../src/queries.ts";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const ISSUER_A = { kind: "issuer" as const, id: "70000000-0000-4000-8000-000000000001" };
const ISSUER_B = { kind: "issuer" as const, id: "70000000-0000-4000-8000-000000000002" };
const ISSUER_C = { kind: "issuer" as const, id: "70000000-0000-4000-8000-000000000003" };
const docker = { skip: !dockerAvailable(), timeout: 120_000 };

async function seededClient(t: TestContext, prefix: string): Promise<Client> {
  const { databaseUrl } = await bootstrapDatabase(t, prefix);
  const client = await connectedClient(t, databaseUrl);
  await client.query(`insert into users (user_id, email) values ($1::uuid, 'a@example.com')`, [USER_ID]);
  return client;
}

async function insertWatchlist(client: Client, mode: string, membershipSpec: object | null): Promise<string> {
  const { rows: [{ watchlist_id }] } = await client.query<{ watchlist_id: string }>(
    `insert into watchlists (user_id, name, mode, membership_spec)
     values ($1::uuid, $2, $3::watchlist_mode, $4::jsonb) returning watchlist_id`,
    [USER_ID, mode, mode, membershipSpec === null ? null : JSON.stringify(membershipSpec)],
  );
  return watchlist_id;
}

async function insertTheme(client: Client): Promise<string> {
  const { rows: [{ theme_id }] } = await client.query<{ theme_id: string }>(
    `insert into themes (name, membership_mode) values ('AI capex', 'manual') returning theme_id`,
  );
  await client.query(
    `insert into theme_memberships (theme_id, subject_kind, subject_id, effective_at, expires_at)
     values ($1::uuid, 'issuer', $2::uuid, now() - interval '1 day', null),
            ($1::uuid, 'issuer', $3::uuid, now() + interval '1 day', null),
            ($1::uuid, 'issuer', $4::uuid, now() - interval '2 days', now() - interval '1 day')`,
    [theme_id, ISSUER_A.id, ISSUER_B.id, ISSUER_C.id],
  );
  return theme_id;
}

async function insertPortfolio(client: Client): Promise<string> {
  const { rows: [{ portfolio_id }] } = await client.query<{ portfolio_id: string }>(
    `insert into portfolios (user_id, name, base_currency) values ($1::uuid, 'Book', 'USD') returning portfolio_id`,
    [USER_ID],
  );
  await client.query(
    `insert into portfolio_holdings (portfolio_id, subject_kind, subject_id, quantity) values ($1::uuid, 'issuer', $2::uuid, 10)`,
    [portfolio_id, ISSUER_C.id],
  );
  return portfolio_id;
}

async function members(deps: DynamicWatchlistDeps, watchlistId: string) {
  const membership = await resolveDynamicWatchlistMembers(deps, { user_id: USER_ID, watchlist_id: watchlistId });
  return membership.members.map((member) => member.subject_ref);
}

test("a manual watchlist reads its stored members from Postgres", docker, async (t) => {
  const client = await seededClient(t, "watchlists-dynamic-manual");
  const watchlistId = await insertWatchlist(client, "manual", null);
  await client.query(
    `insert into watchlist_members (watchlist_id, subject_kind, subject_id) values ($1::uuid, 'issuer', $2::uuid)`,
    [watchlistId, ISSUER_A.id],
  );
  assert.deepEqual(await members({ db: client as QueryExecutor }, watchlistId), [ISSUER_A]);
});

test("a theme watchlist reads the theme's current memberships from Postgres", docker, async (t) => {
  const client = await seededClient(t, "watchlists-dynamic-theme");
  const watchlistId = await insertWatchlist(client, "theme", { theme_id: await insertTheme(client) });
  assert.deepEqual(await members({ db: client as QueryExecutor }, watchlistId), [ISSUER_A]);
});

test("a portfolio watchlist reads the user's holdings from Postgres", docker, async (t) => {
  const client = await seededClient(t, "watchlists-dynamic-portfolio");
  const watchlistId = await insertWatchlist(client, "portfolio", { portfolio_id: await insertPortfolio(client) });
  assert.deepEqual(await members({ db: client as QueryExecutor }, watchlistId), [ISSUER_C]);
});

test("a screen watchlist replays the screen named in its Postgres spec", docker, async (t) => {
  const client = await seededClient(t, "watchlists-dynamic-screen");
  const watchlistId = await insertWatchlist(client, "screen", { screen_id: "screen-growth" });
  const deps: DynamicWatchlistDeps = {
    db: client as QueryExecutor,
    screens: { find: (screenId) => (screenId === "screen-growth" ? { screen_id: screenId } : undefined) },
    executeScreen: () => ({ rows: [{ subject_ref: ISSUER_B }] }),
  };
  assert.deepEqual(await members(deps, watchlistId), [ISSUER_B]);
});

test("an agent watchlist resolves its agent's theme and portfolio universes from Postgres", docker, async (t) => {
  const client = await seededClient(t, "watchlists-dynamic-agent");
  const themeId = await insertTheme(client);
  const portfolioId = await insertPortfolio(client);
  const universes = new Map([
    ["theme-agent", { mode: "theme" as const, theme_id: themeId }],
    ["portfolio-agent", { mode: "portfolio" as const, portfolio_id: portfolioId }],
  ]);
  const deps: DynamicWatchlistDeps = {
    db: client as QueryExecutor,
    agents: {
      get: (agentId) => {
        const universe = universes.get(agentId);
        return universe && { agent_id: agentId, user_id: USER_ID, universe };
      },
    },
  };
  assert.deepEqual(await members(deps, await insertWatchlist(client, "agent", { agent_id: "theme-agent" })), [ISSUER_A]);
  assert.deepEqual(await members(deps, await insertWatchlist(client, "agent", { agent_id: "portfolio-agent" })), [ISSUER_C]);
});
