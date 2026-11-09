import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  extractStatementWithTokens,
  fetchCompanyFacts,
  SEC_METRIC_KEYS_BY_FAMILY,
  US_GAAP_TO_METRIC_KEY,
  type SecCompanyFacts,
} from "../src/sec-edgar.ts";
import { parseFinancialJson } from "../src/lossless-financial-json.ts";
import type { FiscalPeriod, StatementFamily } from "../src/statement.ts";
import { aaplIssuer } from "./fixtures.ts";
import { secFetched } from "./fakes.ts";

// Real data.sec.gov companyfacts, downloaded 2026-11-09 and trimmed to the
// concepts a Call reads, for the fiscal years these tests use.
const FIXTURE = parseFinancialJson(readFileSync(new URL("./sec-call-inputs.companyfacts.json", import.meta.url), "utf8")) as Record<string, unknown>;
const CIK = { AAPL: 320193, NVDA: 1045810, COST: 909832, CAT: 18230, ADBE: 796343 } as const;
type Ticker = keyof typeof CIK;

async function companyFacts(ticker: Ticker): Promise<SecCompanyFacts> {
  return (await fetchCompanyFacts(async () => secFetched(FIXTURE[ticker]), CIK[ticker])).facts;
}

async function extract(ticker: Ticker, family: StatementFamily, fiscal_year: number, fiscal_period: FiscalPeriod, accession_number: string, facts?: SecCompanyFacts) {
  return extractStatementWithTokens({
    subject: aaplIssuer,
    facts: facts ?? await companyFacts(ticker),
    family,
    fiscal_year,
    fiscal_period,
    accession_number,
    source_id: "00000000-0000-4000-a000-0000000000ec",
    as_of: "2026-11-09T00:00:00.000Z",
  });
}

const CALL_INPUT_KEYS = [
  "pretax_income",
  "income_tax_expense",
  "stock_based_compensation_expense",
  "stock_based_compensation",
  "long_term_debt_current",
  "long_term_debt_noncurrent",
  "commercial_paper",
  "short_term_borrowings",
  "marketable_securities_current",
  "marketable_securities_noncurrent",
  "debt_securities_current",
  "short_term_investments",
  "remaining_performance_obligations",
];

