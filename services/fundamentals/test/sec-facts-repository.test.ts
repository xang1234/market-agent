import test from "node:test";
import assert from "node:assert/strict";
import {
  backfillSecCompanionStatements,
  createSecBackedStatementRepository,
  createSecBackedStatsRepository,
  hydrateSecIssuer,
  hydrateSecIssuerLatestYears,
} from "../src/sec-facts-repository.ts";
import type { MetricDefinition } from "../src/metric-mapper.ts";
import {
  SecEdgarFetchError,
  type SecEdgarFetcher,
  type SecConceptValue,
} from "../src/sec-edgar.ts";
import { FundamentalsDataUnavailableError } from "../src/availability.ts";
import { secCompanyFetcher } from "./fakes.ts";
import { GOLDEN_ISSUER_IDS } from "../../shared/src/golden-issuers.ts";

const ISSUER_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";

test("SEC-backed statements persist companyfacts and repeat reads from facts", async () => {
  const db = new FakeFundamentalsDb();
  let fetchCount = 0;
  const fetcher: SecEdgarFetcher = secCompanyFetcher(() => {
    fetchCount += 1;
    return companyFacts();
  });
  const statements = createSecBackedStatementRepository(db, {
    fetcher,
    sourceId: SOURCE_ID,
    clock: () => new Date("2026-05-08T00:00:00.000Z"),
  });

  const first = await statements.find({
    issuer_id: ISSUER_ID,
    family: "income",
    basis: "as_reported",
    fiscal_year: 2024,
    fiscal_period: "FY",
  });
  assert.equal(first?.lines.find((line) => line.metric_key === "revenue")?.value_num, 1000);
  assert.equal(db.facts.length > 0, true);
  assert.match(first?.source_id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(db.facts.every((fact) => fact.source_id === first?.source_id), true);
  assert.equal(
    db.sources[0]?.[3],
    "https://www.sec.gov/Archives/edgar/data/320193/000032019325000001/0000320193-25-000001-index.htm",
  );

  const factCount = db.facts.length;
  const second = await statements.find({
    issuer_id: ISSUER_ID,
    family: "income",
    basis: "as_reported",
    fiscal_year: 2024,
    fiscal_period: "FY",
  });
  assert.equal(second?.lines.find((line) => line.metric_key === "revenue")?.value_num, 1000);
  assert.equal(db.facts.length, factCount);
  assert.equal(fetchCount, 1);
});

test("SEC-backed statements store the filing's cash flow and balance sheet beside its income statement", async () => {
  const db = new FakeFundamentalsDb();
  const facts = companyFacts();
  const usGaap = facts.facts["us-gaap"] as Record<string, unknown>;
  usGaap.NetCashProvidedByUsedInOperatingActivities = annualUsd(300, 250);
  usGaap.PaymentsToAcquirePropertyPlantAndEquipment = annualUsd(50, 40);
  usGaap.Assets = annualInstant(5000, 4000);
  usGaap.CashAndCashEquivalentsAtCarryingValue = annualInstant(700, 600);
  const statements = createSecBackedStatementRepository(db, {
    fetcher: secCompanyFetcher(() => facts),
    sourceId: SOURCE_ID,
    clock: () => new Date("2026-05-08T00:00:00.000Z"),
  });

  const income = await statements.find({
    issuer_id: ISSUER_ID,
    family: "income",
    basis: "as_reported",
    fiscal_year: 2024,
    fiscal_period: "FY",
  });

  assert.equal(income?.family, "income");
  const stored = (key: string) => db.facts.find((fact) => metricKeyFor(db.metrics, fact.metric_id) === key);
  assert.equal(stored("operating_cash_flow")?.value_num, 300);
  assert.equal(stored("operating_cash_flow")?.period_kind, "fiscal_y");
  assert.equal(stored("capex")?.value_num, 50);
  assert.equal(stored("total_assets")?.value_num, 5000);
  assert.equal(stored("total_assets")?.period_kind, "point");
  assert.equal(stored("total_assets")?.period_start, null);
  assert.equal(stored("total_assets")?.period_end, "2024-12-31");
  assert.equal(stored("cash_and_equivalents")?.value_num, 700);
  // One filing, one source, one transaction.
  assert.equal(db.facts.every((fact) => fact.source_id === income?.source_id), true);
  assert.deepEqual(db.transactions, ["begin", "commit"]);
});

// Real NVDA values: Q2 FY2026 cash flow is the Q2 10-Q's six months less the
// Q1 10-Q's three, so the stored quarter names both filings.
test("a discrete quarter derived across filings records each filing in its lineage", async () => {
  const db = new FakeFundamentalsDb();
  const q1 = { fy: 2026, fp: "Q1", form: "10-Q", accn: "0001045810-25-000116", filed: "2025-05-28" };
  const q2 = { fy: 2026, fp: "Q2", form: "10-Q", accn: "0001045810-25-000209", filed: "2025-08-27" };
  const usd = (values: SecConceptValue[]) => ({ label: "", description: "", units: { USD: values } });
  const facts = {
    cik: 1045810,
    entityName: "NVIDIA Corp",
    facts: {
      "us-gaap": {
        Revenues: usd([
          { ...q1, start: "2025-01-27", end: "2025-04-27", val: 44_062_000_000 },
          { ...q2, start: "2025-04-28", end: "2025-07-27", val: 46_743_000_000 },
        ]),
        NetCashProvidedByUsedInOperatingActivities: usd([
          { ...q1, start: "2025-01-27", end: "2025-04-27", val: 27_414_000_000 },
          { ...q2, start: "2025-01-27", end: "2025-07-27", val: 42_779_000_000 },
        ]),
      },
    },
  };
  const statements = createSecBackedStatementRepository(db, {
    fetcher: secCompanyFetcher(() => facts),
    sourceId: SOURCE_ID,
    clock: () => new Date("2026-05-08T00:00:00.000Z"),
  });

  await statements.find({ issuer_id: ISSUER_ID, family: "income", basis: "as_reported", fiscal_year: 2026, fiscal_period: "Q2" });

  const ocf = db.facts.find((fact) => metricKeyFor(db.metrics, fact.metric_id) === "operating_cash_flow");
  assert.equal(ocf?.value_num, 15_365_000_000);
  const [lineage] = ocf!.quality_flags as Array<{ kind: string; input_source_ids: string[]; inputs: Array<{ accn: string; source_id: string }> }>;
  assert.equal(lineage?.kind, "sec_period_difference");
  assert.deepEqual(lineage!.inputs.map((input) => input.accn), [q2.accn, q1.accn]);
  // The fact's own source is the Q2 filing; the Q1 filing is a source too.
  assert.equal(lineage!.input_source_ids.length, 2);
  assert.ok(lineage!.input_source_ids.includes(ocf!.source_id));
  const registered = new Set(db.sources.map((source) => source[0]));
  for (const id of lineage!.input_source_ids) assert.ok(registered.has(id), `source ${id} is registered`);
  // A value filed as is carries no lineage.
  const revenue = db.facts.find((fact) => metricKeyFor(db.metrics, fact.metric_id) === "revenue");
  assert.deepEqual(revenue?.quality_flags, []);
});

test("the backfill stores cash flow and balance sheet for income periods already on file", async () => {
  const db = new FakeFundamentalsDb();
  // The income statement was stored before the other families were ingested.
  await createSecBackedStatementRepository(db, {
    fetcher: secCompanyFetcher(() => companyFacts()),
    sourceId: SOURCE_ID,
    clock: () => new Date("2026-05-08T00:00:00.000Z"),
  }).find({ issuer_id: ISSUER_ID, family: "income", basis: "as_reported", fiscal_year: 2024, fiscal_period: "FY" });
  const stored = (key: string) => db.facts.filter((fact) => metricKeyFor(db.metrics, fact.metric_id) === key);
  assert.equal(stored("operating_cash_flow").length, 0);

  const facts = companyFacts();
  const usGaap = facts.facts["us-gaap"] as Record<string, unknown>;
  usGaap.NetCashProvidedByUsedInOperatingActivities = annualUsd(300, 250);
  usGaap.Assets = annualInstant(5000, 4000);
  let fetches = 0;
  let ticks = 0;
  const result = await backfillSecCompanionStatements(db, {
    issuerId: ISSUER_ID,
    fetcher: secCompanyFetcher(() => {
      fetches += 1;
      return facts;
    }, { completed_at: "2026-05-09T10:05:00.000Z" }),
    sourceId: SOURCE_ID,
    clock: () => new Date(Date.parse("2026-05-09T11:00:00.000Z") + 60_000 * ticks++),
  });

  assert.deepEqual(result, { periods: 1 });
  assert.equal(fetches, 1);
  assert.equal(stored("operating_cash_flow")[0]?.value_num, 300);
  // Every stored family is dated by the download's completion, not by processing time.
  assert.deepEqual(
    [stored("operating_cash_flow")[0]?.as_of, stored("total_assets")[0]?.as_of, db.sources.at(-1)?.[6]],
    ["2026-05-09T10:05:00.000Z", "2026-05-09T10:05:00.000Z", "2026-05-09T10:05:00.000Z"],
  );
  assert.equal(stored("total_assets")[0]?.period_end, "2024-12-31");
  // The income statement is not written again.
  assert.equal(stored("revenue").length, 1);
});

// Before the selection fix, an annual lookup stored a 10-K's oldest comparative
// (AAPL FY2024 read FY2022's revenue). Those facts are read without a download,
// and a re-ingestion conflicts with them, so the backfill replaces them.
test("the backfill replaces income facts the old period selector got wrong, keeping the right ones", async () => {
  const db = new FakeFundamentalsDb();
  await createSecBackedStatementRepository(db, {
    fetcher: secCompanyFetcher(() => companyFacts()),
    sourceId: SOURCE_ID,
    clock: () => new Date("2026-05-08T00:00:00.000Z"),
  }).find({ issuer_id: ISSUER_ID, family: "income", basis: "as_reported", fiscal_year: 2024, fiscal_period: "FY" });
  const revenueOf = () => db.facts.filter((fact) => metricKeyFor(db.metrics, fact.metric_id) === "revenue");
  // Simulate the old selector: FY2024 revenue stored with the prior year's value and dates.
  const [stored] = revenueOf();
  Object.assign(stored!, { value_num: 800, period_start: "2023-01-01", period_end: "2023-12-31" });
  const netIncomeBefore = db.facts.find((fact) => metricKeyFor(db.metrics, fact.metric_id) === "net_income")!;

  await backfillSecCompanionStatements(db, {
    issuerId: ISSUER_ID,
    fetcher: secCompanyFetcher(() => companyFacts()),
    sourceId: SOURCE_ID,
    clock: () => new Date("2026-05-09T00:00:00.000Z"),
  });

  const active = revenueOf().filter((fact) => fact.invalidated_at === null);
  assert.equal(active.length, 1);
  assert.equal(active[0]!.value_num, 1000);
  assert.equal(active[0]!.period_end, "2024-12-31");
  // The wrong fact is retired, not deleted, and points at its replacement.
  assert.notEqual(stored!.invalidated_at, null);
  assert.equal(stored!.superseded_by, active[0]!.fact_id);
  // A fact that was right is left as it was.
  assert.equal(netIncomeBefore.invalidated_at, null);
  assert.equal(db.facts.filter((fact) => metricKeyFor(db.metrics, fact.metric_id) === "net_income").length, 1);
  // Lookups read the replacement.
  const reread = await createSecBackedStatementRepository(db, { fetcher: null, sourceId: SOURCE_ID })
    .find({ issuer_id: ISSUER_ID, family: "income", basis: "as_reported", fiscal_year: 2024, fiscal_period: "FY" });
  assert.equal(reread?.lines.find((line) => line.metric_key === "revenue")?.value_num, 1000);
});

test("the backfill retires every wrong row of a metric, whichever filing stored it", async () => {
  const db = new FakeFundamentalsDb();
  await createSecBackedStatementRepository(db, {
    fetcher: secCompanyFetcher(() => companyFacts()),
    sourceId: SOURCE_ID,
    clock: () => new Date("2026-05-08T00:00:00.000Z"),
  }).find({ issuer_id: ISSUER_ID, family: "income", basis: "as_reported", fiscal_year: 2024, fiscal_period: "FY" });
  const revenueOf = () => db.facts.filter((fact) => metricKeyFor(db.metrics, fact.metric_id) === "revenue");
  // Two wrong rows for FY2024 revenue: one on the 10-K's own source (the
  // identity a replacement would conflict with), one on another filing's.
  const [onTarget] = revenueOf();
  Object.assign(onTarget!, { value_num: 800, period_start: "2023-01-01", period_end: "2023-12-31" });
  const otherFiling = { ...onTarget!, fact_id: crypto.randomUUID(), source_id: "33333333-3333-4333-8333-333333333333", value_num: 700 };
  db.facts.push(otherFiling);

  await backfillSecCompanionStatements(db, {
    issuerId: ISSUER_ID,
    fetcher: secCompanyFetcher(() => companyFacts()),
    sourceId: SOURCE_ID,
    clock: () => new Date("2026-05-09T00:00:00.000Z"),
  });

  const active = revenueOf().filter((fact) => fact.invalidated_at === null);
  assert.deepEqual(active.map((fact) => fact.value_num), [1000]);
  for (const retired of [onTarget!, otherFiling]) {
    assert.notEqual(retired.invalidated_at, null);
    assert.equal(retired.superseded_by, active[0]!.fact_id);
  }
});

test("the backfill retires a wrong income fact whose metric the filing no longer yields for the period", async () => {
  const db = new FakeFundamentalsDb();
  await createSecBackedStatementRepository(db, {
    fetcher: secCompanyFetcher(() => companyFacts()),
    sourceId: SOURCE_ID,
    clock: () => new Date("2026-05-08T00:00:00.000Z"),
  }).find({ issuer_id: ISSUER_ID, family: "income", basis: "as_reported", fiscal_year: 2024, fiscal_period: "FY" });
  // companyFacts() reports no operating expenses: rows for them came from the old
  // selector, one with the prior year's dates and one with this year's.
  const [revenue] = db.facts.filter((fact) => metricKeyFor(db.metrics, fact.metric_id) === "revenue");
  const opexId = db.metrics.find((metric) => metric.metric_key === "operating_expenses")!.metric_id;
  const contradicted = { ...revenue!, fact_id: crypto.randomUUID(), metric_id: opexId, value_num: 50, period_start: "2023-01-01", period_end: "2023-12-31" };
  db.facts.push(contradicted);

  await backfillSecCompanionStatements(db, {
    issuerId: ISSUER_ID,
    fetcher: secCompanyFetcher(() => companyFacts()),
    sourceId: SOURCE_ID,
    clock: () => new Date("2026-05-09T00:00:00.000Z"),
  });
  // Contradicting the period's dates, it is retired, with nothing to supersede it.
  assert.notEqual(contradicted.invalidated_at, null);
  assert.equal(contradicted.superseded_by, null);

  // One agreeing with the period's dates is not contradicted, so it stays.
  const agreeing = { ...revenue!, fact_id: crypto.randomUUID(), metric_id: opexId, value_num: 60, invalidated_at: null, superseded_by: null };
  db.facts.push(agreeing);
  await backfillSecCompanionStatements(db, {
    issuerId: ISSUER_ID,
    fetcher: secCompanyFetcher(() => companyFacts()),
    sourceId: SOURCE_ID,
    clock: () => new Date("2026-05-10T00:00:00.000Z"),
  });
  assert.equal(agreeing.invalidated_at, null);
});

test("the backfill downloads nothing for an issuer with no income periods on file", async () => {
  let fetches = 0;
  const result = await backfillSecCompanionStatements(new FakeFundamentalsDb(), {
    issuerId: ISSUER_ID,
    fetcher: secCompanyFetcher(() => {
      fetches += 1;
      return companyFacts();
    }),
    sourceId: SOURCE_ID,
  });
  assert.deepEqual(result, { periods: 0 });
  assert.equal(fetches, 0);
});

test("SEC-backed statements keep the income statement when another family cannot be extracted", async () => {
  const db = new FakeFundamentalsDb();
  const facts = companyFacts();
  const usGaap = facts.facts["us-gaap"] as Record<string, unknown>;
  usGaap.NetCashProvidedByUsedInOperatingActivities = annualUsd(300, 250);
  // A second concept for another period: the family's periods disagree.
  const capex = annualUsd(50, 40);
  capex.units.USD[0] = { ...capex.units.USD[0]!, start: "2023-12-25" };
  usGaap.PaymentsToAcquirePropertyPlantAndEquipment = capex;
  const warnings: unknown[][] = [];
  const statements = createSecBackedStatementRepository(db, {
    fetcher: secCompanyFetcher(() => facts),
    sourceId: SOURCE_ID,
    clock: () => new Date("2026-05-08T00:00:00.000Z"),
    logger: { warn: (...args: unknown[]) => warnings.push(args) },
  });

  const income = await statements.find({
    issuer_id: ISSUER_ID,
    family: "income",
    basis: "as_reported",
    fiscal_year: 2024,
    fiscal_period: "FY",
  });

  assert.equal(income?.lines.find((line) => line.metric_key === "revenue")?.value_num, 1000);
  assert.equal(db.facts.some((fact) => metricKeyFor(db.metrics, fact.metric_id) === "operating_cash_flow"), false);
  assert.equal(warnings.length, 1);
  assert.match(String((warnings[0]![1] as { error: string }).error), /disagrees/);
  assert.equal((warnings[0]![1] as { family: string }).family, "cashflow");
});

test("SEC-backed statements persist quarterly companyfacts as fiscal_q facts", async () => {
  const db = new FakeFundamentalsDb();
  let fetchCount = 0;
  const statements = createSecBackedStatementRepository(db, {
    fetcher: secCompanyFetcher(() => {
      fetchCount += 1;
      return quarterlyCompanyFacts();
    }),
    sourceId: SOURCE_ID,
    clock: () => new Date("2026-05-08T00:00:00.000Z"),
  });

  const first = await statements.find({
    issuer_id: ISSUER_ID,
    family: "income",
    basis: "as_reported",
    fiscal_year: 2024,
    fiscal_period: "Q2",
  });

  assert.equal(first?.period_kind, "fiscal_q");
  assert.equal(first?.period_start, "2023-12-31");
  assert.equal(first?.period_end, "2024-03-30");
  assert.equal(first?.lines.find((line) => line.metric_key === "revenue")?.value_num, 90_753_000_000);
  assert.equal(db.facts.every((fact) => fact.period_kind === "fiscal_q"), true);
  assert.equal(db.facts.every((fact) => fact.fiscal_period === "Q2"), true);

  const factCount = db.facts.length;
  const second = await statements.find({
    issuer_id: ISSUER_ID,
    family: "income",
    basis: "as_reported",
    fiscal_year: 2024,
    fiscal_period: "Q2",
  });

  assert.equal(second?.lines.find((line) => line.metric_key === "revenue")?.value_num, 90_753_000_000);
  assert.equal(second?.period_kind, "fiscal_q");
  assert.equal(second?.period_start, "2023-12-31");
  assert.equal(second?.period_end, "2024-03-30");
  assert.equal(db.facts.length, factCount);
  assert.equal(fetchCount, 1);
});

test("SEC-backed quarterly statements choose a discrete accession over a YTD-heavy accession", async () => {
  const db = new FakeFundamentalsDb();
  const statements = createSecBackedStatementRepository(db, {
    fetcher: secCompanyFetcher(() => mixedQuarterlyAccessionCompanyFacts()),
    sourceId: SOURCE_ID,
    clock: () => new Date("2026-05-08T00:00:00.000Z"),
  });

  const statement = await statements.find({
    issuer_id: ISSUER_ID,
    family: "income",
    basis: "as_reported",
    fiscal_year: 2024,
    fiscal_period: "Q2",
  });

  assert.equal(statement?.period_kind, "fiscal_q");
  assert.equal(statement?.period_start, "2023-12-31");
  assert.equal(statement?.period_end, "2024-03-30");
  assert.equal(statement?.lines.find((line) => line.metric_key === "revenue")?.value_num, 90_753_000_000);
  assert.equal(
    db.sources[0]?.[3],
    "https://www.sec.gov/Archives/edgar/data/320193/000032019324000020/0000320193-24-000020-index.htm",
  );
});

test("SEC-backed statements derive Q4 from annual and first-three-quarter companyfacts", async () => {
  const db = new FakeFundamentalsDb();
  const statements = createSecBackedStatementRepository(db, {
    fetcher: secCompanyFetcher(() => fourthQuarterCompanyFacts()),
    sourceId: SOURCE_ID,
    clock: () => new Date("2026-05-08T00:00:00.000Z"),
  });

  const statement = await statements.find({
    issuer_id: ISSUER_ID,
    family: "income",
    basis: "as_reported",
    fiscal_year: 2024,
    fiscal_period: "Q4",
  });

  assert.equal(statement?.period_kind, "fiscal_q");
  assert.equal(statement?.period_start, "2024-10-01");
  assert.equal(statement?.period_end, "2024-12-31");
  assert.equal(statement?.lines.find((line) => line.metric_key === "revenue")?.value_num, 400);
  assert.equal(
    db.sources[0]?.[3],
    "https://www.sec.gov/Archives/edgar/data/320193/000032019325000001/0000320193-25-000001-index.htm",
  );
});

test("SEC-backed statements derive distinct source ids from full accessions with shared CIK/year prefix", async () => {
  const sourceA = await statementSourceIdFor(companyFactsWithAccession("0000320193-25-000001"));
  const sourceB = await statementSourceIdFor(companyFactsWithAccession("0000320193-25-000002"));

  assert.notEqual(sourceA, sourceB);
});

test("SEC-backed statements only persist facts from the selected filing accession", async () => {
  const db = new FakeFundamentalsDb();
  const statements = createSecBackedStatementRepository(db, {
    fetcher: secCompanyFetcher(() => mixedAccessionCompanyFacts()),
    sourceId: SOURCE_ID,
    clock: () => new Date("2026-05-08T00:00:00.000Z"),
  });

  const statement = await statements.find({
    issuer_id: ISSUER_ID,
    family: "income",
    basis: "as_reported",
    fiscal_year: 2024,
    fiscal_period: "FY",
  });

  assert.equal(statement?.lines.find((line) => line.metric_key === "revenue")?.value_num, 1000);
  assert.equal(statement?.lines.find((line) => line.metric_key === "gross_profit")?.value_num, 400);
  assert.equal(db.sources[0]?.[3], "https://www.sec.gov/Archives/edgar/data/320193/000032019325000001/0000320193-25-000001-index.htm");
});

test("SEC-backed stats can ingest latest annual companyfacts on demand", async () => {
  const db = new FakeFundamentalsDb();
  let fetchCount = 0;
  const fetcher: SecEdgarFetcher = secCompanyFetcher(() => {
    fetchCount += 1;
    return companyFacts();
  });
  const statements = createSecBackedStatementRepository(db, {
    fetcher,
    sourceId: SOURCE_ID,
    clock: () => new Date("2026-05-08T00:00:00.000Z"),
  });
  const statsRepo = createSecBackedStatsRepository(db, {
    statements,
    fetcher,
    clock: () => new Date("2026-05-08T00:00:00.000Z"),
  });

  const envelope = await statsRepo.find(ISSUER_ID);
  assert.ok(envelope);
  const grossMargin = envelope.stats.find((stat) => stat.stat_key === "gross_margin");
  const revenueGrowth = envelope.stats.find((stat) => stat.stat_key === "revenue_growth_yoy");
  assert.equal(grossMargin?.value_num, 0.4);
  assert.equal(revenueGrowth?.value_num, 0.25);
  assert.equal(db.facts.some((fact) => fact.fiscal_year === 2024), true);
  assert.equal(db.facts.some((fact) => fact.fiscal_year === 2023), true);
  assert.equal(fetchCount > 0, true);
});

test("hydrating an issuer's latest years stores each of them from one download", async () => {
  const db = new FakeFundamentalsDb();
  const downloads: string[] = [];
  const fetcher = secCompanyFetcher(() => companyFacts());
  await hydrateSecIssuerLatestYears(db, {
    issuerId: ISSUER_ID,
    reads: new Map([["revenue", 2]]),
    fetcher: (path) => { downloads.push(path); return fetcher(path); },
    sourceId: SOURCE_ID,
    clock: () => new Date("2026-05-08T00:00:00.000Z"),
  });
  assert.deepEqual([...new Set(db.facts.map((fact) => fact.fiscal_year))].sort(), [2023, 2024]);
  assert.equal(db.facts.find((fact) => fact.fiscal_year === 2024 && metricKeyFor(db.metrics, fact.metric_id) === "revenue")?.value_num, 1000);
  assert.deepEqual(downloads.filter((path) => path.startsWith("/api/xbrl/companyfacts/")), ["/api/xbrl/companyfacts/CIK0000320193.json"]);
});

test("an issuer whose planned reads are stored with proofs is not downloaded again", async () => {
  const proven = (rows: Array<{ metric_key: string; fiscal_year: number; period_end: string }>) => class extends FakeFundamentalsDb {
    async query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<{ rows: R[] }> {
      if (text.includes("current_fact_precision_attestations a")) return { rows: rows as unknown as R[] };
      return super.query<R>(text, values);
    }
  };
  const revenueOnly = proven([
    { metric_key: "revenue", fiscal_year: 2025, period_end: "2025-12-31" },
    { metric_key: "revenue", fiscal_year: 2024, period_end: "2024-12-31" },
  ]);
  const withGrossProfit = proven([
    { metric_key: "revenue", fiscal_year: 2025, period_end: "2025-12-31" },
    { metric_key: "revenue", fiscal_year: 2024, period_end: "2024-12-31" },
    { metric_key: "gross_profit", fiscal_year: 2025, period_end: "2025-12-31" },
  ]);
  const downloads: string[] = [];
  const hydrate = (db: FakeFundamentalsDb, now: string, reads: ReadonlyMap<string, number>) => hydrateSecIssuerLatestYears(db, {
    issuerId: ISSUER_ID,
    reads,
    fetcher: (path) => { downloads.push(path); return secCompanyFetcher(() => companyFacts())(path); },
    sourceId: SOURCE_ID,
    clock: () => new Date(now),
  });
  const plan = new Map([["revenue", 2], ["gross_profit", 1]]);
  await hydrate(new withGrossProfit(), "2026-10-20T00:00:00.000Z", plan);
  assert.deepEqual(downloads, [], "fresh proven reads are read, not fetched");
  await hydrate(new revenueOnly(), "2026-10-20T00:00:00.000Z", plan);
  assert.ok(downloads.length > 0, "a planned metric without proven facts is fetched");
  downloads.length = 0;
  await hydrate(new withGrossProfit(), "2027-06-01T00:00:00.000Z", plan);
  assert.ok(downloads.length > 0, "a stored latest year older than a filing cycle is fetched again");
});

test("a prior year SEC cannot extract still lets the latest year be stored, then reports the failure", async () => {
  const db = new FakeFundamentalsDb();
  const facts = companyFacts();
  facts.facts["us-gaap"].CostOfRevenue.units.USD[1]!.start = "2023-01-02";
  await assert.rejects(
    hydrateSecIssuerLatestYears(db, {
      issuerId: ISSUER_ID,
      reads: new Map([["revenue", 2]]),
      fetcher: secCompanyFetcher(() => facts),
      sourceId: SOURCE_ID,
      clock: () => new Date("2026-05-08T00:00:00.000Z"),
      logger: { warn() {} },
    }),
    (error) => error instanceof FundamentalsDataUnavailableError && /disagrees/u.test(error.message),
  );
  assert.deepEqual([...new Set(db.facts.map((fact) => fact.fiscal_year))], [2024]);
});

test("a year SEC has no statement for is skipped while the others are stored", async () => {
  const db = new FakeFundamentalsDb();
  await hydrateSecIssuerLatestYears(db, {
    issuerId: ISSUER_ID,
    reads: new Map([["revenue", 3]]),
    fetcher: secCompanyFetcher(() => companyFacts()),
    sourceId: SOURCE_ID,
    clock: () => new Date("2026-05-08T00:00:00.000Z"),
  });
  assert.deepEqual([...new Set(db.facts.map((fact) => fact.fiscal_year))].sort(), [2023, 2024]);
});

test("an income line SEC tagged with a unit its metric cannot take is SEC's failure, not ours", async () => {
  const db = new FakeFundamentalsDb();
  const facts = companyFacts();
  (facts.facts["us-gaap"] as Record<string, unknown>).WeightedAverageNumberOfSharesOutstandingBasic = annualUsd(100, 100);
  await assert.rejects(
    hydrateSecIssuer(db, {
      issuerId: ISSUER_ID,
      fiscal_year: 2024,
      fiscal_period: "FY",
      fetcher: secCompanyFetcher(() => facts),
      sourceId: SOURCE_ID,
      logger: { warn() {} },
    }),
    (error) => error instanceof FundamentalsDataUnavailableError && /not compatible/u.test(error.message),
  );
  assert.deepEqual(db.facts, []);
});

test("a metric our registry lacks is our failure, thrown as it is, not SEC's", async () => {
  class EmptyRegistry extends FakeFundamentalsDb {
    async query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<{ rows: R[] }> {
      if (text.toLowerCase().includes("from metrics")) return { rows: [] };
      return super.query<R>(text, values);
    }
  }
  await assert.rejects(
    hydrateSecIssuer(new EmptyRegistry(), {
      issuerId: ISSUER_ID,
      fiscal_year: 2024,
      fiscal_period: "FY",
      fetcher: secCompanyFetcher(() => companyFacts()),
      sourceId: SOURCE_ID,
      logger: { warn() {} },
    }),
    (error) => !(error instanceof FundamentalsDataUnavailableError) && error instanceof Error && /not registered/u.test(error.message),
  );
});

test("an accession SEC sent malformed is SEC's failure", async () => {
  const db = new FakeFundamentalsDb();
  const facts = companyFacts();
  for (const concept of Object.values(facts.facts["us-gaap"])) {
    for (const values of Object.values(concept.units) as SecConceptValue[][]) for (const value of values) value.accn = "not-an-accession";
  }
  await assert.rejects(
    hydrateSecIssuer(db, {
      issuerId: ISSUER_ID,
      fiscal_year: 2024,
      fiscal_period: "FY",
      fetcher: secCompanyFetcher(() => facts),
      sourceId: SOURCE_ID,
      logger: { warn() {} },
    }),
    (error) => error instanceof FundamentalsDataUnavailableError && /accession_number/u.test(error.message),
  );
  assert.deepEqual(db.sources, []);
});

test("a frozen golden issuer is never repaired from live SEC", async () => {
  const touched: string[] = [];
  const db = { query: async (text: string) => { touched.push(text); return { rows: [] }; }, connect: async () => { throw new Error("no transaction expected"); } };
  const statement = await hydrateSecIssuer(db, {
    issuerId: GOLDEN_ISSUER_IDS.NVDA,
    fiscal_year: 2024,
    fiscal_period: "FY",
    fetcher: async (path) => { touched.push(path); throw new Error("no fetch expected"); },
    sourceId: SOURCE_ID,
  });
  assert.equal(statement, null);
  assert.deepEqual(touched, []);
});

test("a database failure while storing a fetched statement throws as it is, never as SEC's", async () => {
  class FailingWrites extends FakeFundamentalsDb {
    async connect() {
      const query = async <R extends Record<string, unknown>>(text: string): Promise<{ rows: R[] }> => {
        if (text === "begin" || text === "rollback") return { rows: [] };
        throw new Error("deadlock detected");
      };
      return { query, release: () => {} };
    }
  }
  await assert.rejects(
    hydrateSecIssuer(new FailingWrites(), {
      issuerId: ISSUER_ID,
      fiscal_year: 2024,
      fiscal_period: "FY",
      fetcher: secCompanyFetcher(() => companyFacts()),
      sourceId: SOURCE_ID,
      logger: { warn() {} },
    }),
    (error) => !(error instanceof FundamentalsDataUnavailableError) && error instanceof Error && error.message === "deadlock detected",
  );
});

test("SEC-backed statements propagate provider failures instead of returning missing coverage", async () => {
  const db = new FakeFundamentalsDb();
  const statements = createSecBackedStatementRepository(db, {
    fetcher: async () => {
      throw new SecEdgarFetchError(403, "sec_edgar: HTTP 403");
    },
    sourceId: SOURCE_ID,
    clock: () => new Date("2026-05-08T00:00:00.000Z"),
    logger: { warn() {} },
  });

  await assert.rejects(
    () => statements.find({
      issuer_id: ISSUER_ID,
      family: "income",
      basis: "as_reported",
      fiscal_year: 2024,
      fiscal_period: "FY",
    }),
    (error) =>
      error instanceof FundamentalsDataUnavailableError &&
      error.reason === "provider_error" &&
      error.retryable === false,
  );
});

type FactRecord = {
  fact_id: string;
  subject_id: string;
  metric_id: string;
  period_kind: string;
  period_start: string | null;
  period_end: string;
  fiscal_year: number;
  fiscal_period: string;
  value_num: number | null;
  value_text: string | null;
  unit: string;
  currency: string | null;
  scale: number;
  as_of: string;
  reported_at: string | null;
  observed_at: string;
  source_id: string;
  coverage_level: string;
  quality_flags: Array<Record<string, unknown>>;
  invalidated_at: string | null;
  superseded_by: string | null;
};

class FakeFundamentalsDb {
  readonly metrics = metricDefinitions();
  readonly facts: FactRecord[] = [];
  readonly sources: unknown[][] = [];
  readonly attestations: unknown[][] = [];
  readonly transactions: string[] = [];

  async connect() {
    return { query: this.query.bind(this), release: () => {} };
  }

  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: unknown[] = [],
  ): Promise<{ rows: R[] }> {
    const sql = text.toLowerCase();
    if (sql === "begin" || sql === "commit" || sql === "rollback") {
      this.transactions.push(sql);
      return rows([]);
    }
    if (sql.includes("from issuers")) {
      return rows([{ issuer_id: ISSUER_ID, cik: "320193" }]);
    }
    if (sql.includes("from metrics") && sql.includes("where metric_key = any")) {
      const keys = new Set(values[0] as string[]);
      return rows(this.metrics.filter((metric) => keys.has(metric.metric_key)));
    }
    if (sql.includes("insert into sources")) {
      this.sources.push(values);
      return rows([{ source_id: values[0] }]);
    }
    // The publication proof recorded with each ingest (sec-publication-proof.ts).
    if (sql.includes("from sources where source_id = $1 for update")) return rows([]);
    if (sql.includes("from current_source_publication_attestations")) {
      return rows(this.attestations.filter((row) => row[0] === values[0] && row[2] === values[1] && Date.parse(String(row[4])) <= Date.parse(String(values[2]))));
    }
    if (sql.includes("normalized_content_hash(s.content_hash) as source_hash")) {
      const source = this.sources.findLast((row) => row[0] === values[0]);
      return rows(source ? [{ source_hash: source[7], document_hash: null, document_source_id: null }] : []);
    }
    if (sql.includes("insert into source_publication_attestations")) {
      this.attestations.push(values);
      return rows([{ attestation_id: `attestation-${this.attestations.length}` }]);
    }
    if (sql.includes("select distinct on (m.metric_key)")) {
      const [subjectId, periodKind, fiscalYear, fiscalPeriod, metricKeys] = values as [
        string,
        string,
        number,
        string,
        string[],
      ];
      const keys = new Set(metricKeys);
      return rows(
        this.facts
          .filter(
            (fact) =>
              fact.invalidated_at === null && fact.subject_id === subjectId &&
              fact.period_kind === periodKind &&
              fact.fiscal_year === fiscalYear &&
              fact.fiscal_period === fiscalPeriod &&
              keys.has(metricKeyFor(this.metrics, fact.metric_id)),
          )
          .map((fact) => factRow(this.metrics, fact)),
      );
    }
    // The backfill's stored SEC income periods.
    if (sql.includes("select distinct f.fiscal_year")) {
      const keys = new Set(values[1] as string[]);
      const periods = new Map(
        this.facts
          .filter((fact) => fact.invalidated_at === null && fact.subject_id === values[0] && keys.has(metricKeyFor(this.metrics, fact.metric_id)))
          .map((fact) => [`${fact.fiscal_year}|${fact.fiscal_period}`, { fiscal_year: fact.fiscal_year, fiscal_period: fact.fiscal_period }]),
      );
      return rows([...periods.values()]);
    }
    if (sql.includes("select fact_id::text as fact_id") && sql.includes("limit 1")) {
      const [subjectId, metricId, periodKind, fiscalYear, fiscalPeriod, sourceId] = values as [
        string,
        string,
        string,
        number,
        string,
        string,
      ];
      const fact = this.facts.find(
        (candidate) =>
          candidate.subject_id === subjectId &&
          candidate.metric_id === metricId &&
          candidate.period_kind === periodKind &&
          candidate.fiscal_year === fiscalYear &&
          candidate.fiscal_period === fiscalPeriod &&
          candidate.source_id === sourceId,
      );
      return rows(fact ? [{ fact_id: fact.fact_id }] : []);
    }
    if (sql.includes("insert into facts")) {
      const fact = factFromInsert(values);
      // The active identity is unique (facts_active_reported_identity_idx): a
      // conflicting insert does nothing.
      const conflict = this.facts.some((other) =>
        other.invalidated_at === null && other.subject_id === fact.subject_id && other.metric_id === fact.metric_id &&
        other.period_kind === fact.period_kind && other.fiscal_year === fact.fiscal_year &&
        other.fiscal_period === fact.fiscal_period && other.source_id === fact.source_id
      );
      if (conflict) return rows([]);
      this.facts.push(fact);
      return rows([{ fact_id: fact.fact_id }]);
    }
    // The repair's stored SEC facts for a statement's period.
    if (sql.includes("as stored_value")) {
      const [subjectId, periodKind, fiscalYear, fiscalPeriod, metricKeys] = values as [string, string, number, string, string[]];
      return rows(this.facts
        .filter((fact) =>
          fact.invalidated_at === null && fact.subject_id === subjectId && fact.period_kind === periodKind &&
          fact.fiscal_year === fiscalYear && fact.fiscal_period === fiscalPeriod &&
          metricKeys.includes(metricKeyFor(this.metrics, fact.metric_id))
        )
        .map((fact) => ({
          fact_id: fact.fact_id,
          metric_key: metricKeyFor(this.metrics, fact.metric_id),
          stored_value: fact.value_num === null ? null : String(fact.value_num),
          period_start: fact.period_start,
          period_end: fact.period_end,
        })));
    }
    if (sql.includes("update facts") && sql.includes("set invalidated_at")) {
      for (const fact of this.facts) if ((values[0] as string[]).includes(fact.fact_id)) fact.invalidated_at = "now";
      return rows([]);
    }
    if (sql.includes("update facts") && sql.includes("set superseded_by")) {
      for (const fact of this.facts) if ((values[0] as string[]).includes(fact.fact_id)) fact.superseded_by = values[1] as string;
      return rows([]);
    }
    // Restatement detection's stored originals: the fake records no financial contexts, so there are none.
    if (sql.includes("join fact_financial_contexts c on c.fact_id = f.fact_id")) return rows([]);
    if (sql.includes("current_fact_precision_attestations a")) return rows([]);
    if (sql.includes("select max(f.fiscal_year)")) {
      const fiscalYears = this.facts
        .filter((fact) => metricKeyFor(this.metrics, fact.metric_id) === "revenue")
        .map((fact) => fact.fiscal_year);
      return rows([{ fiscal_year: fiscalYears.length === 0 ? null : Math.max(...fiscalYears) }]);
    }
    throw new Error(`unhandled fake query: ${text}`);
  }
}

