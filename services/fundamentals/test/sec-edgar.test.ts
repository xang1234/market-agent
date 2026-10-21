import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCompanyFacts,
  buildSecSource,
  companyFactsPath,
  extractStatement,
  fetchCompanyFacts,
  SEC_INCOME_METRIC_KEYS,
  SEC_METRIC_KEYS_BY_FAMILY,
  secFiscalYearWindow,
  US_GAAP_TO_METRIC_KEY,
  type SecCompanyFacts,
  type SecConceptValue,
  type SecEdgarFetcher,
} from "../src/sec-edgar.ts";
import { normalizedStatement } from "../src/statement.ts";
import {
  createMetricRegistry,
  mapStatement,
  type MetricDefinition,
} from "../src/metric-mapper.ts";
import { aaplIssuer } from "./fixtures.ts";
import { secFetched } from "./fakes.ts";

const AAPL_CIK = 320193;
const AAPL_FY2024_ACCN = "0000320193-24-000123";
const SEC_SOURCE_ID = "00000000-0000-4000-a000-0000000000ec";
const RETRIEVED_AT = "2024-11-02T08:00:00.000Z";

function value(opts: Partial<SecConceptValue> & { val: number; end: string }): SecConceptValue {
  return {
    end: opts.end,
    val: opts.val,
    accn: opts.accn ?? AAPL_FY2024_ACCN,
    fy: opts.fy ?? 2024,
    fp: opts.fp ?? "FY",
    form: opts.form ?? "10-K",
    filed: opts.filed ?? "2024-11-01",
    ...(opts.start !== undefined ? { start: opts.start } : {}),
    ...(opts.frame !== undefined ? { frame: opts.frame } : {}),
  };
}

// Subset of AAPL's data.sec.gov companyfacts response, FY2024. Real values
// from the 10-K filed 2024-11-01. Concept names are AAPL's actual XBRL tags
// (post-ASC 606: RevenueFromContractWithCustomerExcludingAssessedTax, not
// the legacy `Revenues`).
function aaplCompanyFactsFixture(): SecCompanyFacts {
  const fy = { fy: 2024, fp: "FY", form: "10-K" };
  const period = { ...fy, start: "2023-10-01", end: "2024-09-28" };
  return {
    cik: AAPL_CIK,
    entityName: "Apple Inc.",
    facts: {
      "us-gaap": {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          label: "Revenue from Contract with Customer, Excluding Assessed Tax",
          description: "Total revenue net of excluded taxes.",
          units: {
            USD: [value({ val: 391_035_000_000, ...period })],
          },
        },
        CostOfGoodsAndServicesSold: {
          label: "Cost of Goods and Services Sold",
          description: "Total cost of products and services sold.",
          units: {
            USD: [value({ val: 210_352_000_000, ...period })],
          },
        },
        GrossProfit: {
          label: "Gross Profit",
          description: "Revenue less cost of goods sold.",
          units: {
            USD: [value({ val: 180_683_000_000, ...period })],
          },
        },
        OperatingIncomeLoss: {
          label: "Operating Income / (Loss)",
          description: "Operating income for the period.",
          units: {
            USD: [value({ val: 123_216_000_000, ...period })],
          },
        },
        NetIncomeLoss: {
          label: "Net Income / (Loss)",
          description: "Net income attributable to common shareholders.",
          units: {
            USD: [value({ val: 93_736_000_000, ...period })],
          },
        },
        EarningsPerShareBasic: {
          label: "Earnings per Share, Basic",
          description: "Basic EPS.",
          units: {
            "USD/shares": [value({ val: 6.11, ...period })],
          },
        },
        EarningsPerShareDiluted: {
          label: "Earnings per Share, Diluted",
          description: "Diluted EPS.",
          units: {
            "USD/shares": [value({ val: 6.08, ...period })],
          },
        },
        WeightedAverageNumberOfSharesOutstandingBasic: {
          label: "Weighted Average Number of Shares Outstanding, Basic",
          description: "Weighted-average shares for basic EPS.",
          units: {
            shares: [value({ val: 15_343_783_000, ...period })],
          },
        },
        WeightedAverageNumberOfDilutedSharesOutstanding: {
          label: "Weighted Average Number of Diluted Shares Outstanding",
          description: "Weighted-average shares for diluted EPS.",
          units: {
            shares: [value({ val: 15_408_095_000, ...period })],
          },
        },
      },
    },
  };
}

function secIncomeMetricRegistry() {
  const defs: MetricDefinition[] = [
    metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaa10000001", "revenue", "Revenue", "currency", "sum"),
    metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaa10000002", "cost_of_revenue", "Cost of Revenue", "currency", "sum"),
    metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaa10000003", "gross_profit", "Gross Profit", "currency", "sum"),
    metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaa10000004", "operating_income", "Operating Income", "currency", "sum"),
    metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaa10000005", "net_income", "Net Income", "currency", "sum"),
    metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaa10000006", "eps_basic", "EPS (Basic)", "currency", "derived"),
    metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaa10000007", "eps_diluted", "EPS (Diluted)", "currency", "derived"),
    metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaa10000008", "weighted_average_basic_shares", "Weighted-average basic shares", "count", "avg"),
    metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaa10000009", "weighted_average_diluted_shares", "Weighted-average diluted shares", "count", "avg"),
  ];
  return createMetricRegistry(defs);
}

function metric(
  metric_id: string,
  metric_key: string,
  display_name: string,
  unit_class: MetricDefinition["unit_class"],
  aggregation: MetricDefinition["aggregation"],
): MetricDefinition {
  return {
    metric_id,
    metric_key,
    display_name,
    unit_class,
    aggregation,
    interpretation: "neutral",
    canonical_source_class: "gaap",
    definition_version: 1,
    notes: null,
  };
}

