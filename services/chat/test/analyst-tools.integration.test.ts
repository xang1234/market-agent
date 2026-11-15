import test from "node:test";
import assert from "node:assert/strict";

import { runAnalystTool } from "../src/analyst-tools.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

const AAPL = "d1111111-1111-4111-8111-111111111111";
const FINVIZ = "00000000-0000-4000-a000-000000000015";

test("consensus is the newest capture within 7 days, and an empty newest capture is no consensus", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "chat-analyst-consensus");
  const db = await connectedClient(t, databaseUrl);
  await db.query(`insert into issuers (issuer_id, legal_name) values ($1, 'Apple Inc')`, [AAPL]);
  await db.query(
    `insert into sources (source_id, provider, kind, canonical_url, trust_tier, license_class, retrieved_at)
     values ($1, 'finviz_dev_consensus', 'reference_data', 'https://finviz.com', 'tertiary', 'free_dev', now()) on conflict (source_id) do nothing`,
    [FINVIZ],
  );
  await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values (gen_random_uuid(), $1, 'common_stock')`, [AAPL]);
  await db.query(
    `insert into listings (instrument_id, mic, ticker, trading_currency, timezone)
     select instrument_id, 'XNAS', 'AAPL', 'USD', 'America/New_York' from instruments where issuer_id = $1`,
    [AAPL],
  );
  const capture = (day: string, field: string, raw: string, value: string | null, unit: string) => db.query(
    `insert into consensus_captures (issuer_id, listing_id, source_id, captured_on, retrieved_at, field_key, raw_label, raw_value, value, unit)
     select $1, l.listing_id, $2, $3::date, $3::date + interval '9 hours', $4, $4, $5, $6::numeric, $7
       from listings l where l.ticker = 'AAPL'`,
    [AAPL, FINVIZ, day, field, raw, value, unit],
  );
  await capture("2026-11-09", "target_price", "280.00", "280.00", "usd");
  await capture("2026-11-12", "target_price", "290.50", "290.50", "usd");
  await capture("2026-11-12", "eps_next_y", "8.49", "8.49", "usd_per_share");
  await capture("2026-11-12", "recommendation_mean", "-", null, "recommendation_1_to_5");
  await capture("2026-11-14", "target_price", "-", null, "usd");

  const read = (as_of: string) => runAnalystTool(db, "get_analyst_consensus", { issuer_ids: [AAPL], as_of });
  const shown = async (as_of: string) => {
    const result = await read(as_of);
    return result.status === "ok" && result.tool === "get_analyst_consensus"
      ? [result.captured_on, ...result.values.map(({ capture_id: _id, ...value }) => value)]
      : result.status;
  };
  assert.deepEqual(await shown("2026-11-13T12:00:00Z"), [
    "2026-11-12",
    { source_id: FINVIZ, provider: "Finviz", field_key: "eps_next_y", label: "EPS next year", raw_value: "8.49", unit: "usd_per_share", fiscal_period: null },
    { source_id: FINVIZ, provider: "Finviz", field_key: "target_price", label: "target price", raw_value: "290.50", unit: "usd", fiscal_period: null },
  ], "the Nov 12 capture, its empty recommendation left out");
  assert.deepEqual(await shown("2026-11-14T12:00:00Z"), "no_consensus", "Nov 14 showed every cell empty: Nov 12 does not stand in");
  assert.deepEqual((await shown("2026-11-11T12:00:00Z"))[0], "2026-11-09", "the Nov 9 capture is within 7 days of Nov 11");
  assert.deepEqual((await shown("2026-11-12T08:00:00Z"))[0], "2026-11-09", "Nov 12's capture was retrieved at 09:00, after an 08:00 cutoff");
  assert.deepEqual(await read("2026-11-17T12:00:00Z"), { tool: "get_analyst_consensus", status: "no_consensus" }, "Nov 14 is the newest, and still empty");
  await db.query(`delete from consensus_captures where captured_on = '2026-11-14'`);
  assert.deepEqual(await read("2026-11-20T12:00:00Z"), { tool: "get_analyst_consensus", status: "no_consensus" }, "Nov 12 is 8 days old on Nov 20");
});
