import test from "node:test";
import assert from "node:assert/strict";
import {
  buildKeyStats,
  type KeyStat,
  type MarketPriceInput,
} from "../src/key-stats.ts";
import {
  createMetricRegistry,
  mapStatement,
  type MappedStatement,
  type MetricDefinition,
} from "../src/metric-mapper.ts";
import {
  extractStatement,
  type SecCompanyFacts,
  type SecConceptValue,
} from "../src/sec-edgar.ts";
import { normalizedStatement } from "../src/statement.ts";
import {
  AAPL_FY2024_KNOWN_VALUES,
  aaplIssuer,
} from "./fixtures.ts";

const MARKET_PRICE_SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const MARKET_PRICE_FACT_ID = "33333333-3333-4333-8333-333333333333";
const SEC_SOURCE_ID = "00000000-0000-4000-a000-0000000000ed";
const OTHER_ISSUER = {
  kind: "issuer",
  id: "44444444-4444-4444-8444-444444444444",
} as const;

function aaplMappedStatement(): MappedStatement {
  return aaplSecMappedStatement({
    fiscal_year: 2024,
    period_start: "2023-10-01",
    period_end: "2024-09-28",
    as_of: "2024-11-01T20:30:00.000Z",
    revenue: AAPL_FY2024_KNOWN_VALUES.net_sales_total,
  });
}

function aaplPriorMappedStatement(): MappedStatement {
  return aaplSecMappedStatement({
    fiscal_year: 2023,
    period_start: "2022-09-25",
    period_end: "2023-09-30",
    as_of: "2023-11-03T20:30:00.000Z",
    revenue: 383_285_000_000,
  });
}

function aaplSecMappedStatement(opts: {
  fiscal_year: number;
  period_start: string;
  period_end: string;
  as_of: string;
  revenue: number;
}): MappedStatement {
  return mapStatement(
    secIncomeMetricRegistry(),
    normalizedStatement(
      extractStatement({
        subject: aaplIssuer,
        facts: aaplCompanyFactsFixture(opts),
        family: "income",
        fiscal_year: opts.fiscal_year,
        fiscal_period: "FY",
        source_id: SEC_SOURCE_ID,
        as_of: opts.as_of,
        reported_at: opts.as_of,
      }),
    ),
  );
}

function priceInput(overrides: Partial<MarketPriceInput> = {}): MarketPriceInput {
  return {
    subject: aaplIssuer,
    fact_id: MARKET_PRICE_FACT_ID,
    value_num: 189.98,
    currency: "USD",
    as_of: "2024-11-04T21:00:00.000Z",
    source_id: MARKET_PRICE_SOURCE_ID,
    ...overrides,
  };
}

function statByKey(stats: ReadonlyArray<KeyStat>, key: KeyStat["stat_key"]): KeyStat {
  const stat = stats.find((s) => s.stat_key === key);
  if (!stat) throw new Error(`missing stat ${key}`);
  return stat;
}

