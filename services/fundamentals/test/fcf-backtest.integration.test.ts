// The offline backtest of the Call's required growth (#610), run on twelve
// years of a made-up filer's 10-Ks and ten years of split-adjusted closes.

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bootstrapDatabase, connectedClient, connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { endOfLocalDay } from "../../financial-core/src/index.ts";
import { POLYGON_MARKET_SOURCE_ID, YAHOO_FINANCE_DEV_MARKET_SOURCE_ID } from "../../market/src/provider-sources.ts";
import { attachCiks, closeSeries, inputsAsOf, renderBacktest, runBacktest, subjectIds, type AsOfInputs } from "../src/fcf-backtest.ts";
import { backfillSecStatements } from "../src/sec-statements-backfill-cli.ts";
import { secCompanyFetcher } from "./fakes.ts";
import { annualHistoryCompanyFacts, HISTORY_CIK, HISTORY_SPLIT } from "./sec-annual-history-fixture.ts";

const ISSUER = "38000000-0000-4000-8000-000000000620";
const INSTRUMENT = "38000000-0000-4000-8000-000000000621";
const LISTING = "38000000-0000-4000-8000-000000000622";
const quiet = { log: () => {}, warn: () => {}, error: () => {} };

async function seeded(t: test.TestContext) {
  const { databaseUrl } = await bootstrapDatabase(t, "fin-fcf-backtest");
  const db = await connectedPool(t, databaseUrl);
  for (const seed of ["metrics.sql", "sources.sql"]) await db.query(await readFile(join(workspaceRoot, "db", "seed", seed), "utf8"));
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'History Corp', $2)`, [ISSUER, String(HISTORY_CIK)]);
  await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $2, 'common_stock')`, [INSTRUMENT, ISSUER]);
  await db.query(`insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone) values ($1, $2, 'XNYS', 'HIST', 'USD', 'America/New_York')`, [LISTING, INSTRUMENT]);
  await db.query(`insert into listing_split_coverage (listing_id, checked_at, source_id) values ($1, '2026-11-10T00:00:00Z', $2)`, [LISTING, POLYGON_MARKET_SOURCE_ID]);
  await db.query(
    `insert into listing_splits (listing_id, execution_date, split_from, split_to, source_id) values ($1, $2, $3, $4, $5)`,
    [LISTING, HISTORY_SPLIT.execution_date, HISTORY_SPLIT.split_from, HISTORY_SPLIT.split_to, POLYGON_MARKET_SOURCE_ID],
  );
  // Weekday closes compounding 12% a year from 50 on 2016-11-10, split adjusted as yfinance gives them.
  await db.query(
    `insert into daily_close_captures (listing_id, source_id, captured_on, retrieved_at, trade_date, close_text, currency, adjustment_basis)
     select $1, $2, '2026-11-10', '2026-11-10T01:00:00Z', d::date, round(50 * power(1.12, (d::date - date '2016-11-10') / 365.25), 4)::text, 'USD', 'split_adjusted'
       from generate_series(date '2016-11-10', date '2026-11-09', interval '1 day') d
      where extract(isodow from d) < 6`,
    [LISTING, YAHOO_FINANCE_DEV_MARKET_SOURCE_ID],
  );
  assert.deepEqual(await backfillSecStatements(db, secCompanyFetcher(annualHistoryCompanyFacts), [ISSUER], quiet, 12), { failures: 0 });
  return { db, databaseUrl };
}

