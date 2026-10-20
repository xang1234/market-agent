import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapDatabase, connectedClient, connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { GOLDEN_COMPANIES, SEC_FILING_SOURCE_ID, seedGoldenDataset } from "../../chat/test/golden/dataset.ts";
import { backfillSecStatements } from "../src/sec-statements-backfill-cli.ts";
import { secCompanyFetcher } from "./fakes.ts";

const LIVE_ISSUER_ID = "35000000-0000-4000-8000-000000000001";

test("the SEC statements backfill never fetches for the frozen golden dataset", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for backfill coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-sec-backfill-cli");
  const db = await connectedPool(t, databaseUrl);
  await seedGoldenDataset(await connectedClient(t, databaseUrl));
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Live Corp', '789019')`, [LIVE_ISSUER_ID]);
  await db.query(
    `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period,
                        value_num, unit, currency, scale, as_of, observed_at, source_id, method, verification_status, freshness_class, coverage_level, confidence)
     select 'issuer', $1, metric_id, 'fiscal_y', '2023-07-01', '2024-06-30', 2024, 'FY', 245122000000, 'currency', 'USD', 1,
            '2024-08-01T00:00:00Z', '2024-08-01T00:00:00Z', $2, 'reported', 'authoritative', 'filing_time', 'full', 1
       from metrics where metric_key = 'revenue'`,
    [LIVE_ISSUER_ID, SEC_FILING_SOURCE_ID],
  );
  const goldenIds = GOLDEN_COMPANIES.map((company) => company.issuer_id);
  const goldenFacts = async () => (await db.query(
    `select fact_id::text, value_num::text, invalidated_at from facts where subject_id = any($1::uuid[]) order by fact_id`,
    [goldenIds],
  )).rows;
  const before = await goldenFacts();
  const fetched: string[] = [];
  const fetcher = secCompanyFetcher(() => ({ cik: 789019, entityName: "Live Corp", facts: {} }));
  const quiet = { log: () => {}, warn: () => {}, error: () => {} };

  assert.deepEqual(await backfillSecStatements(db, async (path) => (fetched.push(path), fetcher(path)), [], quiet), { failures: 0 });
  assert.deepEqual(await backfillSecStatements(db, async (path) => (fetched.push(path), fetcher(path)), goldenIds, quiet), { failures: 0 });

  assert.deepEqual(fetched, ["/api/xbrl/companyfacts/CIK0000789019.json"]);
  assert.deepEqual(await goldenFacts(), before);
});