// Each figure as the filing reports it: [value, concept]. A cash flow quarter
// is its year to date less the previous filing's: [value, concept, earlier accession].
type Expected = Record<string, [number, string] | [number, string, string]>;
const CASES: ReadonlyArray<{ ticker: Ticker; family: StatementFamily; fy: number; fp: FiscalPeriod; accn: string; start: string | null; end: string; lines: Expected }> = [
  { ticker: "AAPL", family: "balance", fy: 2026, fp: "FY", accn: "0000320193-26-000026", start: null, end: "2026-09-26", lines: {
    long_term_debt_noncurrent: [68_208_000_000, "LongTermDebtNoncurrent"],
    long_term_debt_current: [9_906_000_000, "LongTermDebtCurrent"],
    commercial_paper: [1_997_000_000, "CommercialPaper"],
    marketable_securities_current: [20_417_000_000, "MarketableSecuritiesCurrent"],
    marketable_securities_noncurrent: [80_213_000_000, "MarketableSecuritiesNoncurrent"],
  } },
  { ticker: "AAPL", family: "income", fy: 2026, fp: "FY", accn: "0000320193-26-000026", start: "2025-09-28", end: "2026-09-26", lines: {
    pretax_income: [159_237_000_000, "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"],
    income_tax_expense: [27_062_000_000, "IncomeTaxExpenseBenefit"],
    stock_based_compensation_expense: [13_789_000_000, "AllocatedShareBasedCompensationExpense"],
  } },
  { ticker: "AAPL", family: "cashflow", fy: 2026, fp: "FY", accn: "0000320193-26-000026", start: "2025-09-28", end: "2026-09-26", lines: {
    stock_based_compensation: [13_789_000_000, "ShareBasedCompensation"],
  } },
  { ticker: "NVDA", family: "balance", fy: 2027, fp: "Q2", accn: "0001045810-26-000075", start: null, end: "2026-07-26", lines: {
    long_term_debt_noncurrent: [32_366_000_000, "LongTermDebtNoncurrent"],
    long_term_debt_current: [1_000_000_000, "LongTermDebtCurrent"],
    debt_securities_current: [34_143_000_000, "DebtSecuritiesCurrent"],
    remaining_performance_obligations: [3_200_000_000, "RevenueRemainingPerformanceObligation"],
  } },
  { ticker: "NVDA", family: "income", fy: 2027, fp: "Q2", accn: "0001045810-26-000075", start: "2026-04-27", end: "2026-07-26", lines: {
    pretax_income: [71_507_000_000, "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"],
    income_tax_expense: [11_819_000_000, "IncomeTaxExpenseBenefit"],
    stock_based_compensation_expense: [2_027_000_000, "AllocatedShareBasedCompensationExpense"],
  } },
  { ticker: "NVDA", family: "cashflow", fy: 2027, fp: "Q2", accn: "0001045810-26-000075", start: "2026-04-27", end: "2026-07-26", lines: {
    // 3,954M for six months less 1,928M for the first quarter.
    stock_based_compensation: [2_026_000_000, "ShareBasedCompensation", "0001045810-26-000052"],
  } },
  { ticker: "COST", family: "balance", fy: 2026, fp: "FY", accn: "0000909832-26-000093", start: null, end: "2026-08-30", lines: {
    short_term_investments: [1_094_000_000, "ShortTermInvestments"],
    long_term_debt_current: [2_248_000_000, "LongTermDebtCurrent"],
    long_term_debt_noncurrent: [3_914_000_000, "LongTermDebtNoncurrent"],
  } },
  { ticker: "COST", family: "income", fy: 2026, fp: "FY", accn: "0000909832-26-000093", start: "2025-09-01", end: "2026-08-30", lines: {
    pretax_income: [12_251_000_000, "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"],
    income_tax_expense: [3_025_000_000, "IncomeTaxExpenseBenefit"],
  } },
  { ticker: "COST", family: "cashflow", fy: 2026, fp: "FY", accn: "0000909832-26-000093", start: "2025-09-01", end: "2026-08-30", lines: {
    stock_based_compensation: [924_000_000, "ShareBasedCompensation"],
  } },
  { ticker: "CAT", family: "balance", fy: 2025, fp: "FY", accn: "0000018230-26-000008", start: null, end: "2025-12-31", lines: {
    short_term_borrowings: [5_514_000_000, "ShortTermBorrowings"],
    long_term_debt_noncurrent: [30_696_000_000, "LongTermDebtNoncurrent"],
  } },
  { ticker: "CAT", family: "balance", fy: 2026, fp: "Q3", accn: "0000018230-26-000057", start: null, end: "2026-09-30", lines: {
    remaining_performance_obligations: [49_400_000_000, "RevenueRemainingPerformanceObligation"],
  } },
  { ticker: "CAT", family: "income", fy: 2026, fp: "Q3", accn: "0000018230-26-000057", start: "2026-07-01", end: "2026-09-30", lines: {
    // CAT reports its affiliates' profit after tax, so it tags the legacy concept.
    pretax_income: [4_220_000_000, "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"],
    income_tax_expense: [968_000_000, "IncomeTaxExpenseBenefit"],
    stock_based_compensation_expense: [81_000_000, "AllocatedShareBasedCompensationExpense"],
  } },
  { ticker: "ADBE", family: "balance", fy: 2026, fp: "Q3", accn: "0000796343-26-000156", start: null, end: "2026-08-28", lines: {
    short_term_investments: [1_280_000_000, "ShortTermInvestments"],
    remaining_performance_obligations: [22_160_000_000, "RevenueRemainingPerformanceObligation"],
  } },
  { ticker: "ADBE", family: "income", fy: 2026, fp: "Q3", accn: "0000796343-26-000156", start: "2026-05-30", end: "2026-08-28", lines: {
    pretax_income: [2_357_000_000, "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"],
    income_tax_expense: [530_000_000, "IncomeTaxExpenseBenefit"],
    stock_based_compensation_expense: [539_000_000, "AllocatedShareBasedCompensationExpense"],
  } },
  { ticker: "ADBE", family: "cashflow", fy: 2026, fp: "Q3", accn: "0000796343-26-000156", start: "2026-05-30", end: "2026-08-28", lines: {
    // 1,582M for nine months less 1,043M for six.
    stock_based_compensation: [539_000_000, "ShareBasedCompensation", "0000796343-26-000112"],
  } },
];