// --- Acceptance: AAPL companyfacts → Facts with SEC source ---------------

test("AAPL companyfacts extracts to a NormalizedStatement carrying the SEC source_id", () => {
  const facts = aaplCompanyFactsFixture();
  const input = extractStatement({
    subject: aaplIssuer,
    facts,
    family: "income",
    fiscal_year: 2024,
    fiscal_period: "FY",
    source_id: SEC_SOURCE_ID,
    as_of: "2024-11-01T20:30:00.000Z",
  });
  const statement = normalizedStatement(input);

  assert.equal(statement.source_id, SEC_SOURCE_ID);
  assert.equal(statement.basis, "as_reported");
  assert.equal(statement.family, "income");
  assert.equal(statement.fiscal_year, 2024);
  assert.equal(statement.fiscal_period, "FY");
  assert.equal(statement.period_start, "2023-10-01");
  assert.equal(statement.period_end, "2024-09-28");
  assert.equal(statement.reporting_currency, "USD");
});

test("AAPL companyfacts extraction maps US-GAAP concepts to canonical metric_keys", () => {
  const input = extractStatement({
    subject: aaplIssuer,
    facts: aaplCompanyFactsFixture(),
    family: "income",
    fiscal_year: 2024,
    fiscal_period: "FY",
    source_id: SEC_SOURCE_ID,
    as_of: "2024-11-01T20:30:00.000Z",
  });
  const byKey = new Map(input.lines.map((l) => [l.metric_key, l]));

  // Native USD with scale=1 (companyfacts reports unscaled values).
  assert.equal(byKey.get("revenue")?.value_num, 391_035_000_000);
  assert.equal(byKey.get("revenue")?.scale, 1);
  assert.equal(byKey.get("revenue")?.unit, "currency");
  assert.equal(byKey.get("revenue")?.currency, "USD");

  assert.equal(byKey.get("net_income")?.value_num, 93_736_000_000);
  assert.equal(byKey.get("eps_basic")?.value_num, 6.11);
  assert.equal(byKey.get("eps_basic")?.unit, "currency_per_share");
  assert.equal(byKey.get("weighted_average_basic_shares")?.value_num, 15_343_783_000);
  assert.equal(byKey.get("weighted_average_basic_shares")?.unit, "shares");
});

test("quarterly companyfacts extraction prefers discrete quarter values over YTD values", () => {
  const q2Accn = "0000320193-24-000069";
  const facts = aaplCompanyFactsFixture();
  const usGaap = facts.facts["us-gaap"]!;
  const q2Discrete = {
    fy: 2024,
    fp: "Q2",
    form: "10-Q",
    accn: q2Accn,
    filed: "2024-05-03",
    start: "2023-12-31",
    end: "2024-03-30",
    frame: "CY2024Q1",
  };
  const q2Ytd = {
    fy: 2024,
    fp: "Q2",
    form: "10-Q",
    accn: q2Accn,
    filed: "2024-05-03",
    start: "2023-10-01",
    end: "2024-03-30",
  };

  usGaap.RevenueFromContractWithCustomerExcludingAssessedTax.units.USD = [
    value({ val: 210_328_000_000, ...q2Ytd }),
    value({ val: 90_753_000_000, ...q2Discrete }),
  ];
  usGaap.CostOfGoodsAndServicesSold.units.USD = [
    value({ val: 112_258_000_000, ...q2Ytd }),
    value({ val: 48_482_000_000, ...q2Discrete }),
  ];
  usGaap.GrossProfit.units.USD = [
    value({ val: 98_070_000_000, ...q2Ytd }),
    value({ val: 42_271_000_000, ...q2Discrete }),
  ];
  usGaap.OperatingIncomeLoss.units.USD = [
    value({ val: 70_898_000_000, ...q2Ytd }),
    value({ val: 27_900_000_000, ...q2Discrete }),
  ];
  usGaap.NetIncomeLoss.units.USD = [
    value({ val: 57_552_000_000, ...q2Ytd }),
    value({ val: 23_636_000_000, ...q2Discrete }),
  ];
  usGaap.EarningsPerShareBasic.units["USD/shares"] = [
    value({ val: 3.71, ...q2Ytd }),
    value({ val: 1.53, ...q2Discrete }),
  ];
  usGaap.EarningsPerShareDiluted.units["USD/shares"] = [
    value({ val: 3.71, ...q2Ytd }),
    value({ val: 1.53, ...q2Discrete }),
  ];
  usGaap.WeightedAverageNumberOfSharesOutstandingBasic.units.shares = [
    value({ val: 15_509_763_000, ...q2Discrete }),
  ];
  usGaap.WeightedAverageNumberOfDilutedSharesOutstanding.units.shares = [
    value({ val: 15_464_709_000, ...q2Discrete }),
  ];

  const statement = normalizedStatement(extractStatement({
    subject: aaplIssuer,
    facts,
    family: "income",
    fiscal_year: 2024,
    fiscal_period: "Q2",
    accession_number: q2Accn,
    source_id: SEC_SOURCE_ID,
    as_of: "2024-05-03T20:30:00.000Z",
  }));

  assert.equal(statement.period_kind, "fiscal_q");
  assert.equal(statement.period_start, "2023-12-31");
  assert.equal(statement.period_end, "2024-03-30");
  assert.equal(statement.lines.find((line) => line.metric_key === "revenue")?.value_num, 90_753_000_000);
  assert.equal(statement.lines.find((line) => line.metric_key === "net_income")?.value_num, 23_636_000_000);
});