// The fake decides the rows; R is inferred from the calling query's return type.
function rows<R>(rows: readonly unknown[]): { rows: R[] } {
  return { rows: rows as R[] };
}

function metricDefinitions(): MetricDefinition[] {
  const defs = [
    ["revenue", "currency"],
    ["cost_of_revenue", "currency"],
    ["gross_profit", "currency"],
    ["operating_income", "currency"],
    ["operating_expenses", "currency"],
    ["net_income", "currency"],
    ["eps_basic", "currency"],
    ["eps_diluted", "currency"],
    ["shares_outstanding_basic", "count"],
    ["shares_outstanding_diluted", "count"],
    ["operating_cash_flow", "currency"],
    ["capex", "currency"],
    ["total_assets", "currency"],
    ["total_liabilities", "currency"],
    ["total_equity", "currency"],
    ["cash_and_equivalents", "currency"],
  ] as const;
  return defs.map(([metric_key, unit_class], index) => ({
    metric_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    metric_key,
    display_name: metric_key,
    unit_class,
    aggregation: metric_key.startsWith("eps") ? "point_in_time" : "sum",
    interpretation: "neutral",
    canonical_source_class: "gaap",
    definition_version: 1,
    notes: null,
  }));
}

function metricKeyFor(metrics: MetricDefinition[], metricId: string): string {
  const metric = metrics.find((candidate) => candidate.metric_id === metricId);
  if (!metric) throw new Error(`unknown metric ${metricId}`);
  return metric.metric_key;
}

