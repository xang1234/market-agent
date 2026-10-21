// A later 10-K's comparative for an as-filed EPS or share count (#387) is the
// same figure when the listing's splits between the two filing dates explain
// it, and adds nothing. When they do not, it is an economic restatement as
// filed on the later 10-K's date. When those splits are not known at ingest,
// it is stored unverified, and a backfill after `sync:splits` decides it.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import type { PolygonFetcher } from "../../market/src/adapters/polygon.ts";
import { POLYGON_MARKET_SOURCE_ID } from "../../market/src/provider-sources.ts";
import { syncListingSplits } from "../../market/src/split-repository.ts";
import { backfillSecCompanionStatements, createSecBackedStatementRepository } from "../src/sec-facts-repository.ts";
import { secCompanyFetcher } from "./fakes.ts";
import { selectFiscalYear } from "./financial-selection.ts";

const FALLBACK_SOURCE_ID = "36000000-0000-4000-8000-0000000003a9";
const SHARE_KEYS = ["eps_basic", "eps_diluted", "weighted_average_basic_shares", "weighted_average_diluted_shares"];
const CUTOFF = "2026-10-05T00:00:00.000Z";

type Filing = { accn: string; fy: number; fp: string; form: string; filed: string };
const value = (filing: Filing, start: string, end: string, token: string) => ({ start, end, val: Number(token), val_token: token, ...filing });

/**
 * NVDA-like: the FY2024 10-K filed 2024-02-21, before the 10-for-1 split of
 * 2024-06-10, and the FY2025 10-K filed 2025-02-26, which recasts FY2024's
 * per-share figures for the split and states its diluted EPS as `dilutedRecast`.
 */
function splitCorpFacts(cik: number, dilutedRecast: string) {
  const accession = (year: string, serial: string) => `${String(cik).padStart(10, "0")}-${year}-${serial}`;
  const k24: Filing = { accn: accession("24", "000029"), fy: 2024, fp: "FY", form: "10-K", filed: "2024-02-21" };
  const k25: Filing = { accn: accession("25", "000023"), fy: 2025, fp: "FY", form: "10-K", filed: "2025-02-26" };
  const units = (unit: string, original: string, recast: string, fy2025: string) => ({
    label: "",
    description: "",
    units: {
      [unit]: [
        value(k24, "2023-01-30", "2024-01-28", original),
        value(k25, "2023-01-30", "2024-01-28", recast),
        value(k25, "2024-01-29", "2025-01-26", fy2025),
      ],
    },
  });
  return {
    cik,
    entityName: `Split Corp ${cik}`,
    facts: {
      "us-gaap": {
        Revenues: units("USD", "60922000000", "60922000000", "130497000000"),
        NetIncomeLoss: units("USD", "29760000000", "29760000000", "72880000000"),
        EarningsPerShareBasic: units("USD/shares", "12.05", "1.21", "2.97"),
        EarningsPerShareDiluted: units("USD/shares", "11.93", dilutedRecast, "2.94"),
        WeightedAverageNumberOfSharesOutstandingBasic: units("shares", "2469000000", "24690000000", "24555000000"),
        WeightedAverageNumberOfDilutedSharesOutstanding: units("shares", "2494000000", "24940000000", "24804000000"),
      },
    },
  };
}

/** Polygon's split list, the same for every ticker: NVDA's 10-for-1. */
const polygon: PolygonFetcher = async (path) => ({
  status: "OK",
  results: [{ ticker: new URLSearchParams(path.slice(path.indexOf("?"))).get("ticker"), execution_date: "2024-06-10", split_from: 1, split_to: 10, id: "E-2024" }],
});