test("quarterly companyfacts extraction does not use six-month YTD values as a discrete quarter", () => {
  const q2Accn = "0000320193-24-000069";
  const facts = aaplCompanyFactsFixture();
  const usGaap = facts.facts["us-gaap"]!;
  const q2Ytd = {
    fy: 2024,
    fp: "Q2",
    form: "10-Q",
    accn: q2Accn,
    filed: "2024-05-03",
    start: "2023-10-01",
    end: "2024-03-30",
  };

  usGaap.RevenueFromContractWithCustomerExcludingAssessedTax.units.USD = [
    value({ val: 210_328_000_000, ...q2Ytd }),
  ];

  assert.throws(
    () => extractStatement({
      subject: aaplIssuer,
      facts,
      family: "income",
      fiscal_year: 2024,
      fiscal_period: "Q2",
      accession_number: q2Accn,
      source_id: SEC_SOURCE_ID,
      as_of: "2024-05-03T20:30:00.000Z",
    }),
    /no us-gaap values/,
  );
});

test("quarterly companyfacts extraction rejects impossible dates when checking discrete quarter duration", () => {
  const q2Accn = "0000320193-24-000069";
  const facts = aaplCompanyFactsFixture();
  const usGaap = facts.facts["us-gaap"]!;

  usGaap.RevenueFromContractWithCustomerExcludingAssessedTax.units.USD = [
    value({
      val: 90_753_000_000,
      fy: 2024,
      fp: "Q2",
      form: "10-Q",
      accn: q2Accn,
      filed: "2024-05-03",
      start: "2024-02-30",
      end: "2024-05-30",
    }),
  ];

  assert.throws(
    () => extractStatement({
      subject: aaplIssuer,
      facts,
      family: "income",
      fiscal_year: 2024,
      fiscal_period: "Q2",
      accession_number: q2Accn,
      source_id: SEC_SOURCE_ID,
      as_of: "2024-05-03T20:30:00.000Z",
    }),
    /no us-gaap values/,
  );
});

// A filing repeats prior years' values under its own fy/fp/accession; its own
// period is the one ending last. Real values from AAPL's FY2024 10-K, oldest
// first as data.sec.gov lists them.
test("annual companyfacts extraction takes the filing's own year, not a comparative", () => {
  const facts = aaplCompanyFactsFixture();
  const fy = { fy: 2024, fp: "FY", form: "10-K", accn: AAPL_FY2024_ACCN, filed: "2024-11-01" };
  facts.facts["us-gaap"]!.RevenueFromContractWithCustomerExcludingAssessedTax.units.USD = [
    value({ val: 394_328_000_000, ...fy, start: "2021-09-26", end: "2022-09-24", frame: "CY2022" }),
    value({ val: 383_285_000_000, ...fy, start: "2022-09-25", end: "2023-09-30" }),
    value({ val: 391_035_000_000, ...fy, start: "2023-10-01", end: "2024-09-28" }),
  ];
  const statement = extractStatement({
    subject: aaplIssuer,
    facts,
    family: "income",
    fiscal_year: 2024,
    fiscal_period: "FY",
    source_id: SEC_SOURCE_ID,
    as_of: RETRIEVED_AT,
  });
  assert.equal(statement.period_end, "2024-09-28");
  assert.equal(statement.lines.find((line) => line.metric_key === "revenue")?.value_num, 391_035_000_000);
});

// Real values from NVDA's Q2 FY2026 10-Q: the prior-year quarter carries the
// calendar frame, the current one does not (a later filing holds its frame).
test("quarterly companyfacts extraction takes the filing's own quarter over a framed comparative", () => {
  const nvdaQ2 = { fy: 2026, fp: "Q2", form: "10-Q", accn: "0001045810-25-000209", filed: "2025-08-27" };
  const facts: SecCompanyFacts = {
    cik: 1045810,
    entityName: "NVIDIA Corp",
    facts: {
      "us-gaap": {
        Revenues: {
          label: "Revenues",
          description: "Revenues.",
          units: {
            USD: [
              value({ val: 56_084_000_000, ...nvdaQ2, start: "2024-01-29", end: "2024-07-28" }),
              value({ val: 30_040_000_000, ...nvdaQ2, start: "2024-04-29", end: "2024-07-28", frame: "CY2024Q2" }),
              value({ val: 90_805_000_000, ...nvdaQ2, start: "2025-01-27", end: "2025-07-27" }),
              value({ val: 46_743_000_000, ...nvdaQ2, start: "2025-04-28", end: "2025-07-27" }),
            ],
          },
        },
      },
    },
  };
  const statement = extractStatement({
    subject: aaplIssuer,
    facts,
    family: "income",
    fiscal_year: 2026,
    fiscal_period: "Q2",
    source_id: SEC_SOURCE_ID,
    as_of: RETRIEVED_AT,
  });
  assert.equal(statement.period_start, "2025-04-28");
  assert.equal(statement.lines.find((line) => line.metric_key === "revenue")?.value_num, 46_743_000_000);
});