function factRow(metrics: MetricDefinition[], fact: FactRecord) {
  return {
    ...fact,
    metric_key: metricKeyFor(metrics, fact.metric_id),
  };
}

function factFromInsert(values: unknown[]): FactRecord {
  return {
    // Real facts.fact_id is a gen_random_uuid() v4; mirror that so the
    // load-from-facts path (which now validates line.fact_id as a UUID) accepts it.
    fact_id: crypto.randomUUID(),
    subject_id: values[0] as string,
    metric_id: values[1] as string,
    period_kind: values[2] as string,
    period_start: values[3] as string | null,
    period_end: values[4] as string,
    fiscal_year: values[5] as number,
    fiscal_period: values[6] as string,
    value_num: values[7] as number | null,
    value_text: values[8] as string | null,
    unit: values[9] as string,
    currency: values[10] as string | null,
    scale: values[11] as number,
    as_of: values[12] as string,
    reported_at: values[13] as string | null,
    observed_at: values[14] as string,
    source_id: values[15] as string,
    coverage_level: values[16] as string,
    quality_flags: JSON.parse((values[17] as string | undefined) ?? "[]"),
    invalidated_at: null,
    superseded_by: null,
  };
}

function companyFacts() {
  return {
    cik: 320193,
    entityName: "Apple Inc.",
    facts: {
      "us-gaap": {
        RevenueFromContractWithCustomerExcludingAssessedTax: annualUsd(1000, 800),
        CostOfRevenue: annualUsd(600, 500),
        GrossProfit: annualUsd(400, 300),
        OperatingIncomeLoss: annualUsd(250, 200),
        NetIncomeLoss: annualUsd(200, 160),
        EarningsPerShareBasic: annualPerShare(2.1, 1.7),
        EarningsPerShareDiluted: annualPerShare(2, 1.6),
        WeightedAverageNumberOfSharesOutstandingBasic: annualShares(100, 100),
        WeightedAverageNumberOfDilutedSharesOutstanding: annualShares(100, 100),
      },
    },
  };
}

