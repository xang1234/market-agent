import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { createSecCompanyFactsHttpFetcher } from "../src/sec-edgar-http.ts";
import { SEC_NONCONTROLLING_INTEREST_CONCEPTS } from "../src/sec-edgar.ts";
import { backfillSecCompanionStatements, createSecBackedStatementRepository, hydrateSecIssuerLatestYears } from "../src/sec-facts-repository.ts";

const ISSUER_ID = "34200000-0000-4000-8000-000000000001";
const FALLBACK_SOURCE_ID = "34200000-0000-4000-8000-000000000003";
const CHECKED = [...SEC_NONCONTROLLING_INTEREST_CONCEPTS, "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"];

type Value = { start?: string; end: string; val: number; accn: string; fy: number; fp: string; form: string; filed: string };

// Each fiscal year's 10-K, filed the February after it ends.
const tenK = (fy: number) => ({ accn: `0000000342-${String(fy + 1).slice(2)}-000001`, fy, fp: "FY", form: "10-K", filed: `${fy + 1}-02-01` });
const year = (filing: number, of: number, val: number): Value => ({ start: `${of}-01-01`, end: `${of}-12-31`, val, ...tenK(filing) });
const yearEnd = (filing: number, of: number, val: number): Value => ({ end: `${of}-12-31`, val, ...tenK(filing) });

function companyFacts(byConcept: Record<string, Value[]>): string {
  return JSON.stringify({
    cik: 342,
    entityName: "Inference Corp",
    facts: { "us-gaap": Object.fromEntries(Object.entries(byConcept).map(([concept, values]) => [concept, { label: "", description: "", units: { USD: values } }])) },
  });
}

async function setUp(t: test.TestContext, name: string) {
  const { databaseUrl } = await bootstrapDatabase(t, name);
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Inference Corp', '342')`, [ISSUER_ID]);
  const download = { text: "" };
  const fetcher = createSecCompanyFactsHttpFetcher({
    userAgent: "market-agent-test test@example.invalid",
    fetchImpl: async () => new Response(download.text, { status: 200 }),
    clock: () => new Date("2026-03-01T00:00:00.000Z"),
  });
  const options = { fetcher, sourceId: FALLBACK_SOURCE_ID, clock: () => new Date("2026-03-01T00:00:00.000Z"), logger: { warn: () => {} } } as const;
  const lookup = (fiscal_year: number) => createSecBackedStatementRepository(db, options)
    .find({ issuer_id: ISSUER_ID, family: "income", basis: "as_reported", fiscal_year, fiscal_period: "FY" });
  const backfill = () => backfillSecCompanionStatements(db, { issuerId: ISSUER_ID, ...options });
  const netIncome = async () => (await db.query<{ fact_id: string; metric_key: string; fiscal_year: number; value: string; active: boolean; superseded_by: string | null; flags: unknown[]; proof: string | null }>(
    `select f.fact_id::text as fact_id, m.metric_key, f.fiscal_year, f.value_num::text as value, f.invalidated_at is null as active,
            f.superseded_by::text as superseded_by, f.quality_flags as flags,
            (select a.precision_class from current_fact_precision_attestations a where a.fact_id = f.fact_id) as proof
       from facts f join metrics m on m.metric_id = f.metric_id
      where f.subject_id = $1 and m.metric_key in ('net_income', 'net_income_consolidated')
      order by f.fiscal_year, m.metric_key, f.created_at`,
    [ISSUER_ID],
  )).rows;
  return { db, download, fetcher, options, lookup, backfill, netIncome };
}

const inferred = (concept: string) => [{ kind: "no_noncontrolling_interest", concept, checked: CHECKED }];

