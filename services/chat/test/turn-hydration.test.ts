import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { IDS } from "../../financial-engine/test/db-fixtures.ts";
import { createTurnHydrator } from "../src/turn-hydration.ts";
import type { HydrationListing } from "../src/ytd-hydration.ts";
import { chatDatabase } from "./financial-fixtures.ts";

const LIVE = { SEC_EDGAR_USER_AGENT: "test-agent", MARKET_ORIGIN: "http://market.test" };
// A listed company with no filings or bars on file.
const ZETA = "4f000000-0000-4000-8000-0000000000e0";
const LISTING = "4f000000-0000-4000-8000-0000000000e1";

function recorder() {
  const events: Array<Record<string, unknown>> = [];
  return { events, turn: { turnId: "t1", emit: ((type: string, payload: Record<string, unknown> = {}) => { events.push({ type, ...payload }); return {} as never; }) } };
}

test("turn hydration", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for turn hydration coverage");
    return;
  }
  const { db, pool } = await chatDatabase(t, "turn-hydration");
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Zeta Corp.', '9999001')`, [ZETA]);
  await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $1, 'common_stock')`, [ZETA]);
  await db.query(`insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone) values ($1, $2, 'XNAS', 'ZETA', 'USD', 'America/New_York')`, [LISTING, ZETA]);

  const fakes = (options: { filings?: (issuerId: string) => Promise<void> } = {}) => {
    const sec: string[] = [];
    const bars: Array<{ origin: string; listings: ReadonlyArray<HydrationListing> }> = [];
    return {
      sec,
      bars,
      fetchFilings: async (issuerId: string) => {
        sec.push(issuerId);
        await options.filings?.(issuerId);
      },
      fetchBars: async (origin: string, listings: ReadonlyArray<HydrationListing>) => {
        bars.push({ origin, listings });
      },
    };
  };

  await t.test("fetches filings and prices only for the companies that lack them, and says so on the stream", async () => {
    const fetch = fakes();
    const hydrate = createTurnHydrator({ db: pool, env: LIVE, ...fetch });
    const { events, turn } = recorder();
    const loading = await hydrate([{ issuer_id: IDS.issuerA, label: "AAA" }, { issuer_id: ZETA, label: "ZETA" }], turn);
    assert.deepEqual(fetch.sec, [ZETA]);
    assert.deepEqual(fetch.bars, [{ origin: "http://market.test", listings: [{ id: LISTING, timeZone: "America/New_York" }] }]);
    assert.deepEqual([...loading], []);
    assert.deepEqual(events, [
      { type: "tool.started", tool_call_id: "fetch_filings-t1", tool_name: "fetch_filings", label: "Fetching filings for ZETA" },
      { type: "tool.started", tool_call_id: "load_prices-t1", tool_name: "load_prices", label: "Loading prices for ZETA" },
      { type: "tool.completed", tool_call_id: "fetch_filings-t1", tool_name: "fetch_filings", label: "Fetching filings for ZETA", status: "ok" },
      { type: "tool.completed", tool_call_id: "load_prices-t1", tool_name: "load_prices", label: "Loading prices for ZETA", status: "ok" },
    ]);
  });

  await t.test("a company already on file is not fetched again, and the stream says nothing", async () => {
    const fetch = fakes();
    const { events, turn } = recorder();
    await createTurnHydrator({ db: pool, env: LIVE, ...fetch })([{ issuer_id: IDS.issuerA, label: "AAA" }, { issuer_id: IDS.issuerB, label: "BBB" }], turn);
    assert.deepEqual([fetch.sec, fetch.bars, events], [[], [], []]);
  });

  await t.test("fetches for at most five companies a turn", async () => {
    const fetch = fakes();
    const unknown = Array.from({ length: 7 }, () => randomUUID());
    await createTurnHydrator({ db: pool, env: LIVE, ...fetch })(unknown.map((issuer_id, index) => ({ issuer_id, label: `C${index}` })), recorder().turn);
    assert.deepEqual(fetch.sec, unknown.slice(0, 5));
  });

  await t.test("a fetch past the turn's budget leaves its company still loading, and a later turn waits on it rather than fetching again", async () => {
    let finish!: () => void;
    const fetch = fakes({ filings: () => new Promise<void>((resolve) => { finish = resolve; }) });
    const hydrate = createTurnHydrator({ db: pool, env: { SEC_EDGAR_USER_AGENT: "test-agent" }, ...fetch, budgetMs: 30 });
    const first = recorder();
    const started = Date.now();
    assert.deepEqual([...await hydrate([{ issuer_id: ZETA, label: "ZETA" }], first.turn)], [ZETA]);
    assert.ok(Date.now() - started < 5_000);
    assert.deepEqual(first.events.at(-1), { type: "tool.completed", tool_call_id: "fetch_filings-t1", tool_name: "fetch_filings", label: "Fetching filings for ZETA", status: "still_loading" });
    assert.deepEqual([...await hydrate([{ issuer_id: ZETA, label: "ZETA" }], recorder().turn)], [ZETA]);
    finish();
    assert.deepEqual(fetch.sec, [ZETA]);
  });

  await t.test("a company whose fetch failed is not fetched again within a minute", async () => {
    let clock = 1_000_000;
    const fetch = fakes({ filings: async () => { throw new Error("sec_edgar: HTTP 503"); } });
    const warnings: unknown[] = [];
    const hydrate = createTurnHydrator({ db: pool, env: { SEC_EDGAR_USER_AGENT: "test-agent" }, ...fetch, now: () => clock, logger: { warn: (message: unknown) => warnings.push(message) } });
    const first = recorder();
    await hydrate([{ issuer_id: ZETA, label: "ZETA" }], first.turn);
    assert.equal(first.events.at(-1)!.status, "failed");
    clock += 59_999;
    await hydrate([{ issuer_id: ZETA, label: "ZETA" }], recorder().turn);
    assert.deepEqual(fetch.sec, [ZETA]);
    clock += 1;
    await hydrate([{ issuer_id: ZETA, label: "ZETA" }], recorder().turn);
    assert.deepEqual(fetch.sec, [ZETA, ZETA]);
    assert.deepEqual(warnings, ["[chat] a fetch for the turn's companies failed; the answer names the gap", "[chat] a fetch for the turn's companies failed; the answer names the gap"]);
  });

  await t.test("a frozen data mode fetches nothing, and without an SEC user agent only prices are fetched", async () => {
    const company = [{ issuer_id: ZETA, label: "ZETA" }];
    for (const env of [{ ...LIVE, DEV_NO_KEYS: "true" }, { ...LIVE, DEV_NO_KEYS: "traces" }, { ...LIVE, DEV_MODE: "analyst" }]) {
      const fetch = fakes();
      const { events, turn } = recorder();
      await createTurnHydrator({ db: pool, env, ...fetch })(company, turn);
      assert.deepEqual([fetch.sec, fetch.bars, events], [[], [], []], JSON.stringify(env));
    }
    const fetch = fakes();
    await createTurnHydrator({ db: pool, env: { MARKET_ORIGIN: "http://market.test" }, ...fetch })(company, recorder().turn);
    assert.deepEqual([fetch.sec, fetch.bars.map((call) => call.listings.map((listing) => listing.id))], [[], [[LISTING]]]);
  });
});
