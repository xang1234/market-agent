// A Call's inputs (ADR 0005) are reported figures the engine plans with: each
// of the fourteen keys SEC ingestion maps (#594), read from real companyfacts,
// certifies with the filing's literal value, period and locator.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { validateFinancialPlan } from "../../financial-core/src/index.ts";
import { parseFinancialJson } from "../../fundamentals/src/lossless-financial-json.ts";
import { createSecBackedStatementRepository } from "../../fundamentals/src/sec-facts-repository.ts";
import { secCompanyFetcher } from "../../fundamentals/test/fakes.ts";
import { inspectCommittedResult } from "../src/inspection.ts";
import { completedRun, databaseUrl, engineDatabase, IDS, pinnedClients, revenuePlan } from "./db-fixtures.ts";

const FIXTURE = parseFinancialJson(
  readFileSync(new URL("../../fundamentals/test/sec-call-inputs.companyfacts.json", import.meta.url), "utf8"),
) as Record<string, unknown>;
const USD = { kind: "currency", currency: "USD" };
const RETRIEVED = "2026-11-09T15:00:00.000Z";

const ISSUERS = {
  AAPL: { issuerId: randomUUID(), cik: 320193 },
  COST: { issuerId: randomUUID(), cik: 909832 },
  CAT: { issuerId: randomUUID(), cik: 18230 },
  // No fixture filer certifies debt_securities_current: NVDA tags it only in
  // 10-Qs, and a 10-Q balance is never certified (#344). NVDA's Q2 FY2027
  // figure, filed here as a 10-K.
  DSEC: { issuerId: randomUUID(), cik: 1045811 },
} as const;
type Ticker = keyof typeof ISSUERS;

const AAPL_10K = "0000320193-26-000026";
const COST_10K = "0000909832-26-000093";
const CAT_10K = "0000018230-26-000008";
const CAT_Q3 = "0000018230-26-000057";
const DSEC_10K = "0001045811-26-000010";

function debtSecuritiesFacts() {
  const filing = { accn: DSEC_10K, fy: 2027, fp: "FY", form: "10-K", filed: "2026-08-27" };
  return {
    cik: ISSUERS.DSEC.cik,
    entityName: "Debt Securities Corp",
    facts: {
      "us-gaap": {
        Revenues: { label: "", description: "", units: { USD: [{ start: "2025-07-28", end: "2026-07-26", val: 100, val_token: "100", ...filing }] } },
        DebtSecuritiesCurrent: { label: "", description: "", units: { USD: [{ end: "2026-07-26", val: 34143000000, val_token: "34143000000", ...filing }] } },
      },
    },
  };
}

type Case = {
  metric: string;
  ticker: Ticker;
  fiscal_year: number;
  fiscal_period: "FY" | "Q3";
  value: string;
  period: { kind: "instant" | "duration"; start: string | null; end: string };
  locator: string;
};

const locator = (cik: number, concept: string, accn: string, start: string | null, end: string) =>
  `sec_edgar:companyfacts:CIK${String(cik).padStart(10, "0")}#${concept}|USD|${accn}|${start ?? ""}..${end}`;
const aaplYear = { kind: "duration" as const, start: "2025-09-28", end: "2026-09-26" };
const aaplEnd = { kind: "instant" as const, start: null, end: "2026-09-26" };
const catYearEnd = { kind: "instant" as const, start: null, end: "2025-12-31" };
const catQ3 = { kind: "duration" as const, start: "2026-07-01", end: "2026-09-30" };