// Real values: NVDA tagged its FY2021 Q1 10-Q (quarter ending 2020-04-26) fy=2020,
// so fy=2020 Q1 holds two filings' quarters and the wrong one ends last. The
// FY2020 10-K's own year (2019-01-28..2020-01-26) bounds it.
test("a quarter outside its fiscal year is another year's, whatever its fy says", () => {
  const revenues = (values: SecConceptValue[]) => ({ label: "", description: "", units: { USD: values } });
  const fy2020 = { fy: 2020, fp: "FY", form: "10-K", accn: "0001045810-20-000010", filed: "2020-02-20" };
  const q1Fy2020 = { fy: 2020, fp: "Q1", form: "10-Q", accn: "0001045810-19-000079", filed: "2019-05-23" };
  const q1Fy2021 = { fy: 2020, fp: "Q1", form: "10-Q", accn: "0001045810-20-000065", filed: "2020-05-22" };
  const facts: SecCompanyFacts = {
    cik: 1045810,
    entityName: "NVIDIA Corp",
    facts: {
      "us-gaap": {
        Revenues: revenues([
          value({ val: 10_918_000_000, ...fy2020, start: "2019-01-28", end: "2020-01-26" }),
          value({ val: 2_220_000_000, ...q1Fy2020, start: "2019-01-28", end: "2019-04-28" }),
          value({ val: 3_080_000_000, ...q1Fy2021, start: "2020-01-27", end: "2020-04-26" }),
        ]),
      },
    },
  };
  const statement = extractStatement({
    subject: aaplIssuer,
    facts,
    family: "income",
    fiscal_year: 2020,
    fiscal_period: "Q1",
    source_id: SEC_SOURCE_ID,
    as_of: RETRIEVED_AT,
  });
  assert.equal(statement.period_end, "2019-04-28");
  assert.equal(statement.lines.find((line) => line.metric_key === "revenue")?.value_num, 2_220_000_000);
  // Before the year's 10-K is filed, the year runs up to 53 weeks past the previous one.
  assert.deepEqual(secFiscalYearWindow(facts, 2021), { start: "2020-01-27", end: "2021-01-31" });
  assert.equal(secFiscalYearWindow(facts, 2022), null);
});

// A 10-K can carry an annual context that is not the reporting year (a
// footnote's next-year commitment): only primary-statement concepts date the year.
test("the fiscal year's dates come from its statements, not a footnote's annual context", () => {
  const fy2020 = { fy: 2020, fp: "FY", form: "10-K", accn: "0001045810-20-000010", filed: "2020-02-20" };
  const concept = (values: SecConceptValue[]) => ({ label: "", description: "", units: { USD: values } });
  const facts: SecCompanyFacts = {
    cik: 1045810,
    entityName: "NVIDIA Corp",
    facts: {
      "us-gaap": {
        PurchaseObligationDueInNextFiscalYear: concept([
          value({ val: 1_000_000_000, ...fy2020, start: "2020-01-27", end: "2021-01-31" }),
        ]),
        Revenues: concept([
          value({ val: 10_918_000_000, ...fy2020, start: "2019-01-28", end: "2020-01-26" }),
        ]),
      },
    },
  };
  assert.deepEqual(secFiscalYearWindow(facts, 2020), { start: "2019-01-28", end: "2020-01-26" });
});

// A pre-2021 10-K also tags its fourth quarter alone as fp=FY, ending the same
// day as the year; the year is the full-length one, in any listing order.
test("annual extraction takes the full year, not a fourth quarter tagged FY", () => {
  const facts = aaplCompanyFactsFixture();
  const fy = { fy: 2024, fp: "FY", form: "10-K", accn: AAPL_FY2024_ACCN, filed: "2024-11-01" };
  facts.facts["us-gaap"]!.RevenueFromContractWithCustomerExcludingAssessedTax.units.USD = [
    value({ val: 391_035_000_000, ...fy, start: "2023-10-01", end: "2024-09-28" }),
    value({ val: 94_930_000_000, ...fy, start: "2024-06-30", end: "2024-09-28" }),
  ];
  const statement = extractStatement({
    subject: aaplIssuer,
    facts,
    family: "income",
    fiscal_year: 2024,
    fiscal_period: "FY",
    source_id: SEC_SOURCE_ID,
    as_of: RETRIEVED_AT,
  });
  assert.equal(statement.period_start, "2023-10-01");
  assert.equal(statement.lines.find((line) => line.metric_key === "revenue")?.value_num, 391_035_000_000);
});

test("Q4 companyfacts extraction derives flow values from FY minus the first three discrete quarters", () => {
  const facts = aaplCompanyFactsFixture();
  const usGaap = facts.facts["us-gaap"]!;
  const annual = {
    fy: 2024,
    fp: "FY",
    form: "10-K",
    accn: AAPL_FY2024_ACCN,
    filed: "2024-11-01",
    start: "2023-10-01",
    end: "2024-09-28",
  };
  const q1 = {
    fy: 2024,
    fp: "Q1",
    form: "10-Q",
    accn: "0000320193-24-000006",
    filed: "2024-02-02",
    start: "2023-10-01",
    end: "2023-12-30",
    frame: "CY2023Q4",
  };
  const q2 = {
    fy: 2024,
    fp: "Q2",
    form: "10-Q",
    accn: "0000320193-24-000069",
    filed: "2024-05-03",
    start: "2023-12-31",
    end: "2024-03-30",
    frame: "CY2024Q1",
  };
  const q3 = {
    fy: 2024,
    fp: "Q3",
    form: "10-Q",
    accn: "0000320193-24-000081",
    filed: "2024-08-02",
    start: "2024-03-31",
    end: "2024-06-29",
    frame: "CY2024Q2",
  };

  usGaap.RevenueFromContractWithCustomerExcludingAssessedTax.units.USD = [
    value({ val: 391_035_000_000, ...annual }),
    value({ val: 119_575_000_000, ...q1 }),
    value({ val: 90_753_000_000, ...q2 }),
    value({ val: 85_777_000_000, ...q3 }),
  ];
  usGaap.NetIncomeLoss.units.USD = [
    value({ val: 93_736_000_000, ...annual }),
    value({ val: 33_916_000_000, ...q1 }),
    value({ val: 23_636_000_000, ...q2 }),
    value({ val: 21_448_000_000, ...q3 }),
  ];
  usGaap.EarningsPerShareBasic.units["USD/shares"] = [
    value({ val: 6.11, ...annual }),
    value({ val: 2.19, ...q1 }),
    value({ val: 1.53, ...q2 }),
    value({ val: 1.40, ...q3 }),
  ];

  const statement = normalizedStatement(extractStatement({
    subject: aaplIssuer,
    facts,
    family: "income",
    fiscal_year: 2024,
    fiscal_period: "Q4",
    accession_number: AAPL_FY2024_ACCN,
    source_id: SEC_SOURCE_ID,
    as_of: "2024-11-01T20:30:00.000Z",
  }));

  assert.equal(statement.period_kind, "fiscal_q");
  assert.equal(statement.period_start, "2024-06-30");
  assert.equal(statement.period_end, "2024-09-28");
  assert.equal(statement.lines.find((line) => line.metric_key === "revenue")?.value_num, 94_930_000_000);
  assert.equal(statement.lines.find((line) => line.metric_key === "net_income")?.value_num, 14_736_000_000);
  assert.equal(statement.lines.find((line) => line.metric_key === "eps_basic"), undefined);
});