function quarterlyCompanyFacts() {
  const facts = companyFacts();
  const q2Accn = "0000320193-24-000069";
  const q2Discrete = {
    start: "2023-12-31",
    end: "2024-03-30",
    accn: q2Accn,
    fy: 2024,
    fp: "Q2",
    form: "10-Q",
    filed: "2024-05-03",
    frame: "CY2024Q1",
  };
  const q2Ytd = {
    start: "2023-10-01",
    end: "2024-03-30",
    accn: q2Accn,
    fy: 2024,
    fp: "Q2",
    form: "10-Q",
    filed: "2024-05-03",
  };
  const usGaap = facts.facts["us-gaap"];

  usGaap.RevenueFromContractWithCustomerExcludingAssessedTax.units.USD = [
    { ...q2Ytd, val: 210_328_000_000 },
    { ...q2Discrete, val: 90_753_000_000 },
  ];
  usGaap.CostOfRevenue.units.USD = [
    { ...q2Ytd, val: 112_258_000_000 },
    { ...q2Discrete, val: 48_482_000_000 },
  ];
  usGaap.GrossProfit.units.USD = [
    { ...q2Ytd, val: 98_070_000_000 },
    { ...q2Discrete, val: 42_271_000_000 },
  ];
  usGaap.OperatingIncomeLoss.units.USD = [
    { ...q2Ytd, val: 70_898_000_000 },
    { ...q2Discrete, val: 27_900_000_000 },
  ];
  usGaap.NetIncomeLoss.units.USD = [
    { ...q2Ytd, val: 57_552_000_000 },
    { ...q2Discrete, val: 23_636_000_000 },
  ];
  usGaap.EarningsPerShareBasic.units["USD/shares"] = [
    { ...q2Ytd, val: 3.71 },
    { ...q2Discrete, val: 1.53 },
  ];
  usGaap.EarningsPerShareDiluted.units["USD/shares"] = [
    { ...q2Ytd, val: 3.71 },
    { ...q2Discrete, val: 1.53 },
  ];
  usGaap.WeightedAverageNumberOfSharesOutstandingBasic.units.shares = [
    { ...q2Discrete, val: 15_509_763_000 },
  ];
  usGaap.WeightedAverageNumberOfDilutedSharesOutstanding.units.shares = [
    { ...q2Discrete, val: 15_464_709_000 },
  ];
  return facts;
}