const CASES: ReadonlyArray<Case> = [
  { metric: "pretax_income", ticker: "AAPL", fiscal_year: 2026, fiscal_period: "FY", value: "159237000000", period: aaplYear,
    locator: locator(320193, "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", AAPL_10K, aaplYear.start, aaplYear.end) },
  { metric: "pretax_income_before_equity_method", ticker: "CAT", fiscal_year: 2026, fiscal_period: "Q3", value: "4220000000", period: catQ3,
    locator: locator(18230, "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments", CAT_Q3, catQ3.start, catQ3.end) },
  { metric: "income_tax_expense", ticker: "AAPL", fiscal_year: 2026, fiscal_period: "FY", value: "27062000000", period: aaplYear,
    locator: locator(320193, "IncomeTaxExpenseBenefit", AAPL_10K, aaplYear.start, aaplYear.end) },
  { metric: "stock_based_compensation_expense", ticker: "AAPL", fiscal_year: 2026, fiscal_period: "FY", value: "13789000000", period: aaplYear,
    locator: locator(320193, "AllocatedShareBasedCompensationExpense", AAPL_10K, aaplYear.start, aaplYear.end) },
  { metric: "stock_based_compensation", ticker: "COST", fiscal_year: 2026, fiscal_period: "FY", value: "924000000", period: { kind: "duration", start: "2025-09-01", end: "2026-08-30" },
    locator: locator(909832, "ShareBasedCompensation", COST_10K, "2025-09-01", "2026-08-30") },
  { metric: "long_term_debt_current", ticker: "AAPL", fiscal_year: 2026, fiscal_period: "FY", value: "9906000000", period: aaplEnd,
    locator: locator(320193, "LongTermDebtCurrent", AAPL_10K, null, aaplEnd.end) },
  { metric: "long_term_debt_noncurrent", ticker: "AAPL", fiscal_year: 2026, fiscal_period: "FY", value: "68208000000", period: aaplEnd,
    locator: locator(320193, "LongTermDebtNoncurrent", AAPL_10K, null, aaplEnd.end) },
  { metric: "commercial_paper", ticker: "AAPL", fiscal_year: 2026, fiscal_period: "FY", value: "1997000000", period: aaplEnd,
    locator: locator(320193, "CommercialPaper", AAPL_10K, null, aaplEnd.end) },
  { metric: "short_term_borrowings", ticker: "CAT", fiscal_year: 2025, fiscal_period: "FY", value: "5514000000", period: catYearEnd,
    locator: locator(18230, "ShortTermBorrowings", CAT_10K, null, catYearEnd.end) },
  { metric: "marketable_securities_current", ticker: "AAPL", fiscal_year: 2026, fiscal_period: "FY", value: "20417000000", period: aaplEnd,
    locator: locator(320193, "MarketableSecuritiesCurrent", AAPL_10K, null, aaplEnd.end) },
  { metric: "marketable_securities_noncurrent", ticker: "AAPL", fiscal_year: 2026, fiscal_period: "FY", value: "80213000000", period: aaplEnd,
    locator: locator(320193, "MarketableSecuritiesNoncurrent", AAPL_10K, null, aaplEnd.end) },
  { metric: "debt_securities_current", ticker: "DSEC", fiscal_year: 2027, fiscal_period: "FY", value: "34143000000", period: { kind: "instant", start: null, end: "2026-07-26" },
    locator: locator(1045811, "DebtSecuritiesCurrent", DSEC_10K, null, "2026-07-26") },
  { metric: "short_term_investments", ticker: "COST", fiscal_year: 2026, fiscal_period: "FY", value: "1094000000", period: { kind: "instant", start: null, end: "2026-08-30" },
    locator: locator(909832, "ShortTermInvestments", COST_10K, null, "2026-08-30") },
  { metric: "remaining_performance_obligations", ticker: "CAT", fiscal_year: 2025, fiscal_period: "FY", value: "30100000000", period: catYearEnd,
    locator: locator(18230, "RevenueRemainingPerformanceObligation", CAT_10K, null, catYearEnd.end) },
];
// CAT tags only pretax income before equity-method income: its pretax_income is a gap, never that figure.
const CAT_PRETAX_GAP = { node: "cat_pretax_gap", metric: "pretax_income", ticker: "CAT" as const, fiscal_year: 2026, fiscal_period: "Q3" as const };