test("Facts produced from AAPL companyfacts carry both SEC source_id and resolved metric_id (end-to-end)", () => {
  const source = buildSecSource({
    source_id: SEC_SOURCE_ID,
    cik: AAPL_CIK,
    accession_number: AAPL_FY2024_ACCN,
    retrieved_at: RETRIEVED_AT,
    content_hash: "sha256:test-hash",
  });
  assert.equal(source.source_id, SEC_SOURCE_ID);

  const statement = normalizedStatement(
    extractStatement({
      subject: aaplIssuer,
      facts: aaplCompanyFactsFixture(),
      family: "income",
      fiscal_year: 2024,
      fiscal_period: "FY",
      source_id: source.source_id,
      as_of: "2024-11-01T20:30:00.000Z",
    }),
  );
  const mapped = mapStatement(secIncomeMetricRegistry(), statement);

  assert.equal(mapped.source_id, source.source_id);
  for (const line of mapped.lines) {
    assert.ok(line.metric_id, `line ${line.metric_key} must have a metric_id`);
  }
  // Spot-check a wired value.
  const revenueLine = mapped.lines.find((l) => l.metric_key === "revenue");
  assert.equal(revenueLine?.metric_id, "aaaaaaaa-aaaa-4aaa-aaaa-aaaa10000001");
  assert.equal(revenueLine?.value_num, 391_035_000_000);
});

// --- Source-row contract --------------------------------------------------

test("buildSecSource produces a primary-tier filing source aligned with db/seed/sources.sql", () => {
  const source = buildSecSource({
    source_id: SEC_SOURCE_ID,
    cik: AAPL_CIK,
    accession_number: AAPL_FY2024_ACCN,
    retrieved_at: RETRIEVED_AT,
    content_hash: "sha256:abc123",
  });
  assert.equal(source.provider, "sec_edgar");
  assert.equal(source.kind, "filing");
  assert.equal(source.trust_tier, "primary");
  assert.equal(source.license_class, "public");
  // EDGAR archive URL: cik unpadded, accession-no-dashes in path.
  assert.equal(
    source.canonical_url,
    "https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/0000320193-24-000123-index.htm",
  );
  assert.equal(Object.isFrozen(source), true);
});

test("buildSecSource rejects malformed accession numbers", () => {
  const base = {
    source_id: SEC_SOURCE_ID,
    cik: AAPL_CIK,
    retrieved_at: RETRIEVED_AT,
    content_hash: "x",
  };
  for (const bad of ["", "0000320193", "0000320193-24", "0000320193-24-12345", "abc"]) {
    assert.throws(
      () => buildSecSource({ ...base, accession_number: bad }),
      /accession_number/,
      `expected accession_number=${JSON.stringify(bad)} to be rejected`,
    );
  }
});

test("buildSecSource rejects non-UUID source_id and non-positive cik", () => {
  const base = {
    accession_number: AAPL_FY2024_ACCN,
    retrieved_at: RETRIEVED_AT,
    content_hash: "x",
  };
  assert.throws(
    () => buildSecSource({ ...base, source_id: "not-a-uuid", cik: AAPL_CIK }),
    /source_id.*UUID v4/,
  );
  assert.throws(
    () => buildSecSource({ ...base, source_id: SEC_SOURCE_ID, cik: 0 }),
    /cik/,
  );
  assert.throws(
    () => buildSecSource({ ...base, source_id: SEC_SOURCE_ID, cik: -1 }),
    /cik/,
  );
});

// --- Fetcher abstraction & path construction ------------------------------

test("companyFactsPath left-pads CIK to 10 digits", () => {
  assert.equal(
    companyFactsPath(AAPL_CIK),
    "/api/xbrl/companyfacts/CIK0000320193.json",
  );
  assert.equal(
    companyFactsPath(1),
    "/api/xbrl/companyfacts/CIK0000000001.json",
  );
});

test("companyFactsPath rejects invalid CIKs", () => {
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => companyFactsPath(bad), /cik/);
  }
});

test("fetchCompanyFacts calls the fetcher with the padded path and returns the parsed payload", async () => {
  const calls: string[] = [];
  const fixture = aaplCompanyFactsFixture();
  const fetched = secFetched(fixture, { completed_at: "2024-02-01T10:05:00.000Z" });
  const fetcher: SecEdgarFetcher = async (path) => {
    calls.push(path);
    return fetched;
  };
  const { facts, evidence } = await fetchCompanyFacts(fetcher, AAPL_CIK);
  assert.deepEqual(calls, ["/api/xbrl/companyfacts/CIK0000320193.json"]);
  assert.equal(facts.entityName, "Apple Inc.");
  assert.deepEqual(evidence, { url: fetched.url, body_sha256: fetched.body_sha256, completed_at: "2024-02-01T10:05:00.000Z" });
});

test("fetchCompanyFacts rejects malformed responses", async () => {
  const fetcher: SecEdgarFetcher = async () => secFetched({ wrong: "shape" });
  await assert.rejects(
    fetchCompanyFacts(fetcher, AAPL_CIK),
    /cik/,
  );
});

