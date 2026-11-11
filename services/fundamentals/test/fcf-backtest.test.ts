// The backtest's pure parts: one row from its as-of inputs, the filer's fiscal
// year labels, and the Markdown summary the run's doc is (#610).

import assert from "node:assert/strict";
import test from "node:test";
import { parseFinancialDecimal, rationalFromDecimal, type ExactRational } from "../../financial-core/src/index.ts";
import { backtestRow, labelOffset, renderBacktest, type Absent, type AsOfInputs, type BacktestRow, type CloseSeries, type Figure } from "../src/fcf-backtest.ts";

const exact = (text: string): ExactRational => {
  const parsed = parseFinancialDecimal(text);
  assert.ok(parsed.ok);
  return rationalFromDecimal(parsed.value)!;
};

function inputs(asOf: string, periodEnd: string, fcf: string, shares: string): AsOfInputs {
  const figure = (text: string): Figure => ({ kind: "value", value: Number(text), text });
  const values = { free_cash_flow: fcf, net_cash: "200000000", stock_based_compensation: "50000000", shares_outstanding: shares };
  return {
    as_of: asOf,
    figures: { free_cash_flow: figure(fcf), net_cash: figure("200000000"), stock_based_compensation: figure("50000000"), shares_outstanding: figure(shares) },
    exact: Object.fromEntries(Object.entries(values).map(([id, text]) => [id, exact(text)])),
    currency: "USD",
    fiscal_year_end: periodEnd,
    bound: [
      { slot: "operating_cash_flow", fiscal_year: Number(periodEnd.slice(0, 4)), period_end: periodEnd, public_by: `${asOf}T04:59:59.999Z`, locator: null },
      { slot: "market_cap_shares", fiscal_year: Number(asOf.slice(0, 4)), period_end: asOf, public_by: `${asOf}T04:59:59.999Z`, locator: null },
    ],
  };
}

// Split-adjusted closes as captured on 2026-11-10, after a 2-for-1 split on 2020-06-01.
const closes: CloseSeries = { kind: "closes", captured_on: "2026-11-10", currency: "USD", closes: [{ trade_date: "2018-02-16", close_text: "57.7245" }, { trade_date: "2023-02-16", close_text: "101.73" }] };
const split = { status: "ok", listing_id: "l", timezone: "America/New_York", checked_at: "2026-11-10T00:00:00Z", splits: [{ execution_date: "2020-06-01", split_from: "1", split_to: "2" }] } as const;

test("a split restates the close to its own day and the earlier share count to the later basis", () => {
  const row = backtestRow({
    ticker: "HIST", fiscal_year: 2017, filed: "2018-02-15", label_offset: 0,
    base: inputs("2018-02-16", "2017-12-31", "1100000000", "100000000"),
    later: inputs("2023-02-16", "2022-12-31", "1600000000", "200000000"),
    closes, splits: split,
  });
  assert.equal(row.kind, "read");
  if (row.kind !== "read") return;
  assert.deepEqual([row.price.text, row.required_growth.text, row.realized_fcf_cagr.text, row.share_change.text, row.realized_share_change.text, row.period], [
    "115.449 (2018-02-16, dev close, never certified)",
    "0.7%",
    // (1,600M / 1,100M)^(1/5) - 1.
    "7.78%",
    // 50M SBC over 115.449 x 100M.
    "0.43%",
    // 100M shares are 200M after the split, and FY2022 has 200M.
    "0.00%",
    null,
  ]);
  const unsplit = backtestRow({
    ticker: "HIST", fiscal_year: 2017, filed: "2018-02-15", label_offset: 0,
    base: inputs("2018-02-16", "2017-12-31", "1100000000", "100000000"),
    later: inputs("2023-02-16", "2022-12-31", "1600000000", "200000000"),
    closes, splits: { ...split, splits: [] },
  });
  assert.deepEqual([unsplit.price.text, unsplit.realized_fcf_cagr.text, unsplit.realized_share_change.text], [
    "57.7245 (2018-02-16, dev close, never certified)",
    "7.78%",
    "14.87%",
  ]);
});

