import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { captureConsensus, captureExitCode, type ConsensusSidecar } from "../src/consensus-capture-cli.ts";
import { SEC_EDGAR_FILING_SOURCE_ID } from "../src/provider-sources.ts";

const NOW = new Date("2026-11-09T06:00:00Z");
const quiet = { log: () => {}, warn: () => {}, error: () => {} };

function cells(eps: string) {
  return [
    { field_key: "eps_next_q", raw_label: "EPS next Q", raw_value: eps, value: eps, unit: "usd_per_share", period: "next_q" },
    { field_key: "eps_next_y", raw_label: "EPS next Y", raw_value: "10.46", value: "10.46", unit: "usd_per_share", period: "next_y" },
    { field_key: "eps_growth_this_y", raw_label: "EPS this Y", raw_value: "5.11%", value: "5.11", unit: "percent", period: "this_y" },
    { field_key: "eps_growth_next_y", raw_label: "EPS next Y Percentage", raw_value: "10.77%", value: "10.77", unit: "percent", period: "next_y" },
    { field_key: "eps_growth_next_5y", raw_label: "EPS next 5Y", raw_value: "8.18%", value: "8.18", unit: "percent", period: null },
    { field_key: "target_price", raw_label: "Target Price", raw_value: "-", value: null, unit: "usd", period: null },
    { field_key: "recommendation_mean", raw_label: "Recom", raw_value: "2.29", value: "2.29", unit: "recommendation_1_to_5", period: null },
  ];
}

