// A filing's own-period EPS and weighted-average share counts are certified
// as filed on its filing date (#387): binding restates them to a reference
// date from the listing's splits. A later 10-K's split recast is no restatement.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { backfillSecCompanionStatements, createSecBackedStatementRepository } from "../src/sec-facts-repository.ts";
import { secCompanyFetcher } from "./fakes.ts";

const ISSUER = "35000000-0000-4000-8000-0000000003a1";
const FALLBACK_SOURCE_ID = "35000000-0000-4000-8000-0000000003a9";
const SHARE_KEYS = ["eps_basic", "eps_diluted", "weighted_average_basic_shares", "weighted_average_diluted_shares"];

type Filing = { accn: string; fy: number; fp: string; form: string; filed: string };
const value = (filing: Filing, start: string | null, end: string, token: string) =>
  ({ ...(start === null ? {} : { start }), end, val: Number(token), val_token: token, ...filing });

/**
 * NVDA-like: the FY2024 10-K filed 2024-02-21, the Q1 FY2025 10-Q filed before
 * the 2024-06-10 split, and the FY2025 10-K that restates FY2024 revenue and
 * recasts FY2024's per-share figures for the split.
 */
function splitCorpFacts() {
  const k24: Filing = { accn: "0001045810-24-000029", fy: 2024, fp: "FY", form: "10-K", filed: "2024-02-21" };
  const q1: Filing = { accn: "0001045810-24-000124", fy: 2025, fp: "Q1", form: "10-Q", filed: "2024-05-29" };
  const k25: Filing = { accn: "0001045810-25-000023", fy: 2025, fp: "FY", form: "10-K", filed: "2025-02-26" };
  const fy24 = ["2023-01-30", "2024-01-28"] as const;
  const units = (unit: string, original: string, quarter: string, recast: string, fy25: string) => ({
    label: "",
    description: "",
    units: {
      [unit]: [
        value(k24, ...fy24, original),
        value(q1, "2024-01-29", "2024-04-28", quarter),
        value(k25, ...fy24, recast),
        value(k25, "2024-01-29", "2025-01-26", fy25),
      ],
    },
  });
  return {
    cik: 1045810,
    entityName: "Split Corp",
    facts: {
      "us-gaap": {
        Revenues: units("USD", "60922000000", "26044000000", "60900000000", "130497000000"),
        NetIncomeLoss: units("USD", "29760000000", "14881000000", "29760000000", "72880000000"),
        EarningsPerShareBasic: units("USD/shares", "12.05", "6.04", "1.21", "2.97"),
        EarningsPerShareDiluted: units("USD/shares", "11.93", "5.98", "1.19", "2.94"),
        WeightedAverageNumberOfSharesOutstandingBasic: units("shares", "2469000000", "2462000000", "24690000000", "24555000000"),
        WeightedAverageNumberOfDilutedSharesOutstanding: units("shares", "2494000000", "2489000000", "24940000000", "24804000000"),
        Assets: { label: "", description: "", units: { USD: [value(k24, null, "2024-01-28", "65728000000"), value(q1, null, "2024-04-28", "85228000000")] } },
      },
    },
  };
}