test("realized growth is total free cash flow, as required growth is, and buybacks show as the realized share change beside d", () => {
  const row = backtestRow({
    ticker: "BUYB", fiscal_year: 2017, filed: "2018-02-15", label_offset: 0,
    base: inputs("2018-02-16", "2017-12-31", "1100000000", "100000000"),
    later: inputs("2023-02-16", "2022-12-31", "1600000000", "80000000"),
    closes, splits: { ...split, splits: [] },
  });
  assert.deepEqual([row.realized_fcf_cagr.text, row.share_change.text, row.realized_share_change.text], [
    // Per share it would be (20 / 11)^(1/5) - 1 = 12.70%: the buyback is not growth the model priced.
    "7.78%",
    "0.87%",
    "-4.36%",
  ]);
});

test("a missing later 10-K is named once, as FY+5's, for both realized figures", () => {
  const row = backtestRow({
    ticker: "HIST", fiscal_year: 2017, filed: "2018-02-15", label_offset: 0,
    base: inputs("2018-02-16", "2017-12-31", "1100000000", "100000000"),
    later: { kind: "outcome", outcome: "no_fy_facts", text: "No SEC facts labeled FY2022 on file." },
    closes, splits: split,
  });
  const text = renderBacktest({ rows: [row], issuers: [] }, { ranOn: "2026-11-11", command: "c", notes: "" });
  assert.match(text, /\| 0\.7% \| n\/a \| 0\.43% \| n\/a \| 12\.00%, at or above \| FY\+5: \*\*no_fy_facts\*\* \(No SEC facts labeled FY2022 on file\.\) \|$/mu);
  assert.match(text, /^ {2}- 1 realized growth, FY\+5 no_fy_facts$/mu);
});

test("an as-of day with no trading takes the next close, never the filing day's", () => {
  // 2018-02-15 is a Thursday filing, so the as-of day is Friday 2018-02-16; filed Friday, it is Saturday 2018-02-17.
  const series = (dates: Array<[string, string]>): CloseSeries => ({ ...closes, closes: dates.map(([trade_date, close_text]) => ({ trade_date, close_text })) });
  const row = (asOf: string, captured: CloseSeries) => backtestRow({
    ticker: "HIST", fiscal_year: 2017, filed: "2018-02-16", label_offset: 0,
    base: inputs(asOf, "2017-12-31", "1100000000", "100000000"),
    later: inputs("2023-02-21", "2022-12-31", "1600000000", "200000000"),
    closes: captured, splits: split,
  });
  const weekend = row("2018-02-17", series([["2018-02-16", "57.7245"], ["2018-02-19", "60"], ["2023-02-17", "90"], ["2023-02-21", "100"]]));
  assert.deepEqual([weekend.price.text, weekend.required_growth.kind, weekend.price_return.text], [
    "120 (2018-02-19, dev close, never certified)",
    "value",
    // From Monday's 60 to the first close on or after Sunday 2023-02-19: (100 / 60)^(1/5) - 1.
    "10.76%, at or above",
  ]);
  const late = row("2018-02-17", series([["2018-02-16", "57.7245"], ["2018-02-26", "60"]]));
  assert.deepEqual([late.price.kind === "outcome" && late.price.outcome, late.price.text], ["stale_price", "The first captured close on or after 2018-02-17 is 2018-02-26."]);
  const after = row("2018-02-17", series([["2018-02-16", "57.7245"]]));
  assert.deepEqual([after.price.kind === "outcome" && after.price.outcome, after.price.text], ["price_missing", "No captured close on or after 2018-02-17; captures end 2018-02-16."]);
});

test("a row whose statements are another fiscal year's is a period_mismatch", () => {
  const row = (fiscalYear: number, periodEnd: string, offset: number, laterEnd = "2026-12-31") => backtestRow({
    ticker: "HON", fiscal_year: fiscalYear, filed: "2022-02-11", label_offset: offset,
    base: inputs("2022-02-12", periodEnd, "1100000000", "100000000"),
    later: inputs("2027-02-12", laterEnd, "1600000000", "100000000"),
    closes, splits: split,
  });
  // HON tagged its FY2021 10-K as fiscal 2020.
  const hon = row(2020, "2021-12-31", 0, "2025-12-31");
  assert.deepEqual(hon.kind === "read" && [hon.period?.outcome, hon.period?.text], ["period_mismatch", "The bound base period ends 2021-12-31, which is FY2021, not FY2020."]);
  // A 53-week year ending in the new year's first days, and a retailer that labels its year by the year it starts in.
  assert.deepEqual([row(2016, "2017-01-01", 0, "2022-01-02"), row(2016, "2017-01-29", -1, "2022-01-30")].map((r) => r.kind === "read" && r.period), [null, null]);
  // The later 10-K's statements are checked too: FY2021's realized growth must end at FY2026, not FY2025.
  const late = row(2021, "2021-12-31", 0, "2025-12-31");
  assert.deepEqual(late.kind === "read" && [late.period, late.realized_fcf_cagr.kind === "outcome" && late.realized_fcf_cagr.outcome], [null, "period_mismatch"]);
});

