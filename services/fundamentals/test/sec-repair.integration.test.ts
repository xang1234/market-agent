import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { createSecCompanyFactsHttpFetcher } from "../src/sec-edgar-http.ts";
import { ELIGIBLE_FACT_SQL } from "../../evidence/src/financial-input-repo.ts";
import { backfillSecCompanionStatements, createSecBackedStatementRepository, hydrateSecIssuerLatestYears, retireGoldenFacts } from "../src/sec-facts-repository.ts";
import { loadUsableFacts } from "../src/usable-facts.ts";

const ISSUER_ID = "32000000-0000-4000-8000-000000000001";
const FALLBACK_SOURCE_ID = "32000000-0000-4000-8000-000000000003";

// AAPL's FY2024 10-K as data.sec.gov lists it: the two prior years first.
function companyFactsText(): string {
  const fy = (val: number, start: string, end: string) =>
    `{"start":"${start}","end":"${end}","val":${val},"accn":"0000320193-24-000123","fy":2024,"fp":"FY","form":"10-K","filed":"2024-11-01"}`;
  const years = (a: number, b: number, c: number) =>
    `[${fy(a, "2021-09-26", "2022-09-24")},${fy(b, "2022-09-25", "2023-09-30")},${fy(c, "2023-10-01", "2024-09-28")}]`;
  return `{"cik":320193,"entityName":"Apple Inc.","facts":{"us-gaap":{
    "RevenueFromContractWithCustomerExcludingAssessedTax":{"label":"","description":"","units":{"USD":${years(394328000000, 383285000000, 391035000000)}}},
    "NetIncomeLoss":{"label":"","description":"","units":{"USD":${years(99803000000, 96995000000, 93736000000)}}},
    "EarningsPerShareDiluted":{"label":"","description":"","units":{"USD/shares":${years(6.11, 6.13, 6.08)}}}
  }}}`;
}

test("the backfill replaces an income fact the old selector got wrong, keeping history at earlier cutoffs", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for repair coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-sec-repair");
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Apple Inc.', '320193')`, [ISSUER_ID]);
  let now = new Date("2024-11-02T00:00:00.000Z");
  const fetcher = createSecCompanyFactsHttpFetcher({
    userAgent: "market-agent-test test@example.invalid",
    fetchImpl: async () => new Response(companyFactsText(), { status: 200 }),
    clock: () => now,
  });
  const lookup = { issuer_id: ISSUER_ID, family: "income" as const, basis: "as_reported" as const, fiscal_year: 2024, fiscal_period: "FY" as const };
  await createSecBackedStatementRepository(db, {
    fetcher,
    sourceId: FALLBACK_SOURCE_ID,
    clock: () => new Date("2024-11-02T00:00:00.000Z"),
    logger: { warn: () => {} },
  }).find(lookup);

  // What the old selector stored: the 10-K's oldest comparative as FY2024.
  await db.query(
    `update facts f set value_num = 394328000000, period_start = '2021-09-26', period_end = '2022-09-24'
       from metrics m where m.metric_id = f.metric_id and m.metric_key = 'revenue' and f.subject_id = $1`,
    [ISSUER_ID],
  );
  const factOf = async (metricKey: string) => (await db.query<{ fact_id: string; value: string; invalidated: boolean; superseded_by: string | null }>(
    `select f.fact_id::text as fact_id, f.value_num::text as value, f.invalidated_at is not null as invalidated, f.superseded_by::text as superseded_by
       from facts f join metrics m on m.metric_id = f.metric_id
      where f.subject_id = $1 and m.metric_key = $2 order by f.created_at`,
    [ISSUER_ID, metricKey],
  )).rows;
  const [wrong] = await factOf("revenue");
  const [netIncome] = await factOf("net_income");
  // Stored before ingestion recorded financial contexts.
  await db.query(`delete from fact_financial_contexts where fact_id = $1`, [netIncome!.fact_id]);

  now = new Date("2024-12-01T00:00:00.000Z");
  const backfill = () => backfillSecCompanionStatements(db, {
    issuerId: ISSUER_ID,
    fetcher,
    sourceId: FALLBACK_SOURCE_ID,
    clock: () => new Date("2024-12-01T00:00:00.000Z"),
    logger: { warn: () => {} },
  });
  await backfill();
  const contexts = async () => (await db.query(
    `select m.metric_key, c.disclosure_relation, c.adjustment_basis, c.as_filed_on::text as as_filed_on, c.share_basis
       from fact_financial_contexts c join facts f on f.fact_id = c.fact_id join metrics m on m.metric_id = f.metric_id
      where f.subject_id = $1 and f.invalidated_at is null order by m.metric_key`,
    [ISSUER_ID],
  )).rows;
  // EPS is on the split basis of the 10-K's filing date.
  assert.deepEqual(await contexts(), [
    { metric_key: "eps_diluted", disclosure_relation: "original", adjustment_basis: "as_filed", as_filed_on: "2024-11-01", share_basis: "diluted" },
    { metric_key: "net_income", disclosure_relation: "original", adjustment_basis: "unadjusted", as_filed_on: null, share_basis: "not_applicable" },
    { metric_key: "net_income_consolidated", disclosure_relation: "original", adjustment_basis: "unadjusted", as_filed_on: null, share_basis: "not_applicable" },
    { metric_key: "revenue", disclosure_relation: "original", adjustment_basis: "unadjusted", as_filed_on: null, share_basis: "not_applicable" },
  ]);
  await backfill();
  assert.deepEqual((await contexts()).length, 4, "a second backfill records no context twice");

  const revenue = await factOf("revenue");
  assert.equal(revenue.length, 2);
  const replacement = revenue.find((row) => !row.invalidated)!;
  assert.equal(replacement.value, "391035000000");
  assert.deepEqual(revenue.find((row) => row.fact_id === wrong!.fact_id), { ...wrong, invalidated: true, superseded_by: replacement.fact_id });
  // A fact that was right is left as it was.
  assert.deepEqual(await factOf("net_income"), [netIncome]);

  // Reads now see the replacement; a snapshot cut before the repair still sees what was known then.
  const usable = (cutoff?: string) => loadUsableFacts(db, {
    subjectKind: "issuer",
    subjectIds: [ISSUER_ID],
    metricKeys: ["revenue"],
    ...(cutoff ? { cutoff } : {}),
  });
  assert.deepEqual((await usable()).map((fact) => fact.value_num), [391035000000]);
  assert.deepEqual((await usable("2024-11-15T00:00:00.000Z")).map((fact) => fact.value_num), [394328000000]);
  const reread = await createSecBackedStatementRepository(db, { fetcher: null, sourceId: FALLBACK_SOURCE_ID }).find(lookup);
  assert.equal(reread?.lines.find((line) => line.metric_key === "revenue")?.value_num, 391035000000);
  // A statement read back from facts keeps its dates in any local time zone.
  assert.equal(reread?.period_start, "2023-10-01");
  assert.equal(reread?.period_end, "2024-09-28");
});