function annualUsd(current: number, prior: number) {
  return { label: "", description: "", units: { USD: annualValues(current, prior) } };
}

function annualPerShare(current: number, prior: number) {
  return { label: "", description: "", units: { "USD/shares": annualValues(current, prior) } };
}

function annualShares(current: number, prior: number) {
  return { label: "", description: "", units: { shares: annualValues(current, prior) } };
}

// Balances: instants (no start) at each annual report's year end.
function annualInstant(current: number, prior: number) {
  return {
    label: "",
    description: "",
    units: { USD: annualValues(current, prior).map(({ start: _start, ...instant }) => instant) },
  };
}

function annualValues(current: number, prior: number): SecConceptValue[] {
  return [
    {
      start: "2024-01-01",
      end: "2024-12-31",
      val: current,
      accn: "0000320193-25-000001",
      fy: 2024,
      fp: "FY",
      form: "10-K",
      filed: "2025-02-01",
    },
    {
      start: "2023-01-01",
      end: "2023-12-31",
      val: prior,
      accn: "0000320193-24-000001",
      fy: 2023,
      fp: "FY",
      form: "10-K",
      filed: "2024-02-01",
    },
  ];
}

async function statementSourceIdFor(facts: ReturnType<typeof companyFacts>): Promise<string | undefined> {
  const db = new FakeFundamentalsDb();
  const statements = createSecBackedStatementRepository(db, {
    fetcher: secCompanyFetcher(() => facts),
    sourceId: SOURCE_ID,
    clock: () => new Date("2026-05-08T00:00:00.000Z"),
  });
  const statement = await statements.find({
    issuer_id: ISSUER_ID,
    family: "income",
    basis: "as_reported",
    fiscal_year: 2024,
    fiscal_period: "FY",
  });
  return statement?.source_id;
}