test("each FY 10-K's required growth, realized growth and price return, as of its filing date + 1 day", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for backtest coverage");
    return;
  }
  const { db } = await seeded(t);
  const run = await runBacktest(db, ["HIST", "NONE"]);
  const text = (figure: { kind: string; text: string; outcome?: string }) => figure.kind === "value" ? figure.text : `${figure.outcome}: ${figure.text}`;
  const summary = run.rows.flatMap((row) => row.kind === "unread" ? [] : [[
    row.fiscal_year, row.filed, row.inputs.as_of,
    row.inputs.figures.free_cash_flow.text, row.inputs.figures.shares_outstanding.text,
    text(row.price), text(row.required_growth), text(row.realized_fcf_cagr), text(row.share_change), text(row.realized_share_change), text(row.price_return),
  ]]);
  assert.deepEqual(summary.find((row) => row[0] === 2017), [
    2017, "2018-02-15", "2018-02-16", "1100000000", "100000000",
    // Before the 2-for-1 split the close traded at twice its adjusted 57.7245.
    "115.449 (2018-02-16, dev close, never certified)",
    // A separate float bisection of ADR 0006's V(g) at today's 10.31x and d = 0.433% gives 0.711%.
    "0.7%",
    // FY2017's 1,100M to FY2022's 1,600M: (16 / 11)^(1/5) - 1.
    "7.78%",
    // 50M SBC over the 11,544.9M market cap.
    "0.43%",
    // 100M shares, 200M on the post-split basis, to FY2022's 200M.
    "0.00%",
    "12.00%, at or above",
  ]);
  // FY2018's 10-K was filed Friday 2019-02-15, so the as-of day is a Saturday and the close is Monday's.
  const fy2018 = summary.find((row) => row[0] === 2018)!;
  assert.deepEqual([fy2018[1], fy2018[2], String(fy2018[5]).match(/\((\d{4}-\d{2}-\d{2}),/u)?.[1]], ["2019-02-15", "2019-02-16", "2019-02-18"]);
  assert.deepEqual(summary.map((row) => row[0]), [2016, 2017, 2018, 2019, 2020, 2021]);
  // FY2021's 10-K was filed 2022-02-15; five years on is past the last capture.
  assert.equal(summary.at(-1)![10], "price_missing: 5 years on: No captured close on or after 2027-02-16; captures end 2026-11-09.");
  assert.deepEqual(run.rows.map((row) => row.kind === "read" && row.period), [null, null, null, null, null, null]);
  assert.deepEqual(run.issuers, [{ ticker: "NONE", outcome: "subject_unresolved", text: "0 active US common-stock listings" }]);
  assert.match(
    renderBacktest(run, { ranOn: "2026-11-11", command: "npm run backtest:fcf -- --tickers HIST,NONE", notes: "" }),
    /^\| HIST \| 2017 \| 2018-02-15 \| 2018-02-16 \| 1100000000 \| 200000000 \| 50000000 \| 100000000 \| 115\.449 \(2018-02-16, dev close, never certified\) \| 10\.31x \| 0\.7% \| 7\.78% \| 0\.43% \| 0\.00% \| 12\.00%, at or above \| {2}\|$/mu,
  );
  for (const row of run.rows) {
    if (row.kind === "unread") continue;
    for (const input of row.inputs.bound) assert.ok(input.public_by <= endOfLocalDay(row.inputs.as_of, "America/New_York"), `FY${row.fiscal_year}: ${input.slot} public by ${input.public_by}`);
  }
});

test("no input published after an as-of date is used for that date", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for backtest coverage");
    return;
  }
  const { databaseUrl } = await seeded(t);
  const client = await connectedClient(t, databaseUrl);
  const read = async (asOf: string) => {
    const inputs = await inputsAsOf(client, ISSUER, asOf);
    for (const input of inputs.bound) assert.ok(input.public_by <= endOfLocalDay(asOf, "America/New_York"), `${asOf}: ${input.slot} public by ${input.public_by}`);
    return inputs;
  };
  const figures = (inputs: AsOfInputs) => Object.fromEntries(Object.entries(inputs.figures).map(([id, figure]) => [id, figure.kind === "value" ? figure.text : figure.outcome]));

  // Before the first 10-K nothing is public, and free cash flow names the inputs it lacks.
  const none = await read("2016-02-01");
  assert.deepEqual([none.bound, none.figures.free_cash_flow], [[], {
    kind: "outcome",
    outcome: "blocked_by_dependency",
    text: "blocked_dependency: A required input or calculation is unavailable. (operating_cash_flow ineligible_input, capex ineligible_input)",
  }]);

  // The day before FY2017's 10-K: FY2016's figures; its cover count, dated 2017-02-01, the engine no longer takes.
  const before = await read("2018-02-14");
  assert.deepEqual([figures(before), [...new Set(before.bound.map((input) => input.fiscal_year))]], [
    { free_cash_flow: "1000000000", net_cash: "200000000", stock_based_compensation: "50000000", shares_outstanding: "ineligible_input" },
    [2016],
  ]);
  // The day after: FY2017 as first filed, never the 1,350M operating cash flow the FY2018 10-K restated it to a year later.
  const after = await read("2018-02-16");
  assert.deepEqual([figures(after), after.fiscal_year_end], [
    { free_cash_flow: "1100000000", net_cash: "200000000", stock_based_compensation: "50000000", shares_outstanding: "100000000" },
    "2017-12-31",
  ]);
  assert.deepEqual(after.bound.map((input) => input.public_by).sort().at(-1), endOfLocalDay("2018-02-15", "America/New_York"));
});

