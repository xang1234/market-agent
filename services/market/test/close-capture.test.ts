import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { GOLDEN_ISSUER_IDS } from "../../shared/src/golden-issuers.ts";
import { captureCloses, captureExitCode } from "../src/close-capture-cli.ts";

const quiet = { log: () => {}, warn: () => {}, error: () => {} };
const BASE_URL = "http://sidecar.test";

type Bar = { day: string; close: string };

function barsBody(bars: ReadonlyArray<Bar>, overrides: { currency?: string; basis?: string } = {}): string {
  const rows = bars.map(({ day, close }) => `{"ts":"${day}T05:00:00.000Z","open":1.5,"high":999.25,"low":0.5,"close":${close},"volume":1200}`);
  return `{"status":"available","data":{"bars":[${rows.join(",")}],"as_of":"${bars.at(-1)!.day}T05:00:00.000Z","delay_class":"eod","currency":"${overrides.currency ?? "USD"}","adjustment_basis":"${overrides.basis ?? "split_adjusted"}"}}`;
}

test("capture:closes stores each ticker's split-adjusted closes as a dated set and stops when the sidecar is gone", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for capture coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "market-close-capture");
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(new URL("../../../db/seed/sources.sql", import.meta.url), "utf8"));
  const listings = [
    { issuer: "37000000-0000-4000-8000-000000000001", n: 1, ticker: "AAPL", mic: "XNAS", asset: "common_stock" },
    { issuer: "37000000-0000-4000-8000-000000000002", n: 2, ticker: "CAT", mic: "XNYS", asset: "common_stock" },
    { issuer: GOLDEN_ISSUER_IDS.NVDA, n: 3, ticker: "NVDA", mic: "XNAS", asset: "common_stock" },
    { issuer: "37000000-0000-4000-8000-000000000004", n: 4, ticker: "SHOP", mic: "XTSE", asset: "common_stock" },
    { issuer: "37000000-0000-4000-8000-000000000005", n: 5, ticker: "SPY", mic: "ARCX", asset: "etf" },
  ];
  for (const { issuer, n, ticker, mic, asset } of listings) {
    await db.query(`insert into issuers (issuer_id, legal_name) values ($1, $2) on conflict do nothing`, [issuer, `${ticker} Corp`]);
    await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $2, $3)`, [`37000000-0000-4000-8000-00000000010${n}`, issuer, asset]);
    await db.query(
      `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone) values ($1, $2, $3, $4, 'USD', 'America/New_York')`,
      [`37000000-0000-4000-8000-00000000020${n}`, `37000000-0000-4000-8000-00000000010${n}`, mic, ticker],
    );
  }

  const requests: Array<Record<string, unknown>> = [];
  let answer: (ticker: string) => Response | Promise<Response> = () => new Response(barsBody([{ day: "2016-11-10", close: "1" }]));
  const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
    assert.equal(String(url), `${BASE_URL}/market/daily-bars`);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    return answer(String(body.ticker));
  }) as typeof fetch;
  const run = (now: string, tickers: ReadonlyArray<string> | null, log: Pick<Console, "log" | "warn" | "error"> = quiet) =>
    captureCloses(db, { baseUrl: BASE_URL, fetchImpl }, { tickers, now: () => new Date(now), sleep: async () => {}, log });
  const rows = async () => (await db.query(
    `select l.ticker, c.captured_on::text, c.trade_date::text, c.close_text, c.currency, c.adjustment_basis, c.source_id::text
       from daily_close_captures c join listings l on l.listing_id = c.listing_id
      order by l.ticker, c.captured_on, c.trade_date`,
  )).rows;

  const firstCloses: Record<string, Bar[]> = {
    AAPL: [{ day: "2016-11-10", close: "27.11750030517578" }, { day: "2026-11-09", close: "268.47" }],
    CAT: [{ day: "2026-11-09", close: "580.0400390625" }],
  };
  answer = (ticker) => new Response(barsBody(firstCloses[ticker]!));
  const first = await run("2026-11-10T06:00:00Z", null);
  assert.deepEqual(first, { inserted: 3, failures: 0, blocked: false });
  assert.equal(captureExitCode(first), 0);
  assert.deepEqual(requests, [
    { ticker: "AAPL", mic: "XNAS", currency: "USD", timezone: "America/New_York", range: { start: "2016-11-10T00:00:00.000Z", end: "2026-11-11T00:00:00.000Z" }, adjustment_basis: "split_adjusted" },
    { ticker: "CAT", mic: "XNYS", currency: "USD", timezone: "America/New_York", range: { start: "2016-11-10T00:00:00.000Z", end: "2026-11-11T00:00:00.000Z" }, adjustment_basis: "split_adjusted" },
  ], "only active US common stock and ADR listings, never the frozen golden issuers");
  const yahoo = "00000000-0000-4000-a000-00000000000b";
  assert.deepEqual(await rows(), [
    { ticker: "AAPL", captured_on: "2026-11-10", trade_date: "2016-11-10", close_text: "27.11750030517578", currency: "USD", adjustment_basis: "split_adjusted", source_id: yahoo },
    { ticker: "AAPL", captured_on: "2026-11-10", trade_date: "2026-11-09", close_text: "268.47", currency: "USD", adjustment_basis: "split_adjusted", source_id: yahoo },
    { ticker: "CAT", captured_on: "2026-11-10", trade_date: "2026-11-09", close_text: "580.0400390625", currency: "USD", adjustment_basis: "split_adjusted", source_id: yahoo },
  ]);
  const firstSet = await rows();

  answer = () => new Response(barsBody([{ day: "2016-11-10", close: "9.5" }, { day: "2026-11-09", close: "1.25" }, { day: "2026-11-10", close: "2.5" }]));
  const rerun = await run("2026-11-10T20:00:00Z", ["AAPL", "CAT"]);
  assert.deepEqual(rerun, { inserted: 0, failures: 0, blocked: false });
  assert.deepEqual(await rows(), firstSet, "a same-day rerun inserts nothing, even when the provider's closes moved or gained a day");

  answer = (ticker) => new Response(barsBody(ticker === "AAPL" ? [{ day: "2016-11-10", close: "13.55875015258789" }, { day: "2026-11-10", close: "134.5" }] : firstCloses.CAT!));
  assert.deepEqual(await run("2026-11-11T06:00:00Z", ["AAPL"]), { inserted: 2, failures: 0, blocked: false });
  assert.deepEqual(
    (await rows()).filter((row) => row.ticker === "AAPL").map((row) => [row.captured_on, row.trade_date, row.close_text]),
    [
      ["2026-11-10", "2016-11-10", "27.11750030517578"],
      ["2026-11-10", "2026-11-09", "268.47"],
      ["2026-11-11", "2016-11-10", "13.55875015258789"],
      ["2026-11-11", "2026-11-10", "134.5"],
    ],
    "a later day's capture appends a new set beside the earlier one",
  );

  await db.query(`delete from daily_close_captures`);
  await db.query(`insert into issuers (issuer_id, legal_name) values ('37000000-0000-4000-8000-000000000006', 'Other CAT Corp'), ('37000000-0000-4000-8000-000000000007', 'Two Class Corp')`);
  const listing = async (issuer: string, n: number, ticker: string) => {
    await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $2, 'common_stock')`, [`37000000-0000-4000-8000-00000000030${n}`, issuer]);
    await db.query(
      `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone) values ($1, $2, 'XNAS', $3, 'USD', 'America/New_York')`,
      [`37000000-0000-4000-8000-00000000040${n}`, `37000000-0000-4000-8000-00000000030${n}`, ticker],
    );
  };
  await listing("37000000-0000-4000-8000-000000000006", 1, "CAT");
  await listing("37000000-0000-4000-8000-000000000007", 2, "TWOA");
  await listing("37000000-0000-4000-8000-000000000007", 3, "TWOB");
  const errors: string[] = [];
  const logged = { ...quiet, error: (message: string) => errors.push(message) };
  answer = () => new Response(barsBody([{ day: "2026-11-09", close: "10" }]));
  requests.length = 0;
  const ambiguous = await run("2026-11-10T06:00:00Z", ["CAT", "TWOA", "TWOB", "MISSING"], logged);
  assert.deepEqual(ambiguous, { inserted: 2, failures: 2, blocked: false });
  assert.equal(captureExitCode(ambiguous), 1);
  assert.deepEqual(requests.map((request) => request.ticker), ["TWOA", "TWOB"], "an ambiguous ticker is never fetched; each share class is its own listing");
  assert.deepEqual(errors, [
    "MISSING: no active US common stock or ADR listing on file",
    "CAT: more than one active US listing (37000000-0000-4000-8000-000000000202, 37000000-0000-4000-8000-000000000401); captured for none",
  ]);

  await db.query(`delete from daily_close_captures`);
  errors.length = 0;
  answer = (ticker) => new Response(barsBody([{ day: "2026-11-06", close: "268.47" }, { day: "2026-11-09", close: ticker === "AAPL" ? "0" : "-3.5" }]));
  const badClose = await run("2026-11-10T06:00:00Z", ["AAPL", "TWOA"], logged);
  assert.deepEqual(badClose, { inserted: 0, failures: 2, blocked: false });
  assert.deepEqual(errors, [
    "AAPL: capture failed: yfinance: AAPL close on 2026-11-09 is not a positive decimal",
    "TWOA: capture failed: yfinance: TWOA close on 2026-11-09 is not a positive decimal",
  ]);
  assert.deepEqual(await rows(), [], "a ticker with a bad close stores none of its set");

  errors.length = 0;
  answer = () => new Response(barsBody([{ day: "2026-11-09", close: "10" }], { basis: "split_and_div_adjusted" }));
  assert.deepEqual(await run("2026-11-10T06:00:00Z", ["AAPL"], logged), { inserted: 0, failures: 1, blocked: false });
  assert.deepEqual(errors, ["AAPL: capture failed: yfinance: AAPL closes are not split_adjusted"]);

  for (const blockedAnswer of [
    () => Promise.reject(new TypeError("fetch failed")),
    () => new Response("", { status: 429 }),
    () => new Response(`{"status":"unavailable","reason":"rate_limited","retryable":true,"detail":"yfinance: Too Many Requests"}`),
  ]) {
    requests.length = 0;
    answer = (ticker) => (ticker === "TWOA" ? blockedAnswer() : new Response(barsBody([{ day: "2026-11-09", close: "10" }])));
    await db.query(`delete from daily_close_captures`);
    const blocked = await run("2026-11-10T06:00:00Z", ["AAPL", "TWOA", "TWOB"]);
    assert.deepEqual(blocked, { inserted: 1, failures: 0, blocked: true });
    assert.equal(captureExitCode(blocked), 2);
    assert.deepEqual(requests.map((request) => request.ticker), ["AAPL", "TWOA"], "nothing is requested after the sidecar is gone or blocked");
    assert.deepEqual([...new Set((await rows()).map((row) => row.ticker))], ["AAPL"], "closes written before the stop stay");
  }
});