test("a filing retires the golden dataset's figure for its period on a live issuer, and a statement read at the golden cutoff still returns it (#597)", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for repair coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-sec-golden-retire");
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  // repair:issuer-splits kept AAPL's live issuer and moved the golden dataset's figures onto it. They are FY2024's revenue, FY2024's
  // gross profit, which this filing does not report, and revenue for a year SEC has not filed.
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Apple Inc', '320193')`, [ISSUER_ID]);
  const goldenAsOf = "2026-09-01T00:00:00.000Z";
  await db.query(
    `with golden as (
       insert into sources (provider, kind, trust_tier, license_class, retrieved_at) values ('golden_fixture', 'filing', 'primary', 'internal', $2)
       returning source_id)
     insert into facts (subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period, value_num, unit, currency,
                        scale, as_of, reported_at, observed_at, source_id, method, verification_status, freshness_class, coverage_level, confidence)
     select 'issuer', $1, m.metric_id, 'fiscal_y', y.period_start, y.period_end, y.fiscal_year, 'FY', y.value_num, 'currency', 'USD',
            1, $2, $2, $2, golden.source_id, 'reported', 'authoritative', 'filing_time', 'full', 1
       from golden,
            (values ('revenue', '2023-10-01'::date, '2024-09-28'::date, 2024, 400000000000), ('gross_profit', '2023-10-01', '2024-09-28', 2024, 180000000000),
                    ('revenue', '2025-09-28', '2026-09-26', 2026, 450000000000)) as y(metric_key, period_start, period_end, fiscal_year, value_num)
       join metrics m using (metric_key)`,
    [ISSUER_ID, goldenAsOf],
  );
  const ingestedAt = new Date("2026-11-19T00:00:00.000Z");
  const fetcher = createSecCompanyFactsHttpFetcher({
    userAgent: "market-agent-test test@example.invalid",
    fetchImpl: async () => new Response(companyFactsText(), { status: 200 }),
    clock: () => ingestedAt,
  });

  await hydrateSecIssuerLatestYears(db, {
    issuerId: ISSUER_ID,
    reads: new Map([["revenue", 1]]),
    fetcher,
    sourceId: FALLBACK_SOURCE_ID,
    clock: () => ingestedAt,
    logger: { warn: () => {} },
  });

  // The figures the financial engine may choose from, by year.
  const candidates = async () => (await db.query(
    `select f.fiscal_year, m.metric_key, f.value_num::text as value, s.provider
       from facts f join sources s using (source_id) join metrics m on m.metric_id = f.metric_id
      where f.subject_id = $1 and m.metric_key in ('revenue', 'gross_profit') and ${ELIGIBLE_FACT_SQL}
      order by f.fiscal_year, m.metric_key`,
    [ISSUER_ID],
  )).rows;
  assert.deepEqual(await candidates(), [
    { fiscal_year: 2024, metric_key: "gross_profit", value: "180000000000", provider: "golden_fixture" },
    { fiscal_year: 2024, metric_key: "revenue", value: "391035000000", provider: "sec_edgar" },
    { fiscal_year: 2026, metric_key: "revenue", value: "450000000000", provider: "golden_fixture" },
  ]);
  const revenueAt = async (cutoff?: string) => (await createSecBackedStatementRepository(db, { fetcher: null, sourceId: FALLBACK_SOURCE_ID, ...(cutoff ? { cutoff } : {}) })
    .find({ issuer_id: ISSUER_ID, family: "income", basis: "as_reported", fiscal_year: 2024, fiscal_period: "FY" }))
    ?.lines.find((line) => line.metric_key === "revenue")?.value_num;
  assert.equal(await revenueAt(), 391035000000);
  assert.equal(await revenueAt(goldenAsOf), 400000000000, "a statement read at the golden cutoff returns what was known then");

  await hydrateSecIssuerLatestYears(db, {
    issuerId: ISSUER_ID,
    reads: new Map([["revenue", 1]]),
    fetcher,
    sourceId: FALLBACK_SOURCE_ID,
    clock: () => ingestedAt,
    logger: { warn: () => {} },
  });
  assert.equal((await candidates()).length, 3, "a second ingest retires nothing more");
});