// --- Companyfacts schema validation ---------------------------------------

test("assertCompanyFacts rejects malformed inputs", () => {
  assert.throws(() => assertCompanyFacts(null, "x"), /must be an object/);
  assert.throws(() => assertCompanyFacts({}, "x"), /cik/);
  assert.throws(
    () => assertCompanyFacts({ cik: "320193" }, "x"),
    /cik.*positive integer/,
  );
  assert.throws(
    () => assertCompanyFacts({ cik: 1, entityName: "" }, "x"),
    /entityName/,
  );
  assert.throws(
    () => assertCompanyFacts({ cik: 1, entityName: "x" }, "x"),
    /facts/,
  );
});

// --- Period-selection guards ----------------------------------------------

test("extractStatement rejects when no values match the requested fiscal_year/fp", () => {
  assert.throws(
    () =>
      extractStatement({
        subject: aaplIssuer,
        facts: aaplCompanyFactsFixture(),
        family: "income",
        fiscal_year: 2099,
        fiscal_period: "FY",
        source_id: SEC_SOURCE_ID,
        as_of: "2024-11-01T20:30:00.000Z",
      }),
    /no us-gaap values for fiscal_year=2099/,
  );
});

test("extractStatement skips concepts whose form doesn't match the period (10-K vs 10-Q)", () => {
  // Mark every fixture value as a 10-Q (i.e., quarterly), then ask for FY (10-K).
  const fixture = aaplCompanyFactsFixture();
  const usGaap = fixture.facts["us-gaap"]!;
  for (const concept of Object.values(usGaap)) {
    for (const unit of Object.keys(concept.units)) {
      concept.units[unit] = concept.units[unit].map((v) => ({ ...v, form: "10-Q" }));
    }
  }
  assert.throws(
    () =>
      extractStatement({
        subject: aaplIssuer,
        facts: fixture,
        family: "income",
        fiscal_year: 2024,
        fiscal_period: "FY",
        source_id: SEC_SOURCE_ID,
        as_of: "2024-11-01T20:30:00.000Z",
      }),
    /no us-gaap values for fiscal_year=2024 fiscal_period="FY" form="10-K"/,
  );
});

test("extractStatement rejects matched statements with no observed reporting currency", () => {
  const fixture = aaplCompanyFactsFixture();
  const sharesConcept = fixture.facts["us-gaap"]!.WeightedAverageNumberOfSharesOutstandingBasic;
  fixture.facts["us-gaap"] = {
    WeightedAverageNumberOfSharesOutstandingBasic: sharesConcept,
  };

  assert.throws(
    () =>
      extractStatement({
        subject: aaplIssuer,
        facts: fixture,
        family: "income",
        fiscal_year: 2024,
        fiscal_period: "FY",
        source_id: SEC_SOURCE_ID,
        as_of: "2024-11-01T20:30:00.000Z",
      }),
    /no monetary lines extracted.*reporting_currency/,
  );
});

test("extractStatement (income) ignores balance/cashflow concepts even if present", () => {
  // Inject a balance-sheet concept; it must NOT appear in the income lines.
  const fixture = aaplCompanyFactsFixture();
  fixture.facts["us-gaap"]!.Assets = {
    label: "Total Assets",
    description: "Balance sheet — total assets.",
    units: {
      USD: [value({ val: 365_000_000_000, end: "2024-09-28" })],
    },
  };
  const input = extractStatement({
    subject: aaplIssuer,
    facts: fixture,
    family: "income",
    fiscal_year: 2024,
    fiscal_period: "FY",
    source_id: SEC_SOURCE_ID,
    as_of: "2024-11-01T20:30:00.000Z",
  });
  assert.equal(input.lines.find((l) => l.metric_key === "total_assets"), undefined);
});

// --- Concept→metric_key mapping ------------------------------------------

test("US_GAAP_TO_METRIC_KEY collapses revenue aliases to a single canonical key", () => {
  // Three different XBRL tags for the same business concept (legacy, mid-era, ASC 606).
  assert.equal(US_GAAP_TO_METRIC_KEY.Revenues, "revenue");
  assert.equal(US_GAAP_TO_METRIC_KEY.SalesRevenueNet, "revenue");
  assert.equal(
    US_GAAP_TO_METRIC_KEY.RevenueFromContractWithCustomerExcludingAssessedTax,
    "revenue",
  );
});

// NVDA FY2026 (ends 2026-01-25), real values: each 10-Q states cash flows year
// to date, beside the prior year's comparatives, and balances at its own period
// end beside the prior year end's.
const NVDA_FILINGS = {
  Q1: { fy: 2026, fp: "Q1", form: "10-Q", accn: "0001045810-25-000116", filed: "2025-05-28" },
  Q2: { fy: 2026, fp: "Q2", form: "10-Q", accn: "0001045810-25-000209", filed: "2025-08-27" },
  Q3: { fy: 2026, fp: "Q3", form: "10-Q", accn: "0001045810-25-000230", filed: "2025-11-19" },
  FY: { fy: 2026, fp: "FY", form: "10-K", accn: "0001045810-26-000021", filed: "2026-02-25" },
} as const;