function callInputsPlan() {
  const base = revenuePlan({ cutoff: "2026-11-09T23:59:59.999-05:00" });
  const tickers = Object.keys(ISSUERS) as Ticker[];
  const reads = [
    ...CASES.map((c) => ({ node: c.metric, metric: c.metric, ticker: c.ticker, fiscal_year: c.fiscal_year, fiscal_period: c.fiscal_period })),
    CAT_PRETAX_GAP,
  ];
  const validated = validateFinancialPlan({
    ...base,
    subjects: {
      membership: "explicit",
      requested_count: tickers.length,
      resolved_count: tickers.length,
      omitted_count: 0,
      members: tickers.map((ticker, index) => ({ slot_id: ticker.toLowerCase(), subject_ref: { kind: "issuer", id: ISSUERS[ticker].issuerId }, display_order: index, role: index === 0 ? "primary" : "peer" })),
    },
    metric_definitions: [...new Set(reads.map((read) => read.metric))].map((metric) => ({ metric_key: metric, definition_version: `${metric}.v1` })),
    operations: reads.map((read) => ({
      node_id: read.node,
      operation: "reported_metric",
      operation_version: "reported_metric.v1",
      subject_slot: read.ticker.toLowerCase(),
      metric_key: read.metric,
      period: { kind: "fiscal_period", fiscal_year: read.fiscal_year, fiscal_period: read.fiscal_period },
    })),
    outputs: reads.map((read) => ({ output_id: read.node, node_id: read.node, unit_id: "call" })),
    publication_units: [{ unit_id: "call", kind: "chat_section" }],
  });
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

test("every Call input certifies from its filing, and CAT's pretax income is a gap", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for engine coverage");
    return;
  }
  const db = await engineDatabase(t, "fin-call-inputs");
  const pool = await connectedPool(t, databaseUrl(db));
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  for (const [ticker, { issuerId, cik }] of Object.entries(ISSUERS)) {
    await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, $2, $3)`, [issuerId, ticker, String(cik)]);
  }
  // Only an income lookup fetches; the filing's cash flow and balance sheet are stored beside it.
  const filings: Array<[Ticker, number, "FY" | "Q3"]> = [["AAPL", 2026, "FY"], ["COST", 2026, "FY"], ["CAT", 2025, "FY"], ["CAT", 2026, "Q3"], ["DSEC", 2027, "FY"]];
  for (const [ticker, fiscal_year, fiscal_period] of filings) {
    const statements = createSecBackedStatementRepository(pool, {
      fetcher: secCompanyFetcher(() => ticker === "DSEC" ? debtSecuritiesFacts() : FIXTURE[ticker], { completed_at: RETRIEVED }),
      sourceId: randomUUID(),
      logger: { warn: () => {} },
    });
    assert.ok(await statements.find({ issuer_id: ISSUERS[ticker].issuerId, family: "income", basis: "as_reported", fiscal_year, fiscal_period }), `${ticker} ${fiscal_year} ${fiscal_period}`);
  }

  const [client] = await pinnedClients(t, db, 1);
  const { results } = await completedRun(db, client!, callInputsPlan());
  const inspect = async (outputId: string) => (await inspectCommittedResult(db, IDS.owner, results[outputId]!))!;

  for (const c of CASES) {
    const result = await inspect(c.metric);
    assert.ok(result.availability === "available", `${c.metric}: ${JSON.stringify(result)}`);
    assert.deepEqual(
      [result.disposition, result.payload, result.definitions],
      ["verified", { kind: "value", unit: USD, exact: true, value: c.value, rounding: null }, [{ metric_key: c.metric, definition_version: `${c.metric}.v1` }]],
      c.metric,
    );
    const [input] = result.inputs;
    assert.ok(input?.status === "bound" && "fact_id" in input, c.metric);
    assert.deepEqual(
      [input.value, input.period, input.precision_status, input.source.locator],
      [c.value, { ...c.period, fiscal_year: c.fiscal_year, fiscal_period: c.fiscal_period }, "source_token_preserved", c.locator],
      c.metric,
    );
  }

  const gap = await inspect(CAT_PRETAX_GAP.node);
  assert.ok(gap.availability === "available");
  assert.deepEqual([gap.disposition, gap.payload], ["missing", { kind: "gap", explanation: "No eligible input was public before the knowledge cutoff.", reason_code: "missing_input" }]);
});