test("SEC EPS and share counts are certified as filed", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for share context coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-sec-share-context");
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Split Corp', '1045810')`, [ISSUER]);
  const fetcher = secCompanyFetcher(splitCorpFacts, { completed_at: "2026-10-01T15:00:00.000Z" });
  const ingest = (fiscalYear: number, fiscalPeriod: "FY" | "Q1") =>
    createSecBackedStatementRepository(db, { fetcher, sourceId: FALLBACK_SOURCE_ID, logger: { warn: () => {} } })
      .find({ issuer_id: ISSUER, family: "income", basis: "as_reported", fiscal_year: fiscalYear, fiscal_period: fiscalPeriod });
  const stored = async () => (await db.query(
    `select m.metric_key, f.fiscal_period::text as fiscal_period, f.method::text as method, f.value_num::text as value,
            c.adjustment_basis, c.as_filed_on::text as as_filed_on, c.share_basis
       from facts f join metrics m on m.metric_id = f.metric_id left join fact_financial_contexts c on c.fact_id = f.fact_id
      where f.subject_id = $1 and f.invalidated_at is null
      order by m.metric_key, f.period_end, f.method`,
    [ISSUER],
  )).rows.map((row) => [row.metric_key, row.fiscal_period, row.method, row.value, row.adjustment_basis, row.as_filed_on, row.share_basis]);

  await t.test("the 10-K's own EPS and share counts are as filed on its filing date, each with its share basis", async () => {
    assert.ok(await ingest(2024, "FY"));
    assert.deepEqual(await stored(), [
      ["eps_basic", "FY", "reported", "12.05", "as_filed", "2024-02-21", "basic"],
      ["eps_diluted", "FY", "reported", "11.93", "as_filed", "2024-02-21", "diluted"],
      ["net_income", "FY", "reported", "29760000000", "unadjusted", null, "not_applicable"],
      ["revenue", "FY", "reported", "60922000000", "unadjusted", null, "not_applicable"],
      ["revenue", "FY", "restated", "60900000000", "unadjusted", null, "not_applicable"],
      ["total_assets", "FY", "reported", "65728000000", "unadjusted", null, "not_applicable"],
      ["weighted_average_basic_shares", "FY", "reported", "2469000000", "as_filed", "2024-02-21", "basic"],
      ["weighted_average_diluted_shares", "FY", "reported", "2494000000", "as_filed", "2024-02-21", "diluted"],
    ], "the FY2025 10-K's split recast of FY2024 EPS and shares is no restatement; its revenue restatement is one");
  });

  await t.test("a 10-Q's EPS is as filed on its own date; its balance stays uncertified", async () => {
    assert.ok(await ingest(2025, "Q1"));
    const quarter = (await stored()).filter((row) => row[1] === "Q1" || row[3] === "85228000000");
    assert.deepEqual(quarter, [
      ["eps_basic", "Q1", "reported", "6.04", "as_filed", "2024-05-29", "basic"],
      ["eps_diluted", "Q1", "reported", "5.98", "as_filed", "2024-05-29", "diluted"],
      ["net_income", "Q1", "reported", "14881000000", "unadjusted", null, "not_applicable"],
      ["revenue", "Q1", "reported", "26044000000", "unadjusted", null, "not_applicable"],
      ["total_assets", "FY", "reported", "85228000000", null, null, null],
      ["weighted_average_basic_shares", "Q1", "reported", "2462000000", "as_filed", "2024-05-29", "basic"],
      ["weighted_average_diluted_shares", "Q1", "reported", "2489000000", "as_filed", "2024-05-29", "diluted"],
    ]);
  });

  await t.test("a share fact stored before it could be certified gains its context from the backfill, once", async () => {
    await db.query(
      `delete from fact_financial_contexts c using facts f, metrics m
        where c.fact_id = f.fact_id and m.metric_id = f.metric_id and f.subject_id = $1 and m.metric_key = any($2::text[])`,
      [ISSUER, SHARE_KEYS],
    );
    const shareContexts = async () => (await stored()).filter((row) => SHARE_KEYS.includes(row[0] as string)).map((row) => row.slice(1));
    assert.deepEqual((await shareContexts()).map((row) => row[3]), [null, null, null, null, null, null, null, null]);
    const backfill = () => backfillSecCompanionStatements(db, { issuerId: ISSUER, fetcher, sourceId: FALLBACK_SOURCE_ID, logger: { warn: () => {} } });
    assert.deepEqual(await backfill(), { periods: 2 });
    const certified = [
      ["FY", "reported", "12.05", "as_filed", "2024-02-21", "basic"],
      ["Q1", "reported", "6.04", "as_filed", "2024-05-29", "basic"],
      ["FY", "reported", "11.93", "as_filed", "2024-02-21", "diluted"],
      ["Q1", "reported", "5.98", "as_filed", "2024-05-29", "diluted"],
      ["FY", "reported", "2469000000", "as_filed", "2024-02-21", "basic"],
      ["Q1", "reported", "2462000000", "as_filed", "2024-05-29", "basic"],
      ["FY", "reported", "2494000000", "as_filed", "2024-02-21", "diluted"],
      ["Q1", "reported", "2489000000", "as_filed", "2024-05-29", "diluted"],
    ];
    assert.deepEqual(await shareContexts(), certified);
    await backfill();
    assert.deepEqual(await shareContexts(), certified, "a second backfill records nothing twice");
  });
});