function nvdaCashAndBalanceFixture(): SecCompanyFacts {
  const { Q1, Q2, Q3, FY } = NVDA_FILINGS;
  const flow = (q1: number, h1: number, m9: number, fy: number, prior: [number, number, number, number]) => [
    value({ val: prior[0], ...Q1, start: "2024-01-29", end: "2024-04-28", frame: "CY2024Q1" }),
    value({ val: prior[1], ...Q2, start: "2024-01-29", end: "2024-07-28" }),
    value({ val: prior[2], ...Q3, start: "2024-01-29", end: "2024-10-27" }),
    value({ val: prior[3], ...FY, start: "2024-01-29", end: "2025-01-26", frame: "CY2024" }),
    value({ val: q1, ...Q1, start: "2025-01-27", end: "2025-04-27" }),
    value({ val: h1, ...Q2, start: "2025-01-27", end: "2025-07-27" }),
    value({ val: m9, ...Q3, start: "2025-01-27", end: "2025-10-26" }),
    value({ val: fy, ...FY, start: "2025-01-27", end: "2026-01-25", frame: "CY2025" }),
  ];
  const balance = (priorYearEnd: number, q1: number, q2: number, q3: number, fy: number) => [
    ...[Q1, Q2, Q3, FY].map((filing) => value({ val: priorYearEnd, ...filing, end: "2025-01-26" })),
    value({ val: q1, ...Q1, end: "2025-04-27" }),
    value({ val: q2, ...Q2, end: "2025-07-27" }),
    value({ val: q3, ...Q3, end: "2025-10-26" }),
    value({ val: fy, ...FY, end: "2026-01-25" }),
  ];
  const concept = (values: SecConceptValue[]) => ({ label: "", description: "", units: { USD: values } });
  return {
    cik: 1045810,
    entityName: "NVIDIA Corp",
    facts: {
      "us-gaap": {
        NetCashProvidedByUsedInOperatingActivities: concept(
          flow(27_414_000_000, 42_779_000_000, 66_530_000_000, 102_718_000_000, [15_345_000_000, 29_833_000_000, 47_460_000_000, 64_089_000_000]),
        ),
        PaymentsToAcquireProductiveAssets: concept(
          flow(1_227_000_000, 3_122_000_000, 4_758_000_000, 6_042_000_000, [369_000_000, 1_346_000_000, 2_159_000_000, 3_236_000_000]),
        ),
        Assets: concept(balance(111_601_000_000, 125_254_000_000, 140_740_000_000, 161_148_000_000, 206_803_000_000)),
        Liabilities: concept(balance(32_274_000_000, 41_411_000_000, 40_609_000_000, 42_251_000_000, 49_510_000_000)),
        StockholdersEquity: concept(balance(79_327_000_000, 83_843_000_000, 100_131_000_000, 118_897_000_000, 157_293_000_000)),
        CashAndCashEquivalentsAtCarryingValue: concept(balance(8_589_000_000, 15_234_000_000, 11_639_000_000, 11_486_000_000, 10_605_000_000)),
      },
    },
  };
}

function nvdaStatement(family: "cashflow" | "balance", fiscal_period: "Q1" | "Q2" | "Q3" | "Q4" | "FY") {
  const filing = NVDA_FILINGS[fiscal_period === "Q4" ? "FY" : fiscal_period];
  return normalizedStatement(extractStatement({
    subject: aaplIssuer,
    facts: nvdaCashAndBalanceFixture(),
    family,
    fiscal_year: 2026,
    fiscal_period,
    accession_number: filing.accn,
    source_id: SEC_SOURCE_ID,
    as_of: RETRIEVED_AT,
  }));
}

function lineValue(statement: ReturnType<typeof nvdaStatement>, key: string): number | null | undefined {
  return statement.lines.find((line) => line.metric_key === key)?.value_num;
}

test("cash flow extraction turns year-to-date 10-Q values into discrete quarters", () => {
  const expected = {
    Q1: { start: "2025-01-27", end: "2025-04-27", ocf: 27_414_000_000, capex: 1_227_000_000 },
    Q2: { start: "2025-04-28", end: "2025-07-27", ocf: 15_365_000_000, capex: 1_895_000_000 },
    Q3: { start: "2025-07-28", end: "2025-10-26", ocf: 23_751_000_000, capex: 1_636_000_000 },
    Q4: { start: "2025-10-27", end: "2026-01-25", ocf: 36_188_000_000, capex: 1_284_000_000 },
    FY: { start: "2025-01-27", end: "2026-01-25", ocf: 102_718_000_000, capex: 6_042_000_000 },
  } as const;
  for (const [period, want] of Object.entries(expected) as Array<[keyof typeof expected, (typeof expected)[keyof typeof expected]]>) {
    const statement = nvdaStatement("cashflow", period);
    assert.equal(statement.family, "cashflow");
    assert.equal(statement.period_kind, period === "FY" ? "fiscal_y" : "fiscal_q", period);
    assert.equal(statement.period_start, want.start, period);
    assert.equal(statement.period_end, want.end, period);
    assert.equal(lineValue(statement, "operating_cash_flow"), want.ocf, period);
    assert.equal(lineValue(statement, "capex"), want.capex, period);
  }
});

test("cash flow extraction derives no quarter when the year-to-date values start on different days", () => {
  const facts = nvdaCashAndBalanceFixture();
  for (const concept of Object.values(facts.facts["us-gaap"]!)) {
    concept.units.USD = concept.units.USD!.map((entry) =>
      entry.fp === "Q1" && entry.start === "2025-01-27" ? { ...entry, start: "2025-01-20" } : entry,
    );
  }
  assert.throws(
    () => extractStatement({
      subject: aaplIssuer,
      facts,
      family: "cashflow",
      fiscal_year: 2026,
      fiscal_period: "Q2",
      source_id: SEC_SOURCE_ID,
      as_of: RETRIEVED_AT,
    }),
    /no us-gaap values/,
  );
});

