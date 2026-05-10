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
  assert.equal(first?.source_id, "22222222-2222-4222-8222-000032019325");
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
