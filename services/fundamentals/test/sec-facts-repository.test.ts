import test from "node:test";
import assert from "node:assert/strict";
import {
  createSecBackedStatementRepository,
  createSecBackedStatsRepository,
} from "../src/sec-facts-repository.ts";
import type { MetricDefinition } from "../src/metric-mapper.ts";
import {
  SecEdgarFetchError,
  type SecEdgarFetcher,
} from "../src/sec-edgar.ts";
import { FundamentalsDataUnavailableError } from "../src/availability.ts";

const ISSUER_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";

test("SEC-backed statements persist companyfacts and repeat reads from facts", async () => {
  const db = new FakeFundamentalsDb();
  let fetchCount = 0;
  const fetcher: SecEdgarFetcher = async () => {
    fetchCount += 1;
    return companyFacts();
  };
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

test("SEC-backed statements persist quarterly companyfacts as fiscal_q facts", async () => {
  const db = new FakeFundamentalsDb();
  let fetchCount = 0;
  const statements = createSecBackedStatementRepository(db, {
    fetcher: async () => {
      fetchCount += 1;
      return quarterlyCompanyFacts();
    },
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
    fetcher: async () => mixedQuarterlyAccessionCompanyFacts(),
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
    fetcher: async () => fourthQuarterCompanyFacts(),
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
    fetcher: async () => mixedAccessionCompanyFacts(),
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
  const fetcher: SecEdgarFetcher = async () => {
    fetchCount += 1;
    return companyFacts();
  };
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
};

class FakeFundamentalsDb {
  readonly metrics = metricDefinitions();
  readonly facts: FactRecord[] = [];
  readonly sources: unknown[][] = [];

  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: unknown[] = [],
  ): Promise<{ rows: R[] }> {
    const sql = text.toLowerCase();
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
              fact.subject_id === subjectId &&
              fact.period_kind === periodKind &&
              fact.fiscal_year === fiscalYear &&
              fact.fiscal_period === fiscalPeriod &&
              keys.has(metricKeyFor(this.metrics, fact.metric_id)),
          )
          .map((fact) => factRow(this.metrics, fact)),
      );
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
      this.facts.push(factFromInsert(values));
      return rows([]);
    }
    if (sql.includes("select max(f.fiscal_year)")) {
      const fiscalYears = this.facts
        .filter((fact) => metricKeyFor(this.metrics, fact.metric_id) === "revenue")
        .map((fact) => fact.fiscal_year);
      return rows([{ fiscal_year: fiscalYears.length === 0 ? null : Math.max(...fiscalYears) }]);
    }
    throw new Error(`unhandled fake query: ${text}`);
  }
}

function rows<R extends Record<string, unknown>>(rows: R[]): { rows: R[] } {
  return { rows };
}

function metricDefinitions(): MetricDefinition[] {
  const defs = [
    ["revenue", "currency"],
    ["cost_of_revenue", "currency"],
    ["gross_profit", "currency"],
    ["operating_income", "currency"],
    ["net_income", "currency"],
    ["eps_basic", "currency"],
    ["eps_diluted", "currency"],
    ["shares_outstanding_basic", "count"],
    ["shares_outstanding_diluted", "count"],
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
    fact_id: `fact-${values[1]}-${values[5]}-${values[6]}`,
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

function annualValues(current: number, prior: number) {
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
    fetcher: async () => facts,
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