test("buildKeyStats computes AAPL FY2024 margins with explicit statement assumptions and inputs", () => {
  const envelope = buildKeyStats({ statement: aaplMappedStatement() });
  const gross = statByKey(envelope.stats, "gross_margin");
  const operating = statByKey(envelope.stats, "operating_margin");
  const net = statByKey(envelope.stats, "net_margin");

  assert.deepEqual(envelope.subject, { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" });
  assert.equal(gross.value_num, AAPL_FY2024_KNOWN_VALUES.gross_profit / AAPL_FY2024_KNOWN_VALUES.net_sales_total);
  assert.equal(operating.value_num, AAPL_FY2024_KNOWN_VALUES.operating_income / AAPL_FY2024_KNOWN_VALUES.net_sales_total);
  assert.equal(net.value_num, AAPL_FY2024_KNOWN_VALUES.net_income / AAPL_FY2024_KNOWN_VALUES.net_sales_total);

  assert.equal(gross.unit, "ratio");
  assert.equal(gross.format_hint, "percent");
  assert.equal(gross.coverage_level, "full");
  assert.equal(gross.basis, "as_reported");
  assert.equal(gross.period_kind, "fiscal_y");
  assert.equal(gross.period_start, "2023-10-01");
  assert.equal(gross.period_end, "2024-09-28");
  assert.equal(gross.fiscal_year, 2024);
  assert.equal(gross.fiscal_period, "FY");
  assert.equal(gross.as_of, "2024-11-01T20:30:00.000Z");
  assert.deepEqual(gross.computation, {
    kind: "ratio",
    expression: "gross_profit / revenue",
  });
  assert.deepEqual(
    gross.inputs.map((input) => [input.kind, input.role, input.metric_key, input.value_num]),
    [
      ["statement_line", "numerator", "gross_profit", AAPL_FY2024_KNOWN_VALUES.gross_profit],
      ["statement_line", "denominator", "revenue", AAPL_FY2024_KNOWN_VALUES.net_sales_total],
    ],
  );
});

test("buildKeyStats computes revenue growth from a prior period with both periods visible", () => {
  const current = aaplMappedStatement();
  const prior = aaplPriorMappedStatement();
  const envelope = buildKeyStats({ statement: current, prior_statement: prior });
  const growth = statByKey(envelope.stats, "revenue_growth_yoy");

  assert.equal(
    growth.value_num,
    (391_035_000_000 - 383_285_000_000) / 383_285_000_000,
  );
  assert.equal(growth.unit, "ratio");
  assert.equal(growth.format_hint, "percent");
  assert.deepEqual(growth.computation, {
    kind: "growth",
    expression: "(revenue - prior.revenue) / prior.revenue",
  });
  assert.deepEqual(
    growth.inputs.map((input) => [input.role, input.metric_key, input.period_end, input.as_of]),
    [
      ["current", "revenue", "2024-09-28", "2024-11-01T20:30:00.000Z"],
      ["prior", "revenue", "2023-09-30", "2023-11-03T20:30:00.000Z"],
    ],
  );
});

test("buildKeyStats resolves AAPL P/E as a price fact and ratio computation with visible inputs", () => {
  const envelope = buildKeyStats({
    statement: aaplMappedStatement(),
    price: priceInput(),
  });
  const pe = statByKey(envelope.stats, "pe_ratio");

  assert.equal(pe.value_num, 189.98 / AAPL_FY2024_KNOWN_VALUES.eps_diluted);
  assert.equal(pe.unit, "multiple");
  assert.equal(pe.format_hint, "multiple");
  assert.equal(pe.as_of, "2024-11-04T21:00:00.000Z");
  assert.deepEqual(pe.computation, {
    kind: "ratio",
    expression: "price / eps_diluted",
  });
  assert.deepEqual(
    pe.inputs.map((input) => [input.kind, input.role, input.metric_key, input.value_num, input.source_id]),
    [
      ["market_fact", "numerator", "price", 189.98, MARKET_PRICE_SOURCE_ID],
      ["statement_line", "denominator", "eps_diluted", AAPL_FY2024_KNOWN_VALUES.eps_diluted, SEC_SOURCE_ID],
    ],
  );
  assert.equal(pe.inputs[0].fact_id, MARKET_PRICE_FACT_ID);
  assert.deepEqual(pe.inputs[0].subject, aaplIssuer);
  assert.deepEqual(pe.warnings, []);
});

test("buildKeyStats returns unavailable stats with warnings instead of fabricating missing inputs", () => {
  const input = normalizedStatement(
    extractStatement({
      subject: aaplIssuer,
      facts: aaplCompanyFactsFixture({
        fiscal_year: 2024,
        period_start: "2023-10-01",
        period_end: "2024-09-28",
        as_of: "2024-11-01T20:30:00.000Z",
        revenue: AAPL_FY2024_KNOWN_VALUES.net_sales_total,
      }),
      family: "income",
      fiscal_year: 2024,
      fiscal_period: "FY",
      source_id: SEC_SOURCE_ID,
      as_of: "2024-11-01T20:30:00.000Z",
    }),
  );
  const statement = mapStatement(secIncomeMetricRegistry(), {
    ...input,
    lines: input.lines.filter((line) => line.metric_key !== "revenue"),
  });
  const envelope = buildKeyStats({ statement });
  const gross = statByKey(envelope.stats, "gross_margin");
  const pe = statByKey(envelope.stats, "pe_ratio");

  assert.equal(gross.value_num, null);
  assert.equal(gross.coverage_level, "unavailable");
  assert.deepEqual(gross.warnings, [
    {
      code: "missing_statement_line",
      message: "gross_margin requires denominator line revenue.",
    },
  ]);

  assert.equal(pe.value_num, null);
  assert.equal(pe.coverage_level, "unavailable");
  assert.deepEqual(pe.warnings, [
    {
      code: "missing_market_price",
      message: "pe_ratio requires a market price input.",
    },
  ]);
});

test("buildKeyStats refuses implicit FX for P/E currency mismatches", () => {
  const envelope = buildKeyStats({
    statement: aaplMappedStatement(),
    price: priceInput({ currency: "EUR" }),
  });
  const pe = statByKey(envelope.stats, "pe_ratio");

  assert.equal(pe.value_num, null);
  assert.equal(pe.coverage_level, "unavailable");
  assert.deepEqual(pe.warnings, [
    {
      code: "currency_mismatch",
      message: "pe_ratio price currency EUR does not match eps_diluted currency USD.",
    },
  ]);
});

test("buildKeyStats refuses P/E when the price fact is tied to a different issuer", () => {
  const envelope = buildKeyStats({
    statement: aaplMappedStatement(),
    price: priceInput({ subject: OTHER_ISSUER }),
  });
  const pe = statByKey(envelope.stats, "pe_ratio");

  assert.equal(pe.value_num, null);
  assert.equal(pe.coverage_level, "unavailable");
  assert.deepEqual(pe.warnings, [
    {
      code: "input_mismatch",
      message: `pe_ratio price subject ${OTHER_ISSUER.id} does not match statement subject ${aaplIssuer.id}.`,
    },
  ]);
});

test("buildKeyStats marks revenue growth unavailable for inconsistent prior statements", () => {
  const current = aaplMappedStatement();
  const mismatchedPrior = {
    ...aaplPriorMappedStatement(),
    subject: OTHER_ISSUER,
    basis: "as_restated",
    period_kind: "ttm",
    fiscal_period: "Q4",
    fiscal_year: 2021,
  } as MappedStatement;

  const envelope = buildKeyStats({
    statement: current,
    prior_statement: mismatchedPrior,
  });
  const growth = statByKey(envelope.stats, "revenue_growth_yoy");

  assert.equal(growth.value_num, null);
  assert.equal(growth.coverage_level, "unavailable");
  assert.deepEqual(growth.warnings, [
    {
      code: "input_mismatch",
      message: `revenue_growth_yoy prior statement subject ${OTHER_ISSUER.id} does not match current subject ${aaplIssuer.id}.`,
    },
    {
      code: "input_mismatch",
      message: "revenue_growth_yoy prior basis as_restated does not match current basis as_reported.",
    },
    {
      code: "input_mismatch",
      message: "revenue_growth_yoy prior period_kind ttm does not match current period_kind fiscal_y.",
    },
    {
      code: "input_mismatch",
      message: "revenue_growth_yoy prior fiscal_period Q4 does not match current fiscal_period FY.",
    },
    {
      code: "input_mismatch",
      message: "revenue_growth_yoy prior fiscal_year 2021 must be current fiscal_year - 1 (2023).",
    },
  ]);
});

test("buildKeyStats marks stale price and stale prior inputs unavailable under explicit freshness policy", () => {
  const envelope = buildKeyStats({
    statement: aaplMappedStatement(),
    prior_statement: aaplPriorMappedStatement(),
    price: priceInput({ as_of: "2024-11-01T21:00:00.000Z" }),
    freshness_policy: {
      as_of: "2024-11-04T21:00:00.000Z",
      max_market_price_age_ms: 24 * 60 * 60 * 1000,
      max_prior_statement_age_ms: 24 * 60 * 60 * 1000,
    },
  });
  const pe = statByKey(envelope.stats, "pe_ratio");
  const growth = statByKey(envelope.stats, "revenue_growth_yoy");

  assert.equal(pe.value_num, null);
  assert.equal(pe.coverage_level, "unavailable");
  assert.deepEqual(pe.warnings, [
    {
      code: "stale_input",
      message: "pe_ratio price as_of 2024-11-01T21:00:00.000Z is older than freshness policy by 259200000ms.",
    },
  ]);

  assert.equal(growth.value_num, null);
  assert.equal(growth.coverage_level, "unavailable");
  assert.deepEqual(growth.warnings, [
    {
      code: "stale_input",
      message: "revenue_growth_yoy prior statement as_of 2023-11-03T20:30:00.000Z is older than freshness policy by 31710600000ms.",
    },
  ]);
});

function secIncomeMetricRegistry() {
  const defs: MetricDefinition[] = [
    metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaa10000001", "revenue", "Revenue", "currency", "sum"),
    metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaa10000002", "gross_profit", "Gross Profit", "currency", "sum"),
    metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaa10000003", "operating_income", "Operating Income", "currency", "sum"),
    metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaa10000004", "net_income", "Net Income", "currency", "sum"),
    metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaa10000005", "eps_diluted", "EPS (Diluted)", "currency", "derived"),
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

function aaplCompanyFactsFixture(opts: {
  fiscal_year: number;
  period_start: string;
  period_end: string;
  as_of: string;
  revenue: number;
}): SecCompanyFacts {
  const period = {
    fy: opts.fiscal_year,
    fp: "FY",
    form: "10-K",
    filed: opts.as_of.slice(0, 10),
    start: opts.period_start,
    end: opts.period_end,
  };
  return {
    cik: 320193,
    entityName: "Apple Inc.",
    facts: {
      "us-gaap": {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          label: "Revenue from Contract with Customer, Excluding Assessed Tax",
          description: "Total revenue net of excluded taxes.",
          units: { USD: [value({ val: opts.revenue, ...period })] },
        },
        GrossProfit: {
          label: "Gross Profit",
          description: "Revenue less cost of goods sold.",
          units: { USD: [value({ val: AAPL_FY2024_KNOWN_VALUES.gross_profit, ...period })] },
        },
        OperatingIncomeLoss: {
          label: "Operating Income / (Loss)",
          description: "Operating income for the period.",
          units: { USD: [value({ val: AAPL_FY2024_KNOWN_VALUES.operating_income, ...period })] },
        },
        NetIncomeLoss: {
          label: "Net Income / (Loss)",
          description: "Net income attributable to common shareholders.",
          units: { USD: [value({ val: AAPL_FY2024_KNOWN_VALUES.net_income, ...period })] },
        },
        EarningsPerShareDiluted: {
          label: "Earnings per Share, Diluted",
          description: "Diluted EPS.",
          units: { "USD/shares": [value({ val: AAPL_FY2024_KNOWN_VALUES.eps_diluted, ...period })] },
        },
      },
    },
  };
}

function value(opts: Partial<SecConceptValue> & { val: number; end: string }): SecConceptValue {
  return {
    end: opts.end,
    val: opts.val,
    accn: opts.accn ?? "0000320193-24-000123",
    fy: opts.fy ?? 2024,
    fp: opts.fp ?? "FY",
    form: opts.form ?? "10-K",
    filed: opts.filed ?? "2024-11-01",
    ...(opts.start !== undefined ? { start: opts.start } : {}),
    ...(opts.frame !== undefined ? { frame: opts.frame } : {}),
  };
}
