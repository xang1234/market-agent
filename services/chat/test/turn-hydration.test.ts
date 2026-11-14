import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { IDS } from "../../financial-engine/test/db-fixtures.ts";
import { createTurnHydrator } from "../src/turn-hydration.ts";
import { hydrateYtdBars, type HydrationListing } from "../src/ytd-hydration.ts";
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
    assert.deepEqual([...await hydrate([{ issuer_id: ZETA.toUpperCase(), label: "ZETA" }], recorder().turn)], [ZETA]);
    finish();
    assert.deepEqual(fetch.sec, [ZETA]);
  });

  await t.test("a fetch still running reads still loading once some of its years are stored, and settles to filed", async () => {
    let finish!: () => void;
    const fetch = fakes({ filings: () => new Promise<void>((resolve) => { finish = resolve; }) });
    const hydrate = createTurnHydrator({ db: pool, env: { SEC_EDGAR_USER_AGENT: "test-agent" }, ...fetch, budgetMs: 30 });
    assert.deepEqual([...await hydrate([{ issuer_id: ZETA, label: "ZETA" }], recorder().turn)], [ZETA]);
    const { rows } = await db.query(
      `insert into facts
       select (jsonb_populate_record(null::facts, to_jsonb(f) || jsonb_build_object('fact_id', gen_random_uuid(), 'subject_id', $1::uuid))).*
         from facts f where f.fact_id = $2
       returning fact_id::text`,
      [ZETA, IDS.grossProfit2023],
    );
    try {
      const pending = recorder();
      assert.deepEqual([...await hydrate([{ issuer_id: ZETA, label: "ZETA" }], pending.turn)], [ZETA]);
      assert.equal(pending.events.at(-1)!.status, "still_loading");
      finish();
      const settled = recorder();
      assert.deepEqual([...await hydrate([{ issuer_id: ZETA, label: "ZETA" }], settled.turn)], []);
      assert.deepEqual([fetch.sec, settled.events], [[ZETA], []]);
    } finally {
      await db.query(`delete from facts where fact_id = $1`, [rows[0].fact_id]);
    }
  });

  await t.test("a company whose fetch failed reads still loading, and is not fetched again within a minute", async () => {
    let clock = 1_000_000;
    const fetch = fakes({ filings: async () => { throw new Error("sec_edgar: HTTP 503"); } });
    const warnings: unknown[] = [];
    const hydrate = createTurnHydrator({ db: pool, env: { SEC_EDGAR_USER_AGENT: "test-agent" }, ...fetch, now: () => clock, logger: { warn: (message: unknown) => warnings.push(message) } });
    const first = recorder();
    assert.deepEqual([...await hydrate([{ issuer_id: ZETA, label: "ZETA" }], first.turn)], [ZETA]);
    assert.equal(first.events.at(-1)!.status, "failed");
    clock += 59_999;
    const cooling = recorder();
    assert.deepEqual([...await hydrate([{ issuer_id: ZETA, label: "ZETA" }], cooling.turn)], [ZETA]);
    assert.deepEqual([fetch.sec, cooling.events], [[ZETA], []]);
    clock += 1;
    await hydrate([{ issuer_id: ZETA, label: "ZETA" }], recorder().turn);
    assert.deepEqual(fetch.sec, [ZETA, ZETA]);
    assert.deepEqual(warnings, ["[chat] a fetch for the turn's companies failed; the answer names the gap", "[chat] a fetch for the turn's companies failed; the answer names the gap"]);
  });

  await t.test("a fetch that fails late cools down for a minute from its failure, not its start", async () => {
    let clock = 2_000_000;
    let fail!: (error: Error) => void;
    const fetch = fakes({ filings: () => new Promise<void>((_, reject) => { fail = reject; }) });
    const hydrate = createTurnHydrator({ db: pool, env: { SEC_EDGAR_USER_AGENT: "test-agent" }, ...fetch, now: () => clock, budgetMs: 1, logger: { warn: () => {} } });
    await hydrate([{ issuer_id: ZETA, label: "ZETA" }], recorder().turn);
    clock += 50_000;
    fail(new Error("sec_edgar: HTTP 503"));
    await new Promise((resolve) => setImmediate(resolve));
    clock += 30_000;
    await hydrate([{ issuer_id: ZETA, label: "ZETA" }], recorder().turn);
    assert.deepEqual(fetch.sec, [ZETA], "30s after a failure at 50s, the company is still cooling");
  });

  await t.test("fetches prices for the listing the turn named, not the company's first by ticker, and the first for a company named without one", async () => {
    const named = randomUUID();
    await db.query(`insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone) values ($1, $2, 'XLON', 'ZZZZ', 'GBP', 'Europe/London')`, [named, ZETA]);
    try {
      const fetch = fakes();
      await createTurnHydrator({ db: pool, env: { MARKET_ORIGIN: "http://market.test" }, ...fetch })([{ issuer_id: ZETA, label: "ZZZZ", listing_id: named }], recorder().turn);
      assert.deepEqual(fetch.bars.map((call) => call.listings), [[{ id: named, timeZone: "Europe/London" }]]);
      const unnamed = fakes();
      await createTurnHydrator({ db: pool, env: { MARKET_ORIGIN: "http://market.test" }, ...unnamed })([{ issuer_id: ZETA, label: "ZETA" }], recorder().turn);
      assert.deepEqual(unnamed.bars.map((call) => call.listings), [[{ id: LISTING, timeZone: "America/New_York" }]]);
    } finally {
      await db.query(`delete from listings where listing_id = $1`, [named]);
    }
  });

  await t.test("a turn charting a YTD window fetches a listing with bars stored, to the window's cutoff", async () => {
    await db.query(
      `insert into market_bar_ranges (listing_id, source_id, provider, interval, adjustment_basis, range_start, range_end, as_of, delay_class, currency, fetched_at, expires_at)
       values ($1, $2, 'polygon', '1d', 'split_adjusted', '2026-01-01', '2026-02-01', '2026-02-01', 'eod', 'USD', '2026-02-01', '2126-02-01')`,
      [LISTING, IDS.sourceV1],
    );
    try {
      const calls: Array<{ listings: ReadonlyArray<HydrationListing>; cutoff: string }> = [];
      const hydrate = createTurnHydrator({ db: pool, env: { MARKET_ORIGIN: "http://market.test" }, fetchFilings: async () => {}, fetchBars: async (_origin, listings, cutoff) => { calls.push({ listings, cutoff }); } });
      await hydrate([{ issuer_id: ZETA, label: "ZETA" }], recorder().turn);
      const { events, turn } = recorder();
      await hydrate([{ issuer_id: ZETA }], { ...turn, ytdCutoff: "2026-06-30T20:00:00.000Z" });
      assert.deepEqual(calls, [{ listings: [{ id: LISTING, timeZone: "America/New_York" }], cutoff: "2026-06-30T20:00:00.000Z" }]);
      assert.deepEqual(events.map((event) => event.label), ["Loading prices for ZETA", "Loading prices for ZETA"], "a company with no label is named by its listing");
    } finally {
      await db.query(`delete from market_bar_ranges where listing_id = $1`, [LISTING]);
    }
  });

  const listed = async (ticker: string) => {
    const [issuer, listing] = [randomUUID(), randomUUID()];
    await db.query(`insert into issuers (issuer_id, legal_name) values ($1, $2)`, [issuer, `${ticker} Corp.`]);
    await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $1, 'common_stock')`, [issuer]);
    await db.query(`insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone) values ($1, $2, 'XNAS', $3, 'USD', 'America/New_York')`, [listing, issuer, ticker]);
    return { company: { issuer_id: issuer, label: ticker }, listing };
  };
  const [aaa, bbb] = [await listed("AAAA"), await listed("BBBB")];

  await t.test("a comparison fetches every listing to its own window, though one was fetched to another window a moment ago", async () => {
    const [june, november] = ["2026-06-30T21:00:00.000Z", "2026-11-13T22:00:00.000Z"];
    for (const [first, second] of [[june, november], [november, june]]) {
      const calls: Array<{ listings: string[]; cutoff: string }> = [];
      const hydrate = createTurnHydrator({ db: pool, env: { MARKET_ORIGIN: "http://market.test" }, fetchFilings: async () => {}, fetchBars: async (_origin, listings, cutoff) => { calls.push({ listings: listings.map((listing) => listing.id), cutoff }); } });
      await hydrate([aaa.company], { ...recorder().turn, ytdCutoff: first });
      const { events, turn } = recorder();
      await hydrate([aaa.company, bbb.company], { ...turn, ytdCutoff: second });
      await hydrate([aaa.company, bbb.company], { ...recorder().turn, ytdCutoff: first });
      assert.deepEqual(calls, [
        { listings: [aaa.listing], cutoff: first },
        { listings: [aaa.listing, bbb.listing], cutoff: second },
        { listings: [aaa.listing, bbb.listing], cutoff: first },
      ]);
      assert.deepEqual(events.map((event) => event.label), ["Loading prices for AAAA and BBBB", "Loading prices for AAAA and BBBB"]);
    }
  });

  await t.test("a comparison is fetched on one basis for every listing, though one was fetched alone on another a moment ago", async () => {
    // Before Labor Day's open: the last completed New York session is Aug 31.
    const cutoff = "2026-09-01T00:00:00.000Z";
    const full = [{ ts: "2025-12-31T05:00:00.000Z", close: 100 }, { ts: "2026-08-31T04:00:00.000Z", close: 120 }];
    // AAAA has a split-adjusted window and BBBB only a dividend-adjusted one.
    const requests: Array<{ basis: string; listings: string[] }> = [];
    const fetchImpl = (async (_url: URL | string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { basis: string; subject_refs: Array<{ id: string }> };
      requests.push({ basis: body.basis, listings: body.subject_refs.map((ref) => ref.id) });
      const results = body.subject_refs.map((ref) => ({
        listing: { id: ref.id },
        outcome: body.basis === "split_adjusted" && ref.id === bbb.listing ? { outcome: "unavailable" } : { outcome: "available", data: { bars: full } },
      }));
      return new Response(JSON.stringify({ results }), { status: 200 });
    }) as typeof fetch;
    const hydrate = createTurnHydrator({ db: pool, env: { MARKET_ORIGIN: "http://market.test" }, fetchFilings: async () => {}, fetchBars: (origin, listings, now) => hydrateYtdBars({ origin, listings, now, fetchImpl }) });
    await hydrate([aaa.company], { ...recorder().turn, ytdCutoff: cutoff });
    await hydrate([aaa.company, bbb.company], { ...recorder().turn, ytdCutoff: cutoff });
    assert.deepEqual(requests, [
      { basis: "split_adjusted", listings: [aaa.listing] },
      { basis: "split_adjusted", listings: [aaa.listing, bbb.listing] },
      { basis: "split_and_div_adjusted", listings: [aaa.listing, bbb.listing] },
    ]);
  });

  await t.test("the same comparison asked again within a minute, to the same sessions, is not fetched again", async () => {
    const calls: string[] = [];
    const hydrate = createTurnHydrator({ db: pool, env: { MARKET_ORIGIN: "http://market.test" }, fetchFilings: async () => {}, fetchBars: async (_origin, _listings, cutoff) => { calls.push(cutoff); } });
    await hydrate([aaa.company, bbb.company], { ...recorder().turn, ytdCutoff: "2026-11-13T22:00:00.000Z" });
    const { events, turn } = recorder();
    await hydrate([bbb.company, aaa.company], { ...turn, ytdCutoff: "2026-11-13T22:00:05.000Z" });
    assert.deepEqual([calls, events], [["2026-11-13T22:00:00.000Z"], []]);
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