test("a later 10-K's comparative of an as-filed EPS or share count", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for share restatement coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-sec-share-restatement");
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at) values ($1, 'polygon_market', 'market_data', 'primary', 'licensed', now())`,
    [POLYGON_MARKET_SOURCE_ID],
  );

  let issuers = 0;
  /** An issuer whose FY2025 10-K states FY2024 diluted EPS as `dilutedRecast`, listed on XNAS when `listed`. */
  const splitCorp = async (dilutedRecast: string, listed: boolean) => {
    const n = ++issuers;
    const issuerId = `36000000-0000-4000-8000-0000000003${String(n).padStart(2, "0")}`;
    const listing = { listing_id: `36000000-0000-4000-8000-0000000004${String(n).padStart(2, "0")}`, ticker: `SPL${n}` };
    const cik = 1045810 + n;
    await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, $2, $3)`, [issuerId, `Split Corp ${cik}`, String(cik)]);
    const list = async () => {
      await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $1, 'common_stock')`, [issuerId]);
      await db.query(
        `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone) values ($1, $2, 'XNAS', $3, 'USD', 'America/New_York')`,
        [listing.listing_id, issuerId, listing.ticker],
      );
    };
    if (listed) await list();
    const options = {
      fetcher: secCompanyFetcher(() => splitCorpFacts(cik, dilutedRecast), { completed_at: "2026-10-01T15:00:00.000Z" }),
      sourceId: FALLBACK_SOURCE_ID,
      logger: { warn: () => {} },
    };
    return {
      issuerId,
      list,
      /** What `npm run sync:splits` does for the listing, fetching at `at`. */
      syncSplits: (at: string) => syncListingSplits(db, polygon, listing, () => new Date(at)),
      ingest: () => createSecBackedStatementRepository(db, options)
        .find({ issuer_id: issuerId, family: "income", basis: "as_reported", fiscal_year: 2024, fiscal_period: "FY" }),
      backfill: () => backfillSecCompanionStatements(db, { issuerId, ...options }),
    };
  };
  /** The FY2024 share figures a later 10-K stated, stored beside the originals. */
  const laterDisclosures = async (issuerId: string) => (await db.query(
    `select m.metric_key, f.value_num::text as value, c.as_filed_on::text as as_filed_on, c.disclosure_relation, c.share_basis,
            f.invalidated_at is null as active
       from facts f join metrics m on m.metric_id = f.metric_id join fact_financial_contexts c on c.fact_id = f.fact_id
      where f.subject_id = $1 and f.method = 'restated' and m.metric_key = any($2::text[])
      order by m.metric_key, f.created_at`,
    [issuerId, SHARE_KEYS],
  )).rows.map((row) => [row.metric_key, row.value, row.as_filed_on, row.disclosure_relation, row.share_basis, row.active]);
  const epsDiluted = async (issuerId: string) => Promise.all((["as_reported", "as_restated"] as const).map(async (basis) => {
    const selection = await selectFiscalYear(db, { issuerId, metricKey: "eps_diluted", fiscalYear: 2024 }, CUTOFF, basis);
    return selection.status === "selected" ? selection.input.candidate.value_text : selection.reason_code;
  }));
  const unverified = [
    ["eps_basic", "1.21", "2025-02-26", "unverified_restatement", "basic", true],
    ["eps_diluted", "1.19", "2025-02-26", "unverified_restatement", "diluted", true],
    ["weighted_average_basic_shares", "24690000000", "2025-02-26", "unverified_restatement", "basic", true],
    ["weighted_average_diluted_shares", "24940000000", "2025-02-26", "unverified_restatement", "diluted", true],
  ];
  const retired = (rows: unknown[][]) => rows.map((row) => [...row.slice(0, -1), false]);

  await t.test("a comparative the split explains adds nothing; one it does not is a restatement as filed on its 10-K's date", async () => {
    const explained = await splitCorp("1.19", true);
    await explained.syncSplits("2026-10-02T12:00:00.000Z");
    await explained.ingest();
    assert.deepEqual(await laterDisclosures(explained.issuerId), [], "11.93 / 10 is 1.193, which the FY2025 10-K presents as 1.19");
    assert.deepEqual(await epsDiluted(explained.issuerId), ["11.93", "11.93"]);

    const restated = await splitCorp("1.08", true);
    await restated.syncSplits("2026-10-02T12:00:00.000Z");
    await restated.ingest();
    assert.deepEqual(await laterDisclosures(restated.issuerId), [["eps_diluted", "1.08", "2025-02-26", "economic_restatement", "diluted", true]]);
    assert.deepEqual(await epsDiluted(restated.issuerId), ["11.93", "1.08"]);
  });

  await t.test("with no listing to read splits from, the comparative is unverified until a backfill after the sync decides it", async () => {
    const unlisted = await splitCorp("1.19", false);
    await unlisted.ingest();
    assert.deepEqual(await laterDisclosures(unlisted.issuerId), unverified);
    assert.deepEqual(await epsDiluted(unlisted.issuerId), ["11.93", "restatement_unverified"]);

    await unlisted.list();
    await unlisted.syncSplits("2026-10-02T12:00:00.000Z");
    await unlisted.backfill();
    assert.deepEqual(await laterDisclosures(unlisted.issuerId), retired(unverified));
    assert.deepEqual(await epsDiluted(unlisted.issuerId), ["11.93", "11.93"]);
    await unlisted.backfill();
    assert.deepEqual(await laterDisclosures(unlisted.issuerId), retired(unverified), "a second backfill changes nothing");
  });

  await t.test("splits last fetched before the later 10-K was filed leave it unverified until a fresh sync", async () => {
    const early = await splitCorp("1.08", true);
    await early.syncSplits("2025-01-15T12:00:00.000Z");
    await early.ingest();
    const stated = unverified.map((row) => (row[0] === "eps_diluted" ? [row[0], "1.08", ...row.slice(2)] : row));
    assert.deepEqual(await laterDisclosures(early.issuerId), stated);
    assert.deepEqual(await epsDiluted(early.issuerId), ["11.93", "restatement_unverified"]);

    await early.syncSplits("2026-10-02T12:00:00.000Z");
    await early.backfill();
    const decided = [...retired(stated).slice(0, 2), ["eps_diluted", "1.08", "2025-02-26", "economic_restatement", "diluted", true], ...retired(stated).slice(2)];
    assert.deepEqual(await laterDisclosures(early.issuerId), decided);
    assert.deepEqual(await epsDiluted(early.issuerId), ["11.93", "1.08"]);
    await early.backfill();
    assert.deepEqual(await laterDisclosures(early.issuerId), decided, "a second backfill changes nothing");
  });
});