test("a ticker takes its CIK unless another issuer holds it (#597)", { timeout: 120_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for backtest coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-fcf-backtest-ciks");
  const db = await connectedPool(t, databaseUrl);
  const issuer = (n: number) => `38000000-0000-4000-8000-00000000063${n}`;
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Held Inc. (SEC)', '0000990611'), ($2, 'Held Inc', null), ($3, 'Fresh Inc', null)`, [issuer(0), issuer(1), issuer(2)]);
  for (const [n, ticker] of [[1, "HELD"], [2, "FRSH"]] as const) {
    await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $2, 'common_stock')`, [issuer(n + 4), issuer(n)]);
    await db.query(`insert into listings (instrument_id, mic, ticker, trading_currency, timezone) values ($1, 'XNAS', $2, 'USD', 'America/New_York')`, [issuer(n + 4), ticker]);
  }
  const file = join(await mkdtemp(join(tmpdir(), "fcf-ciks-")), "company_tickers.json");
  await writeFile(file, JSON.stringify({ 0: { cik_str: 990611, ticker: "HELD", title: "Held" }, 1: { cik_str: 990612, ticker: "FRSH", title: "Fresh" } }));
  const logged: string[] = [];
  t.mock.method(console, "error", (line: string) => logged.push(line));
  await attachCiks(db, ["HELD", "FRSH"], file);
  const ciks = await db.query(`select legal_name, cik from issuers order by legal_name`);
  assert.deepEqual(ciks.rows, [
    { legal_name: "Fresh Inc", cik: "990612" },
    { legal_name: "Held Inc", cik: null },
    { legal_name: "Held Inc. (SEC)", cik: "0000990611" },
  ]);
  assert.deepEqual(logged, [`HELD: CIK 990611 belongs to issuer ${issuer(0)}; not attached (#597)`, "FRSH: CIK 990612"]);
});

test("a FY with no FY-labeled facts or no filing date is a named row, not a dropped one", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for backtest coverage");
    return;
  }
  const { db } = await seeded(t);
  const outcomes = async () => (await runBacktest(db, ["HIST"])).rows.map((row) => [row.fiscal_year, row.kind === "unread" ? row.outcome.outcome : "read"]);
  // As COST tagged its FY2019 10-K fp Q4.
  await db.query(`update facts set fiscal_period = 'Q4' where subject_id = $1 and fiscal_year = 2019 and period_kind = 'fiscal_y'`, [ISSUER]);
  assert.deepEqual(await outcomes(), [[2016, "read"], [2017, "read"], [2018, "read"], [2019, "no_fy_facts"], [2020, "read"], [2021, "read"]]);
  // As NKE, whose filings state no cover count and so no filing date.
  await db.query(`update facts set reported_at = null where subject_id = $1`, [ISSUER]);
  assert.deepEqual(await outcomes(), [[2016, "no_filing_date"], [2017, "no_filing_date"], [2018, "no_filing_date"], [2019, "no_fy_facts"], [2020, "no_filing_date"], [2021, "no_filing_date"]]);
});

test("the closes are one capture's: the newest, whichever source took it", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for backtest coverage");
    return;
  }
  const { db } = await seeded(t);
  const capture = (capturedOn: string, closes: Array<[string, string]>) => db.query(
    `insert into daily_close_captures (listing_id, source_id, captured_on, retrieved_at, trade_date, close_text, currency, adjustment_basis)
     select $1, $2, $3::date, $3::date + time '01:00', d, c, 'USD', 'split_adjusted' from unnest($4::date[], $5::text[]) as t(d, c)`,
    [LISTING, POLYGON_MARKET_SOURCE_ID, capturedOn, closes.map(([d]) => d), closes.map(([, c]) => c)],
  );
  await capture("2026-11-01", [["2018-02-16", "999"]]);
  const yahoo = await closeSeries(db, ISSUER);
  assert.deepEqual(yahoo.kind === "closes" && [yahoo.captured_on, yahoo.closes.find((close) => close.trade_date === "2018-02-16"), yahoo.closes.length, new Set(yahoo.closes.map((close) => close.trade_date)).size],
    ["2026-11-10", { trade_date: "2018-02-16", close_text: "57.7245" }, 2608, 2608]);
  await capture("2026-11-12", [["2018-02-16", "58"], ["2026-11-11", "120"]]);
  assert.deepEqual(await closeSeries(db, ISSUER), { kind: "closes", captured_on: "2026-11-12", currency: "USD", closes: [{ trade_date: "2018-02-16", close_text: "58" }, { trade_date: "2026-11-11", close_text: "120" }] });
});

test("ids print only when every ticker resolves: an empty list would backfill every SEC issuer", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for backtest coverage");
    return;
  }
  const { db } = await seeded(t);
  assert.deepEqual(await subjectIds(db, ["HIST"], "issuer_id"), [ISSUER]);
  assert.deepEqual(await subjectIds(db, ["HIST"], "listing_id"), [LISTING]);
  for (const id of ["issuer_id", "listing_id"] as const) {
    await assert.rejects(subjectIds(db, ["HIST", "NONE", "GONE"], id), { message: "unresolved tickers, no ids printed: NONE (0 active US common-stock listings), GONE (0 active US common-stock listings)" });
  }
});