test("balance sheet extraction reads the filing's own period-end instants as a point", () => {
  const q2 = nvdaStatement("balance", "Q2");
  assert.equal(q2.family, "balance");
  assert.equal(q2.period_kind, "point");
  assert.equal(q2.period_start, null);
  assert.equal(q2.period_end, "2025-07-27");
  assert.equal(q2.fiscal_period, "FY");
  assert.equal(lineValue(q2, "total_assets"), 140_740_000_000);
  assert.equal(lineValue(q2, "total_liabilities"), 40_609_000_000);
  assert.equal(lineValue(q2, "total_equity"), 100_131_000_000);
  assert.equal(lineValue(q2, "cash_and_equivalents"), 11_639_000_000);
  // The fourth quarter ends with the year: the annual report's balance.
  for (const period of ["Q4", "FY"] as const) {
    const yearEnd = nvdaStatement("balance", period);
    assert.equal(yearEnd.period_end, "2026-01-25", period);
    assert.equal(lineValue(yearEnd, "total_assets"), 206_803_000_000, period);
  }
});

test("each family extracts only its own concepts", () => {
  assert.deepEqual(nvdaStatement("cashflow", "FY").lines.map((line) => line.metric_key).sort(), ["capex", "operating_cash_flow"]);
  assert.deepEqual(
    nvdaStatement("balance", "FY").lines.map((line) => line.metric_key).sort(),
    ["cash_and_equivalents", "total_assets", "total_equity", "total_liabilities"],
  );
});

test("extractStatement rejects a payload missing the us-gaap taxonomy", () => {
  const fixture: SecCompanyFacts = {
    cik: AAPL_CIK,
    entityName: "Apple Inc.",
    facts: {},
  };
  assert.throws(
    () =>
      extractStatement({
        subject: aaplIssuer,
        facts: fixture,
        family: "income",
        fiscal_year: 2024,
        fiscal_period: "FY",
        source_id: SEC_SOURCE_ID,
        as_of: "2024-11-01T20:30:00.000Z",
      }),
    /no "us-gaap" taxonomy/,
  );
});

test("extractStatement collision policy: modern (post-ASC 606) concept name wins over legacy aliases", () => {
  // Construct a fixture where both `Revenues` (legacy) and
  // `RevenueFromContractWithCustomerExcludingAssessedTax` (post-ASC 606)
  // are present with different values. The modern tag must win.
  const fixture = aaplCompanyFactsFixture();
  fixture.facts["us-gaap"]!.Revenues = {
    label: "Revenues (legacy)",
    description: "Pre-ASC 606 revenue tag.",
    units: {
      USD: [value({ val: 999_999_999, end: "2024-09-28", start: "2023-10-01" })],
    },
  };
  const input = extractStatement({
    subject: aaplIssuer,
    facts: fixture,
    family: "income",
    fiscal_year: 2024,
    fiscal_period: "FY",
    source_id: SEC_SOURCE_ID,
    as_of: "2024-11-01T20:30:00.000Z",
  });
  const revenue = input.lines.find((l) => l.metric_key === "revenue");
  assert.equal(revenue?.value_num, 391_035_000_000);
});

test("extractStatement skips concepts whose `units` field is malformed (defensive)", () => {
  // assertCompanyFacts validates only top-level shape; deeper malformations
  // shouldn't crash extractStatement with a confusing TypeError.
  const fixture = aaplCompanyFactsFixture();
  // Inject a mapped concept with no `units` field (e.g., truncated payload).
  // Bypass the type system since this models bad runtime data.
  const usGaap = fixture.facts["us-gaap"] as Record<string, unknown>;
  usGaap.NetIncomeLoss = { label: "Net Income / (Loss)", description: "Malformed." };

  const input = extractStatement({
    subject: aaplIssuer,
    facts: fixture,
    family: "income",
    fiscal_year: 2024,
    fiscal_period: "FY",
    source_id: SEC_SOURCE_ID,
    as_of: "2024-11-01T20:30:00.000Z",
  });
  // Other concepts still extract; the malformed one is silently skipped.
  assert.equal(input.lines.find((l) => l.metric_key === "net_income"), undefined);
  assert.ok(input.lines.find((l) => l.metric_key === "revenue"));
});

test("extractStatement rejects period drift across matched concepts", () => {
  const fixture = aaplCompanyFactsFixture();
  // Tamper one concept's period_end to disagree with the others.
  const tampered = fixture.facts["us-gaap"]!.NetIncomeLoss;
  tampered.units.USD = tampered.units.USD.map((v) => ({ ...v, end: "2024-09-29" }));
  assert.throws(
    () =>
      extractStatement({
        subject: aaplIssuer,
        facts: fixture,
        family: "income",
        fiscal_year: 2024,
        fiscal_period: "FY",
        source_id: SEC_SOURCE_ID,
        as_of: "2024-11-01T20:30:00.000Z",
      }),
    /period .* disagrees with prior matches/,
  );
});

test("extractStatement output: lines are plain mutable inputs (NormalizedStatementInput, not yet frozen)", () => {
  // The contract is "input to normalizedStatement(...)", which freezes
  // downstream. Keep the extraction output intentionally caller-owned so
  // tests like the full-pipeline test can spread/mutate it before
  // normalizing.
  const input = extractStatement({
    subject: aaplIssuer,
    facts: aaplCompanyFactsFixture(),
    family: "income",
    fiscal_year: 2024,
    fiscal_period: "FY",
    source_id: SEC_SOURCE_ID,
    as_of: "2024-11-01T20:30:00.000Z",
  });
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(input.lines), false);
});

test("SEC_METRIC_KEYS_BY_FAMILY places every mapped metric_key in exactly one family", () => {
  // A registry built from these keys must cover the extractor's full output
  // range, and no metric may be read by two families.
  assert.deepEqual(SEC_METRIC_KEYS_BY_FAMILY.income, SEC_INCOME_METRIC_KEYS);
  for (const metricKey of new Set(Object.values(US_GAAP_TO_METRIC_KEY))) {
    const families = Object.entries(SEC_METRIC_KEYS_BY_FAMILY).filter(([, keys]) => keys.includes(metricKey));
    assert.equal(families.length, 1, `expected "${metricKey}" in exactly one family`);
  }
});