for (const c of CASES) {
  test(`${c.ticker} ${c.fy} ${c.fp} ${c.family}: a Call's inputs are the filing's reported figures`, async () => {
    const { statement, tokens, derivations } = await extract(c.ticker, c.family, c.fy, c.fp, c.accn);
    assert.equal(statement.period_start, c.start);
    assert.equal(statement.period_end, c.end);
    for (const [key, [value, concept, earlier]] of Object.entries(c.lines)) {
      assert.equal(statement.lines.find((line) => line.metric_key === key)?.value_num, value, key);
      if (earlier === undefined) {
        assert.deepEqual([tokens.get(key)?.concept, tokens.get(key)?.accn, tokens.get(key)?.token], [concept, c.accn, String(value)], key);
      } else {
        const derivation = derivations.get(key);
        assert.deepEqual(
          [derivation?.concept, derivation?.minuend.accn, derivation?.subtrahends.map((term) => term.accn)],
          [concept, c.accn, [earlier]],
          key,
        );
      }
    }
  });
}

test("pretax income takes the modern concept when a filing tags both, never their sum", async () => {
  // ADBE's FY2020 10-K tags both pretax concepts at 4,176M.
  const accn = "0000796343-21-000004";
  const facts = await companyFacts("ADBE");
  const both = await extract("ADBE", "income", 2020, "FY", accn, facts);
  assert.equal(both.statement.lines.find((line) => line.metric_key === "pretax_income")?.value_num, 4_176_000_000);
  assert.equal(both.tokens.get("pretax_income")?.concept, "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest");

  const legacy = facts.facts["us-gaap"]!.IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments!;
  legacy.units.USD = legacy.units.USD!.map((value) => ({ ...value, val: 1, val_token: "1" }));
  const differing = await extract("ADBE", "income", 2020, "FY", accn, facts);
  assert.equal(differing.statement.lines.find((line) => line.metric_key === "pretax_income")?.value_num, 4_176_000_000);
});

test("a Call input is one tagged figure: debt and securities parts are never summed into another key", async () => {
  // AAPL's 10-K tags every debt and securities part; each lands under its own key.
  const { statement, tokens } = await extract("AAPL", "balance", 2026, "FY", "0000320193-26-000026");
  for (const line of statement.lines.filter((candidate) => CALL_INPUT_KEYS.includes(candidate.metric_key))) {
    const token = tokens.get(line.metric_key);
    assert.equal(US_GAAP_TO_METRIC_KEY[token!.concept], line.metric_key);
    assert.equal(String(line.value_num), token!.token);
  }
  const keys = new Set(Object.values(US_GAAP_TO_METRIC_KEY));
  for (const definition of ["total_debt", "net_debt", "cash_and_securities"]) assert.equal(keys.has(definition), false, definition);
});

test("figures that are not the same economic figure keep their own keys", () => {
  assert.equal(US_GAAP_TO_METRIC_KEY.ShareBasedCompensation, "stock_based_compensation");
  // The expense differs from the cash flow add-back (ADBE FY2021 Q1: 281M against 260M).
  assert.equal(US_GAAP_TO_METRIC_KEY.AllocatedShareBasedCompensationExpense, "stock_based_compensation_expense");
  assert.equal(US_GAAP_TO_METRIC_KEY.MarketableSecuritiesCurrent, "marketable_securities_current");
  assert.equal(US_GAAP_TO_METRIC_KEY.DebtSecuritiesCurrent, "debt_securities_current");
  assert.equal(US_GAAP_TO_METRIC_KEY.ShortTermInvestments, "short_term_investments");
  assert.equal(US_GAAP_TO_METRIC_KEY.AvailableForSaleSecuritiesDebtSecuritiesCurrent, undefined);
  assert.equal(US_GAAP_TO_METRIC_KEY.AvailableForSaleSecuritiesDebtSecuritiesNoncurrent, undefined);
});

test("every metric SEC ingestion stores is seeded in the metrics registry", () => {
  const seed = readFileSync(new URL("../../../db/seed/metrics.sql", import.meta.url), "utf8");
  const seeded = new Set([...seed.matchAll(/^\s*\('([a-z0-9_.]+)'/gm)].map((match) => match[1]));
  for (const key of Object.values(SEC_METRIC_KEYS_BY_FAMILY).flat()) assert.ok(seeded.has(key), `${key} is not in db/seed/metrics.sql`);
});