test("capture:consensus writes one dated row per field, appends nothing on a same-day rerun, and stops on a block", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for capture coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-consensus-capture");
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(new URL("../../../db/seed/sources.sql", import.meta.url), "utf8"));
  await db.query(await readFile(new URL("../../../db/seed/metrics.sql", import.meta.url), "utf8"));
  const issuers = [
    { n: 1, ticker: "AAPL", mic: "XNAS", asset: "common_stock" },
    { n: 2, ticker: "CAL", mic: "XNYS", asset: "common_stock" },
    { n: 3, ticker: "NEW", mic: "XNAS", asset: "common_stock" },
    { n: 4, ticker: "SHOP", mic: "XTSE", asset: "common_stock" },
    { n: 5, ticker: "SPY", mic: "ARCX", asset: "etf" },
  ];
  for (const { n, ticker, mic, asset } of issuers) {
    await db.query(`insert into issuers (issuer_id, legal_name) values ($1, $2)`, [`36000000-0000-4000-8000-00000000000${n}`, `${ticker} Corp`]);
    await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $2, $3)`, [`36000000-0000-4000-8000-00000000010${n}`, `36000000-0000-4000-8000-00000000000${n}`, asset]);
    await db.query(
      `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone) values ($1, $2, $3, $4, 'USD', 'America/New_York')`,
      [`36000000-0000-4000-8000-00000000020${n}`, `36000000-0000-4000-8000-00000000010${n}`, mic, ticker],
    );
  }
  const reported = async (issuer: number, kind: string, year: number, period: string, end: string) =>
    db.query(
      `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_end, fiscal_year, fiscal_period,
                          value_num, unit, currency, scale, as_of, observed_at, source_id, method, verification_status, freshness_class, coverage_level, confidence)
       select 'issuer', $1, metric_id, $2, $3, $4, $5, 1, 'currency', 'USD', 1, $3::date + 30, $3::date + 30, $6, 'reported', 'authoritative', 'filing_time', 'full', 1
         from metrics where metric_key = 'revenue'`,
      [`36000000-0000-4000-8000-00000000000${issuer}`, kind, end, year, period, SEC_EDGAR_FILING_SOURCE_ID],
    );
  await reported(1, "fiscal_y", 2025, "FY", "2025-09-27");
  await reported(1, "fiscal_y", 2026, "FY", "2026-09-26");
  await reported(1, "fiscal_q", 2026, "Q3", "2026-06-27");
  await reported(2, "fiscal_y", 2025, "FY", "2025-12-31");
  await reported(2, "fiscal_q", 2026, "Q3", "2026-09-30");

  const fetched: string[] = [];
  const sidecar = (eps: string, blocked = new Set<string>()): ConsensusSidecar => async ({ ticker, mic }) => {
    fetched.push(`${ticker}:${mic}`);
    return blocked.has(ticker)
      ? { status: "unavailable", reason: "rate_limited", retryable: true, detail: "finviz: HTTP 403" }
      : { status: "available", data: { cells: cells(eps) } };
  };
  const options = { now: () => NOW, sleep: async () => {}, log: quiet };
  const rows = async () => (await db.query(
    `select l.ticker, c.captured_on::text, c.field_key, c.raw_value, c.value::text, c.fiscal_period
       from consensus_captures c join listings l on l.listing_id = c.listing_id
      order by l.ticker, c.field_key`,
  )).rows;

  const first = await captureConsensus(db, sidecar("2.90"), { ...options, tickers: null });
  assert.deepEqual(first, { inserted: 21, failures: 0, blocked: false });
  assert.equal(captureExitCode(first), 0);
  assert.deepEqual(fetched, ["AAPL:XNAS", "CAL:XNYS", "NEW:XNAS"], "only active US common stock and ADR listings");
  const periods = (ticker: string) => async () =>
    Object.fromEntries((await rows()).filter((row) => row.ticker === ticker).map((row) => [row.field_key, row.fiscal_period]));
  assert.deepEqual(await periods("AAPL")(), {
    eps_growth_next_5y: null, eps_growth_next_y: "FY2028", eps_growth_this_y: "FY2027", eps_next_q: "FY2027 Q1", eps_next_y: "FY2028",
    recommendation_mean: null, target_price: null,
  });
  assert.deepEqual(await periods("CAL")(), {
    eps_growth_next_5y: null, eps_growth_next_y: "FY2027", eps_growth_this_y: "FY2026", eps_next_q: "FY2026 Q4", eps_next_y: "FY2027",
    recommendation_mean: null, target_price: null,
  });
  assert.deepEqual(await periods("NEW")(), {
    eps_growth_next_5y: null, eps_growth_next_y: null, eps_growth_this_y: null, eps_next_q: null, eps_next_y: null,
    recommendation_mean: null, target_price: null,
  });
  const aapl = (await rows()).filter((row) => row.ticker === "AAPL");
  assert.deepEqual(aapl.find((row) => row.field_key === "eps_next_q"), {
    ticker: "AAPL", captured_on: "2026-11-09", field_key: "eps_next_q", raw_value: "2.90", value: "2.90", fiscal_period: "FY2027 Q1",
  });
  assert.deepEqual(aapl.find((row) => row.field_key === "target_price"), {
    ticker: "AAPL", captured_on: "2026-11-09", field_key: "target_price", raw_value: "-", value: null, fiscal_period: null,
  });
  const before = await rows();

  fetched.length = 0;
  const rerun = await captureConsensus(db, sidecar("3.10"), { ...options, tickers: null });
  assert.deepEqual(rerun, { inserted: 0, failures: 0, blocked: false });
  assert.deepEqual(await rows(), before, "the same day's rerun leaves every row as first written");

  await db.query(`delete from consensus_captures`);
  fetched.length = 0;
  const blocked = await captureConsensus(db, sidecar("2.90", new Set(["CAL"])), { ...options, tickers: ["AAPL", "CAL", "NEW", "MISSING"] });
  assert.deepEqual(blocked, { inserted: 7, failures: 1, blocked: true });
  assert.equal(captureExitCode(blocked), 2);
  assert.deepEqual(fetched, ["AAPL:XNAS", "CAL:XNYS"], "nothing is requested after the block");
  assert.deepEqual([...new Set((await rows()).map((row) => row.ticker))], ["AAPL"], "rows written before the block stay");

  await db.query(`delete from consensus_captures`);
  const listing = async (issuer: string, n: number, ticker: string, mic: string) => {
    await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $2, 'common_stock')`, [`36000000-0000-4000-8000-00000000030${n}`, issuer]);
    await db.query(
      `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone, active_from) values ($1, $2, $3, $4, 'USD', 'America/New_York', '2020-01-01')`,
      [`36000000-0000-4000-8000-00000000040${n}`, `36000000-0000-4000-8000-00000000030${n}`, mic, ticker],
    );
  };
  await db.query(`insert into issuers (issuer_id, legal_name) values ('36000000-0000-4000-8000-000000000006', 'Other NEW Corp'), ('36000000-0000-4000-8000-000000000007', 'Two Class Corp')`);
  await listing("36000000-0000-4000-8000-000000000006", 1, "NEW", "XNAS");
  await listing("36000000-0000-4000-8000-000000000007", 2, "TWOA", "XNYS");
  await listing("36000000-0000-4000-8000-000000000007", 3, "TWOB", "XNYS");
  const errors: string[] = [];
  const logged = { ...quiet, error: (message: string) => errors.push(message) };
  for (const tickers of [null, ["NEW", "TWOB"]]) {
    fetched.length = 0;
    errors.length = 0;
    const ambiguous = await captureConsensus(db, sidecar("2.90"), { ...options, log: logged, tickers });
    assert.deepEqual(fetched, tickers ? [] : ["AAPL:XNAS", "CAL:XNYS"], "an ambiguous ticker or issuer is never fetched");
    assert.deepEqual(ambiguous, { inserted: tickers ? 0 : 14, failures: 2, blocked: false });
    assert.deepEqual(errors, [
      "NEW: active US listings belong to more than one issuer (36000000-0000-4000-8000-000000000003, 36000000-0000-4000-8000-000000000006); captured for none",
      "TWOA, TWOB: issuer 36000000-0000-4000-8000-000000000007 has more than one active US listing; captured for none",
    ]);
    assert.deepEqual([...new Set((await rows()).map((row) => row.ticker))], ["AAPL", "CAL"], "the unambiguous issuers are captured");
  }
});