test("a golden figure retires only for an active reported SEC figure of its metric, period kind and fiscal period (#597)", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for repair coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-sec-golden-retire-guards");
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Apple Inc', '320193')`, [ISSUER_ID]);
  const source = async (provider: string) => (await db.query<{ source_id: string }>(
    `insert into sources (provider, kind, trust_tier, license_class, retrieved_at) values ($1, 'filing', 'primary', 'public', now()) returning source_id::text as source_id`,
    [provider],
  )).rows[0]!.source_id;
  const golden = await source("golden_fixture");
  const sec = await source("sec_edgar");
  const fact = (sourceId: string, metricKey: string, periodKind: string, fiscalPeriod: string, method: string, invalidated = false) =>
    db.query(
      `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_end, fiscal_year, fiscal_period, value_num, unit, currency, scale,
                          as_of, observed_at, source_id, method, verification_status, freshness_class, coverage_level, confidence, invalidated_at)
       select 'issuer', $1, metric_id, $3, '2024-09-28', 2024, $4, 1, 'currency', 'USD', 1, now(), now(), $5, $6, 'authoritative', 'filing_time', 'full', 1,
              case when $7 then now() end
         from metrics where metric_key = $2`,
      [ISSUER_ID, metricKey, periodKind, fiscalPeriod, sourceId, method, invalidated],
    );
  await fact(golden, "revenue", "fiscal_y", "FY", "reported");
  await fact(golden, "net_income", "fiscal_y", "FY", "reported");
  // Each SEC revenue figure differs from the golden one in one way, so none retires it.
  await fact(sec, "revenue", "fiscal_y", "Q4", "reported");
  await fact(sec, "revenue", "fiscal_q", "FY", "reported");
  await fact(sec, "revenue", "fiscal_y", "FY", "derived");
  await fact(sec, "revenue", "fiscal_y", "FY", "reported", true);
  await fact(sec, "net_income", "fiscal_y", "FY", "reported");

  await retireGoldenFacts(db, ISSUER_ID);

  const { rows } = await db.query(
    `select m.metric_key, f.invalidated_at is null as active, f.superseded_by is not null as superseded
       from facts f join metrics m using (metric_id) where f.source_id = $1 order by 1`,
    [golden],
  );
  assert.deepEqual(rows, [
    { metric_key: "net_income", active: false, superseded: true },
    { metric_key: "revenue", active: true, superseded: false },
  ]);
});