function companyFactsWithAccession(accession: string) {
  const facts = companyFacts();
  for (const concept of Object.values(facts.facts["us-gaap"])) {
    for (const values of Object.values(concept.units)) {
      values[0].accn = accession;
    }
  }
  return facts;
}

function mixedAccessionCompanyFacts() {
  const facts = companyFacts();
  const mixedAccession = "0000320193-25-000002";
  facts.facts["us-gaap"].RevenueFromContractWithCustomerExcludingAssessedTax.units.USD.unshift({
    start: "2024-01-01",
    end: "2024-12-31",
    val: 9999,
    accn: mixedAccession,
    fy: 2024,
    fp: "FY",
    form: "10-K",
    filed: "2025-03-01",
  });
  return facts;
}

function mixedQuarterlyAccessionCompanyFacts() {
  const facts = companyFacts();
  const ytdAccn = "0000320193-24-000010";
  const discreteAccn = "0000320193-24-000020";
  const q2Ytd = {
    start: "2023-10-01",
    end: "2024-03-30",
    accn: ytdAccn,
    fy: 2024,
    fp: "Q2",
    form: "10-Q",
    filed: "2024-05-02",
  };
  const q2Discrete = {
    start: "2023-12-31",
    end: "2024-03-30",
    accn: discreteAccn,
    fy: 2024,
    fp: "Q2",
    form: "10-Q",
    filed: "2024-05-03",
    frame: "CY2024Q1",
  };
  const usGaap = facts.facts["us-gaap"];

  usGaap.RevenueFromContractWithCustomerExcludingAssessedTax.units.USD = [
    { ...q2Ytd, val: 210_328_000_000 },
    { ...q2Discrete, val: 90_753_000_000 },
  ];
  usGaap.CostOfRevenue.units.USD = [
    { ...q2Ytd, val: 112_258_000_000 },
  ];
  usGaap.GrossProfit.units.USD = [
    { ...q2Ytd, val: 98_070_000_000 },
  ];
  usGaap.OperatingIncomeLoss.units.USD = [
    { ...q2Ytd, val: 70_898_000_000 },
  ];
  usGaap.NetIncomeLoss.units.USD = [
    { ...q2Ytd, val: 57_552_000_000 },
  ];
  usGaap.EarningsPerShareBasic.units["USD/shares"] = [
    { ...q2Ytd, val: 3.71 },
  ];
  usGaap.EarningsPerShareDiluted.units["USD/shares"] = [
    { ...q2Ytd, val: 3.71 },
  ];
  usGaap.WeightedAverageNumberOfSharesOutstandingBasic.units.shares = [
    { ...q2Ytd, val: 15_509_763_000 },
  ];
  usGaap.WeightedAverageNumberOfDilutedSharesOutstanding.units.shares = [
    { ...q2Ytd, val: 15_464_709_000 },
  ];
  return facts;
}

function fourthQuarterCompanyFacts() {
  const facts = companyFacts();
  facts.facts["us-gaap"].RevenueFromContractWithCustomerExcludingAssessedTax.units.USD = [
    {
      start: "2024-01-01",
      end: "2024-12-31",
      val: 1000,
      accn: "0000320193-25-000001",
      fy: 2024,
      fp: "FY",
      form: "10-K",
      filed: "2025-02-01",
    },
    {
      start: "2024-01-01",
      end: "2024-03-31",
      val: 100,
      accn: "0000320193-24-000010",
      fy: 2024,
      fp: "Q1",
      form: "10-Q",
      filed: "2024-05-01",
      frame: "CY2024Q1",
    },
    {
      start: "2024-04-01",
      end: "2024-06-30",
      val: 200,
      accn: "0000320193-24-000020",
      fy: 2024,
      fp: "Q2",
      form: "10-Q",
      filed: "2024-08-01",
      frame: "CY2024Q2",
    },
    {
      start: "2024-07-01",
      end: "2024-09-30",
      val: 300,
      accn: "0000320193-24-000030",
      fy: 2024,
      fp: "Q3",
      form: "10-Q",
      filed: "2024-11-01",
      frame: "CY2024Q3",
    },
  ];
  return facts;
}
