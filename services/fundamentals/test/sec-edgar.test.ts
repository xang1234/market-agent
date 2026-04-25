import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCompanyFacts,
  buildSecSource,
  companyFactsPath,
  extractStatement,
  fetchCompanyFacts,
  SEC_INCOME_METRIC_KEYS,
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
    metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaa10000008", "shares_outstanding_basic", "Shares Outstanding (Basic)", "count", "avg"),
    metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaa10000009", "shares_outstanding_diluted", "Shares Outstanding (Diluted)", "count", "avg"),
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
  assert.equal(byKey.get("shares_outstanding_basic")?.value_num, 15_343_783_000);
  assert.equal(byKey.get("shares_outstanding_basic")?.unit, "shares");
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

test("buildSecSource produces a primary-tier filing source with EDGAR archive URL", () => {
  const source = buildSecSource({
    source_id: SEC_SOURCE_ID,
    cik: AAPL_CIK,
    accession_number: AAPL_FY2024_ACCN,
    retrieved_at: RETRIEVED_AT,
    content_hash: "sha256:abc123",
  });
  assert.equal(source.provider, "sec.gov");
  assert.equal(source.kind, "filing");
  assert.equal(source.trust_tier, "primary");
  assert.equal(source.license_class, "public_domain");
  assert.equal(source.accession_number, AAPL_FY2024_ACCN);
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
  const fetcher: SecEdgarFetcher = async (path) => {
    calls.push(path);
    return fixture;
  };
  const facts = await fetchCompanyFacts(fetcher, AAPL_CIK);
  assert.deepEqual(calls, ["/api/xbrl/companyfacts/CIK0000320193.json"]);
  assert.equal(facts.entityName, "Apple Inc.");
});

test("fetchCompanyFacts rejects malformed responses", async () => {
  const fetcher: SecEdgarFetcher = async () => ({ wrong: "shape" });
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

test("SEC_INCOME_METRIC_KEYS lists the income-statement keys this module emits", () => {
  // Sanity: every key the extractor can produce for income-family extraction
  // is exposed for downstream registry/coverage tooling.
  const set = new Set(SEC_INCOME_METRIC_KEYS);
  for (const key of Object.values(US_GAAP_TO_METRIC_KEY)) {
    if (
      key === "operating_expenses" // OperatingExpenses is mapped but classified income-relevant
    ) continue;
    assert.ok(
      set.has(key),
      `expected SEC_INCOME_METRIC_KEYS to include "${key}" (mapped from a US-GAAP concept)`,
    );
  }
});