test("a filer's fiscal year label is the year its period ends in, a week early, plus the offset most of its years show", () => {
  const filings = (pairs: Array<[number, string]>) => pairs.map(([fiscal_year, period_end]) => ({ fiscal_year, period_end, filed: null }));
  assert.equal(labelOffset(filings([[2019, "2019-12-31"], [2020, "2021-12-31"], [2022, "2022-12-31"], [2023, "2023-12-31"]])), 0);
  assert.equal(labelOffset(filings([[2016, "2017-01-29"], [2017, "2018-01-28"], [2018, "2019-02-03"]])), -1);
  assert.equal(labelOffset(filings([[2016, "2017-01-01"], [2017, "2017-12-31"], [2020, "2021-01-03"]])), 0);
});

const read = (fy: number, required: number | Figure, realized: number, priceReturn: number, period: Absent | null = null): BacktestRow => {
  const percent = (value: number): Figure => ({ kind: "value", value, text: `${(value * 100).toFixed(2)}%` });
  const base = inputs("2020-02-01", `${fy}-12-31`, "1", "1");
  return {
    kind: "read", ticker: "T", fiscal_year: fy, filed: "2020-01-31", inputs: base, period,
    price: { kind: "value", value: 10, text: "10" }, todays_multiple: { kind: "value", value: 20, text: "20.00x" },
    required_growth: typeof required === "number" ? percent(required) : required,
    share_change: percent(0.01), realized_fcf_cagr: percent(realized), realized_share_change: percent(-0.02), price_return: percent(priceReturn),
  };
};

test("the summary counts a tie with the required growth and with the hurdle as at or above", () => {
  const run = {
    rows: [
      read(2016, 0.05, 0.05, 0.1),
      read(2017, 0.06, 0.04, 0.0999),
      read(2018, 0.07, 0.09, 0.12),
      read(2019, { kind: "outcome", outcome: "missing_input", input: "net_cash", text: "net_cash: none" }, 0.1, 0.2),
      read(2020, 0.01, 0.5, 0.5, { kind: "outcome", outcome: "period_mismatch", text: "FY2021" }),
      { kind: "unread", ticker: "T", fiscal_year: 2021, outcome: { kind: "outcome", outcome: "no_filing_date", text: "No FY2021 filing date." } },
    ] satisfies BacktestRow[],
    issuers: [],
  };
  const text = renderBacktest(run, { ranOn: "2026-11-11", command: "npm run backtest:fcf -- --tickers T", notes: "## Caveats\n\n- Small N." });
  const section = (name: string) => text.split(`## ${name}\n\n`)[1]!.split("\n\n")[0];
  assert.equal(section("Summary"), [
    "- **Rows.** 6 issuer-years.",
    "- **Outcomes.** Each row's first outcome that keeps it from both growth figures.",
    "  - 3 both",
    "  - 1 no_filing_date",
    "  - 1 period_mismatch",
    "  - 1 required growth, net_cash missing_input",
    "- **Realized against required.** 3 rows have both. In 2, realized growth was at or above the required growth, compared unrounded. 1 of the 3 (T FY2016) differs by less than 0.005 points, the required-growth solver's precision, so its side is not settled. The median gap, realized minus required, is 0.00 points.",
    "- **Against the hurdle.** Of the 2 at or above required growth, 2 have a 5-year price return, 2 at or above 10% a year, median 11.00%. Of the 1 below, 1 has a 5-year price return, 0 at or above 10% a year, median 9.99%.",
  ].join("\n"));
  assert.match(text, /^## Caveats\n\n- Small N\.$/mu);
  assert.match(text, /^\| T \| 2020 \| 2020-01-31 \| 2020-02-01 \|.* \| \*\*period_mismatch\*\* \(FY2021\) \|$/mu);
  assert.match(text, /^\| T \| 2021 \| n\/a \| n\/a \|.* \| \*\*no_filing_date\*\* \(No FY2021 filing date\.\) \|$/mu);
  assert.ok(text.startsWith("# FCF required-growth backtest, 2026-11-11\n\nGenerated by `npm run backtest:fcf -- --tickers T`."));
});