test("an inferred net income is stored with its basis, and a filing that reports noncontrolling interest for its period invalidates it (#342)", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for SEC ingestion coverage");
    return;
  }
  const { download, lookup, backfill, netIncome } = await setUp(t, "fin-sec-ni-inference");
  download.text = companyFacts({
    Revenues: [year(2023, 2023, 500), year(2024, 2023, 500), year(2024, 2024, 600)],
    NetIncomeLoss: [year(2023, 2023, 70), year(2024, 2023, 70), year(2024, 2024, 80)],
  });
  await lookup(2023);
  await lookup(2024);
  const summary = async () => (await netIncome()).map(({ metric_key, fiscal_year, value, active, flags, proof }) => [fiscal_year, metric_key, value, active, flags, proof]);
  assert.deepEqual(await summary(), [
    [2023, "net_income", "70", true, [], "source_token_preserved"],
    [2023, "net_income_consolidated", "70", true, inferred("NetIncomeLoss"), "source_token_preserved"],
    [2024, "net_income", "80", true, [], "source_token_preserved"],
    [2024, "net_income_consolidated", "80", true, inferred("NetIncomeLoss"), "source_token_preserved"],
  ]);

  // The FY2025 10-K shows a noncontrolling interest in 2024 as well.
  download.text = companyFacts({
    Revenues: [year(2023, 2023, 500), year(2024, 2023, 500), year(2024, 2024, 600), year(2025, 2024, 600), year(2025, 2025, 700)],
    NetIncomeLoss: [year(2023, 2023, 70), year(2024, 2023, 70), year(2024, 2024, 80), year(2025, 2024, 80), year(2025, 2025, 90)],
    ProfitLoss: [year(2025, 2024, 85), year(2025, 2025, 96)],
    NetIncomeLossAttributableToNoncontrollingInterest: [year(2025, 2024, 5), year(2025, 2025, 6)],
  });
  await lookup(2025);
  const revised = [
    [2023, "net_income", "70", true, [], "source_token_preserved"],
    [2023, "net_income_consolidated", "70", true, inferred("NetIncomeLoss"), "source_token_preserved"],
    [2024, "net_income", "80", true, [], "source_token_preserved"],
    [2024, "net_income_consolidated", "80", false, inferred("NetIncomeLoss"), "source_token_preserved"],
    [2025, "net_income", "90", true, [], "source_token_preserved"],
    [2025, "net_income_consolidated", "96", true, [], "source_token_preserved"],
  ];
  assert.deepEqual(await summary(), revised, "a lookup of another year revises the inference");
  await backfill();
  await backfill();
  assert.deepEqual(await summary(), revised, "the 2024 10-K states no consolidated figure, so it stays a gap");
});

test("a legacy net income stored from ProfitLoss is replaced with its basis, or retired where the filer reports noncontrolling interest (#342)", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for SEC ingestion coverage");
    return;
  }
  const { db, download, fetcher, options, lookup, backfill, netIncome } = await setUp(t, "fin-sec-ni-legacy");
  download.text = companyFacts({
    Revenues: [year(2023, 2023, 500), year(2024, 2024, 600)],
    ProfitLoss: [year(2023, 2023, 90), year(2024, 2024, 95)],
    MinorityInterest: [yearEnd(2024, 2024, 5)],
  });
  await lookup(2023);
  await lookup(2024);
  const [, inferredNetIncome] = await netIncome();
  assert.deepEqual(inferredNetIncome?.flags, inferred("ProfitLoss"));

  // What ingestion stored before #342: ProfitLoss as net income, with no
  // precision proof and no lineage, in both years.
  await db.query(`update facts set invalidated_at = now() where fact_id = $1`, [inferredNetIncome!.fact_id]);
  await db.query(
    `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period, value_num,
                        unit, currency, scale, as_of, reported_at, observed_at, source_id, method, definition_version,
                        verification_status, freshness_class, coverage_level, confidence, quality_flags)
     select f.subject_kind, f.subject_id, (select metric_id from metrics where metric_key = 'net_income'), f.period_kind, f.period_start,
            f.period_end, f.fiscal_year, f.fiscal_period, f.value_num, f.unit, f.currency, f.scale, f.as_of, f.reported_at, f.observed_at,
            f.source_id, f.method, f.definition_version, f.verification_status, f.freshness_class, f.coverage_level, f.confidence, '[]'::jsonb
       from facts f join metrics m on m.metric_id = f.metric_id
      where f.subject_id = $1 and m.metric_key = 'net_income_consolidated'`,
    [ISSUER_ID],
  );
  const legacy = (await netIncome()).filter((row) => row.metric_key === "net_income" && row.active);
  assert.deepEqual(legacy.map((row) => [row.fiscal_year, row.value, row.proof]), [[2023, "90", null], [2024, "95", null]]);

  await hydrateSecIssuerLatestYears(db, { issuerId: ISSUER_ID, reads: new Map([["net_income", 2]]), ...options, fetcher });
  assert.deepEqual(
    (await netIncome()).filter((row) => legacy.some((old) => old.fact_id === row.fact_id)).map((row) => [row.active, row.proof]),
    [[true, null], [true, null]],
    "a lookup never proves a legacy row in place of an inferred one",
  );

  await backfill();
  const repaired = (await netIncome()).filter((row) => row.metric_key === "net_income");
  const replacement = repaired.find((row) => row.active);
  assert.deepEqual(repaired.map(({ fiscal_year, value, active, flags, proof }) => [fiscal_year, value, active, flags, proof]), [
    [2023, "90", false, inferred("ProfitLoss"), "source_token_preserved"],
    [2023, "90", false, [], null],
    [2023, "90", true, inferred("ProfitLoss"), "source_token_preserved"],
    [2024, "95", false, [], null],
  ]);
  assert.equal(repaired[1]?.superseded_by, replacement?.fact_id, "the legacy 2023 row names its replacement");
  await backfill();
  assert.deepEqual((await netIncome()).filter((row) => row.metric_key === "net_income").map((row) => row.active), [false, false, true, false], "a rerun changes nothing");
});
