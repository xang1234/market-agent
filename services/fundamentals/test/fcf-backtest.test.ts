// The backtest's pure parts: one row from its as-of inputs, the filer's fiscal
// year labels, and the Markdown summary the run's doc is (#610).

import assert from "node:assert/strict";
import test from "node:test";
import { parseFinancialDecimal, rationalFromDecimal, type ExactRational } from "../../financial-core/src/index.ts";
import { backtestRow, labelOffset, renderBacktest, type Absent, type AsOfInputs, type BacktestRow, type CloseSeries, type Figure, type Growth } from "../src/fcf-backtest.ts";

const exact = (text: string): ExactRational => {
  const parsed = parseFinancialDecimal(text);
  assert.ok(parsed.ok);
  return rationalFromDecimal(parsed.value)!;
};

const PRODUCTIVE_ASSETS = { kind: "productive_assets_capex", concept: "PaymentsToAcquireProductiveAssets" } as const;

const CONTINUING_OPERATIONS = { kind: "continuing_operations_ocf", concept: "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations" } as const;

function inputs(asOf: string, periodEnd: string, fcf: string, shares: string, capexScope: AsOfInputs["capex_scope"] = null, ocfScope: AsOfInputs["ocf_scope"] = null): AsOfInputs {
  const figure = (text: string): Figure => ({ kind: "value", value: Number(text), text });
  const values = { free_cash_flow: fcf, net_cash: "200000000", stock_based_compensation: "50000000", shares_outstanding: shares };
  return {
    as_of: asOf,
    figures: { free_cash_flow: figure(fcf), net_cash: figure("200000000"), stock_based_compensation: figure("50000000"), shares_outstanding: figure(shares) },
    exact: Object.fromEntries(Object.entries(values).map(([id, text]) => [id, exact(text)])),
    currency: "USD",
    fiscal_year_end: periodEnd,
    capex_scope: capexScope,
    ocf_scope: ocfScope,
    bound: [
      { slot: "operating_cash_flow", fiscal_year: Number(periodEnd.slice(0, 4)), period_end: periodEnd, public_by: `${asOf}T04:59:59.999Z`, locator: null },
      { slot: "market_cap_shares", fiscal_year: Number(asOf.slice(0, 4)), period_end: asOf, public_by: `${asOf}T04:59:59.999Z`, locator: null },
    ],
  };
}

// Split-adjusted closes as captured on 2026-11-10, after a 2-for-1 split on 2020-06-01.
const closes: CloseSeries = { kind: "closes", basis_date: "2026-11-10", currency: "USD", closes: [{ trade_date: "2018-02-16", close_text: "57.7245" }, { trade_date: "2023-02-16", close_text: "101.73" }] };
const noFiling: Absent = { kind: "outcome", outcome: "no_fy_facts", text: "No SEC facts labeled for that FY on file." };
const noEarlier = { 3: noFiling, 5: noFiling } as const;
const split = { status: "ok", listing_id: "l", timezone: "America/New_York", checked_at: "2026-11-10T00:00:00Z", splits: [{ execution_date: "2020-06-01", split_from: "1", split_to: "2" }] } as const;

test("a split restates the close to its own day and the earlier share count to the later basis", () => {
  const row = backtestRow({
    ticker: "HIST", fiscal_year: 2017, filed: "2018-02-15", label_offset: 0,
    base: inputs("2018-02-16", "2017-12-31", "1100000000", "100000000"),
    later: inputs("2023-02-16", "2022-12-31", "1600000000", "200000000"),
    earlier: noEarlier, closes, splits: split,
  });
  assert.equal(row.kind, "read");
  if (row.kind !== "read") return;
  assert.deepEqual([row.price.text, row.required_growth.text, row.realized.fcf.text, row.share_change.text, row.realized.shares.text, row.period], [
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
    earlier: noEarlier, closes, splits: { ...split, splits: [] },
  });
  assert.deepEqual([unsplit.price.text, unsplit.realized.fcf.text, unsplit.realized.shares.text], [
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
    earlier: noEarlier, closes, splits: { ...split, splits: [] },
  });
  assert.deepEqual([row.realized.fcf.text, row.realized.per_share.text, row.share_change.text, row.realized.shares.text], [
    "7.78%",
    // (20 / 11)^(1/5) - 1: the buyback is not growth the model priced.
    "12.70%",
    "0.87%",
    "-4.36%",
  ]);
});

// Every ratio below is a whole power, so each CAGR is exact: 1.331 = 1.1^3, 1.771561 = 1.21^3, 1.61051 = 1.1^5 and 32 = 2^5.
const powers = { 3: inputs("2015-02-14", "2014-12-31", "1000000000", "214358881"), 5: inputs("2013-02-15", "2012-12-31", "41593750", "80525500") };
const early = { ...split, splits: [{ execution_date: "2014-06-01", split_from: "1", split_to: "2" }] } as const;
const powersRow = (earlier: Parameters<typeof backtestRow>[0]["earlier"]) => backtestRow({
  ticker: "POW", fiscal_year: 2017, filed: "2018-02-15", label_offset: 0,
  base: inputs("2018-02-16", "2017-12-31", "1331000000", "161051000"),
  later: inputs("2023-02-16", "2022-12-31", "2143588810", "100000000"),
  earlier, closes, splits: early,
});
const texts = (growth: Growth) => [growth.fcf.text, growth.per_share.text, growth.shares.text];

test("trailing growth runs from the 10-K 3 and 5 fiscal years earlier, as each was filed, in total and per share", () => {
  const row = powersRow(powers);
  // FY2014: 1,000M to 1,331M is 10% a year; per share 1,000M / 214.358881M to 1,331M / 161.051M is 1.771561, 21%.
  assert.deepEqual(texts(row.trailing[3]), ["10.00%", "21.00%", "-9.09%"]);
  // FY2012: 41.59375M to 1,331M is 32x; its 80.5255M shares are 161.051M after the 2014 split, so per share is 32x too.
  assert.deepEqual(texts(row.trailing[5]), ["100.00%", "100.00%", "0.00%"]);
  // FY2022: 1.61051x in total, and the count fell by 1.61051x, so per share is 1.21^5.
  assert.deepEqual(texts(row.realized), ["10.00%", "21.00%", "-9.09%"]);
});

// CAT FY2016 (2026-11-11 run): one end's free cash flow has no value, so the engine gives it no exact figure.
const noFcf = (read: AsOfInputs): AsOfInputs => {
  const { free_cash_flow: _, ...rest } = read.exact;
  return { ...read, figures: { ...read.figures, free_cash_flow: { kind: "outcome", outcome: "missing_input", text: "operating_cash_flow: none" } }, exact: rest };
};

test("a missing free cash flow at either end of any window is named, and the share change still shows", () => {
  const blocked = (label: string) => ({ kind: "outcome", outcome: "missing_input", input: `${label}free_cash_flow`, text: "operating_cash_flow: none" });
  const own = backtestRow({
    ticker: "POW", fiscal_year: 2017, filed: "2018-02-15", label_offset: 0,
    base: noFcf(inputs("2018-02-16", "2017-12-31", "1331000000", "161051000")),
    later: inputs("2023-02-16", "2022-12-31", "2143588810", "100000000"),
    earlier: powers, closes, splits: early,
  });
  for (const growth of [own.realized, own.trailing[3], own.trailing[5]]) {
    assert.deepEqual([growth.fcf, growth.per_share], [blocked(""), blocked("")]);
  }
  assert.deepEqual([own.realized.shares.text, own.trailing[3].shares.text, own.trailing[5].shares.text], ["-9.09%", "-9.09%", "0.00%"]);
  const others = backtestRow({
    ticker: "POW", fiscal_year: 2017, filed: "2018-02-15", label_offset: 0,
    base: inputs("2018-02-16", "2017-12-31", "1331000000", "161051000"),
    later: noFcf(inputs("2023-02-16", "2022-12-31", "2143588810", "100000000")),
    earlier: { 3: noFcf(powers[3]), 5: noFcf(powers[5]) }, closes, splits: early,
  });
  for (const [growth, label] of [[others.realized, "FY+5 "], [others.trailing[3], "FY-3 "], [others.trailing[5], "FY-5 "]] as const) {
    assert.deepEqual([growth.fcf, growth.per_share], [blocked(label), blocked(label)]);
  }
  assert.deepEqual(texts(others.realized).slice(2), ["-9.09%"]);
  assert.deepEqual([others.trailing[3].shares.text, others.trailing[5].shares.text], ["-9.09%", "0.00%"]);
  assert.match(renderBacktest({ rows: [own, others], issuers: [] }, { ranOn: "2026-11-21", command: "c", notes: "" }), /FY\+5 free_cash_flow: \*\*missing_input\*\*/u);
});

test("a growth ratio far below one keeps its precision before the root", () => {
  // 10 billion to 4,000 over five years: a ratio of 0.0000004, which six decimal places round to zero.
  const row = backtestRow({
    ticker: "POW", fiscal_year: 2017, filed: "2018-02-15", label_offset: 0,
    base: inputs("2018-02-16", "2017-12-31", "10000000000", "100000000"),
    later: inputs("2023-02-16", "2022-12-31", "4000", "100000000"),
    earlier: powers, closes, splits: early,
  });
  assert.equal(row.realized.fcf.text, "-94.75%");
});

test("a zero share count at either end names the share figures and keeps the free cash flow growth", () => {
  const zeroShares = { kind: "outcome", outcome: "non_positive_shares", text: "A share count at one end is zero or negative, so it has no growth rate." };
  for (const [base, later] of [["0", "100000000"], ["161051000", "0"]]) {
    const row = backtestRow({
      ticker: "POW", fiscal_year: 2017, filed: "2018-02-15", label_offset: 0,
      base: inputs("2018-02-16", "2017-12-31", "1331000000", base),
      later: inputs("2023-02-16", "2022-12-31", "2143588810", later),
      earlier: powers, closes, splits: early,
    });
    assert.deepEqual([row.realized.shares, row.realized.per_share], [zeroShares, zeroShares]);
    assert.equal(row.realized.fcf.text, "10.00%");
  }
});

test("an earlier 10-K that is missing, mislabeled or has no positive free cash flow is named as FY-3's or FY-5's", () => {
  const row = powersRow({
    3: inputs("2016-02-14", "2015-12-31", "1000000000", "214358881"),
    5: { ...powers[5], figures: { ...powers[5].figures, free_cash_flow: { kind: "value", value: -1, text: "-1" } }, exact: { ...powers[5].exact, free_cash_flow: exact("-1") } },
  });
  assert.deepEqual(row.trailing[3].fcf, { kind: "outcome", outcome: "period_mismatch", input: "FY-3", text: "The bound base period ends 2015-12-31, which is FY2015, not FY2014." });
  assert.deepEqual([row.trailing[5].fcf.kind === "outcome" && row.trailing[5].fcf.outcome, row.trailing[5].per_share.kind === "outcome" && row.trailing[5].per_share.outcome, row.trailing[5].shares.text],
    ["non_positive_base", "non_positive_base", "0.00%"]);
  const missing = powersRow(noEarlier);
  assert.deepEqual(missing.trailing[3].per_share, { ...noFiling, input: "FY-3" });
  const text = renderBacktest({ rows: [missing], issuers: [] }, { ranOn: "2026-11-21", command: "c", notes: "" });
  assert.match(text, /FY-3: \*\*no_fy_facts\*\* \(No SEC facts labeled for that FY on file\.\); FY-5: \*\*no_fy_facts\*\*/u);
});

// CAT filed capex as productive assets through FY2019 and as PP&E from FY2020.
test("realized growth from free cash flow over productive-assets capex to one over PP&E capex is a named outcome, never a rate (#731)", () => {
  const row = (base: AsOfInputs["capex_scope"], later: AsOfInputs["capex_scope"]) => backtestRow({
    ticker: "SWCH", fiscal_year: 2017, filed: "2018-02-15", label_offset: 0,
    base: inputs("2018-02-16", "2017-12-31", "1100000000", "100000000", base),
    later: inputs("2023-02-16", "2022-12-31", "1600000000", "100000000", later),
    earlier: noEarlier, closes, splits: split,
  });
  const realized = (figure: Figure) => (figure.kind === "outcome" ? figure.outcome : figure.text);
  assert.deepEqual([row(PRODUCTIVE_ASSETS, null), row(null, PRODUCTIVE_ASSETS), row(PRODUCTIVE_ASSETS, PRODUCTIVE_ASSETS), row(null, null)].map((one) => [realized(one.realized.fcf), realized(one.realized.per_share)]),
    [["incompatible_definition", "incompatible_definition"], ["incompatible_definition", "incompatible_definition"], ["7.78%", "23.81%"], ["7.78%", "23.81%"]]);
});

// CAT and COST filed OCF for continuing operations only through FY2018 and the total from FY2019 and FY2020.
test("realized growth across a change of OCF scope is a named outcome, never a rate, in every pairing with capex's (#743)", () => {
  type Scopes = readonly [ocf: AsOfInputs["ocf_scope"], capex: AsOfInputs["capex_scope"]];
  const row = (base: Scopes, later: Scopes) => backtestRow({
    ticker: "SWCH", fiscal_year: 2017, filed: "2018-02-15", label_offset: 0,
    base: inputs("2018-02-16", "2017-12-31", "1100000000", "100000000", base[1], base[0]),
    later: inputs("2023-02-16", "2022-12-31", "1600000000", "100000000", later[1], later[0]),
    earlier: noEarlier, closes, splits: split,
  });
  const realized = (figure: Figure) => (figure.kind === "outcome" ? `${figure.outcome}: ${figure.text}` : figure.text);
  const pairs: Scopes[] = [[null, null], [CONTINUING_OPERATIONS, null], [null, PRODUCTIVE_ASSETS], [CONTINUING_OPERATIONS, PRODUCTIVE_ASSETS]];
  for (const [i, base] of pairs.entries()) {
    for (const [j, later] of pairs.entries()) {
      const { fcf, per_share } = row(base, later).realized;
      if (i === j) assert.deepEqual([realized(fcf), realized(per_share)], ["7.78%", "23.81%"], `${i} to ${j}`);
      else for (const figure of [fcf, per_share]) assert.match(realized(figure), /^incompatible_definition: /u, `${i} to ${j}`);
    }
  }
  assert.match(realized(row(pairs[1]!, pairs[0]!).realized.fcf), /continuing operations at one end and as the total at the other/u);
});

test("a missing later 10-K is named once, as FY+5's, for both realized figures", () => {
  const row = backtestRow({
    ticker: "HIST", fiscal_year: 2017, filed: "2018-02-15", label_offset: 0,
    base: inputs("2018-02-16", "2017-12-31", "1100000000", "100000000"),
    later: { kind: "outcome", outcome: "no_fy_facts", text: "No SEC facts labeled FY2022 on file." },
    earlier: noEarlier, closes, splits: split,
  });
  const text = renderBacktest({ rows: [row], issuers: [] }, { ranOn: "2026-11-11", command: "c", notes: "" });
  // Trailing 3y and 5y, each in total and per share, then realized in total and per share: n/a, each named once.
  assert.match(text, /\| 0\.7% \| n\/a \| n\/a \| n\/a \| n\/a \| n\/a \| n\/a \| 0\.43% \| n\/a \| 12\.00%, at or above \| FY-3: \*\*no_fy_facts\*\* \([^)]*\); FY-5: \*\*no_fy_facts\*\* \([^)]*\); FY\+5: \*\*no_fy_facts\*\* \(No SEC facts labeled FY2022 on file\.\) \|$/mu);
  assert.match(text, /^ {2}- 1 realized growth, FY\+5 no_fy_facts$/mu);
});

test("an as-of day with no trading takes the next close, never the filing day's", () => {
  // 2018-02-15 is a Thursday filing, so the as-of day is Friday 2018-02-16; filed Friday, it is Saturday 2018-02-17.
  const series = (dates: Array<[string, string]>): CloseSeries => ({ ...closes, closes: dates.map(([trade_date, close_text]) => ({ trade_date, close_text })) });
  const row = (asOf: string, captured: CloseSeries) => backtestRow({
    ticker: "HIST", fiscal_year: 2017, filed: "2018-02-16", label_offset: 0,
    base: inputs(asOf, "2017-12-31", "1100000000", "100000000"),
    later: inputs("2023-02-21", "2022-12-31", "1600000000", "200000000"),
    earlier: noEarlier, closes: captured, splits: split,
  });
  const weekend = row("2018-02-17", series([["2018-02-16", "57.7245"], ["2018-02-19", "60"], ["2023-02-17", "90"], ["2023-02-21", "100"]]));
  assert.deepEqual([weekend.price.text, weekend.required_growth.kind, weekend.price_return.text], [
    "120 (2018-02-19, dev close, never certified)",
    "value",
    // From Monday's 60 to the first close on or after Sunday 2023-02-19: (100 / 60)^(1/5) - 1.
    "10.76%, at or above",
  ]);
  // Presidents' Day: Saturday's as-of day prices at Wednesday's close if Tuesday's is missing, four days on.
  const holiday = row("2018-02-17", series([["2018-02-16", "57.7245"], ["2018-02-21", "60"]]));
  assert.equal(holiday.price.text, "120 (2018-02-21, dev close, never certified)");
  // A Thursday as-of day with no close for a week is a capture gap, not a long weekend.
  const gap = row("2018-02-15", series([["2018-02-14", "57.7245"], ["2018-02-22", "60"]]));
  assert.deepEqual([gap.price.kind === "outcome" && gap.price.outcome, gap.price.text], ["stale_price", "The first captured close on or after 2018-02-15 is 2018-02-22."]);
  const after = row("2018-02-17", series([["2018-02-16", "57.7245"]]));
  assert.deepEqual([after.price.kind === "outcome" && after.price.outcome, after.price.text], ["price_missing", "No captured close on or after 2018-02-17; captures end 2018-02-16."]);
});

test("a row whose statements are another fiscal year's is a period_mismatch", () => {
  const row = (fiscalYear: number, periodEnd: string, offset: number, laterEnd = "2026-12-31") => backtestRow({
    ticker: "HON", fiscal_year: fiscalYear, filed: "2022-02-11", label_offset: offset,
    base: inputs("2022-02-12", periodEnd, "1100000000", "100000000"),
    later: inputs("2027-02-12", laterEnd, "1600000000", "100000000"),
    earlier: noEarlier, closes, splits: split,
  });
  // HON tagged its FY2021 10-K as fiscal 2020.
  const hon = row(2020, "2021-12-31", 0, "2025-12-31");
  assert.deepEqual(hon.kind === "read" && [hon.period?.outcome, hon.period?.text], ["period_mismatch", "The bound base period ends 2021-12-31, which is FY2021, not FY2020."]);
  // A 53-week year ending in the new year's first days, and a retailer that labels its year by the year it starts in.
  assert.deepEqual([row(2016, "2017-01-01", 0, "2022-01-02"), row(2016, "2017-01-29", -1, "2022-01-30")].map((r) => r.kind === "read" && r.period), [null, null]);
  // The later 10-K's statements are checked too: FY2021's realized growth must end at FY2026, not FY2025.
  const late = row(2021, "2021-12-31", 0, "2025-12-31");
  assert.deepEqual(late.kind === "read" && [late.period, late.realized.fcf.kind === "outcome" && late.realized.fcf.outcome], [null, "period_mismatch"]);
});

test("a filer's fiscal year label is the year its period ends in, a week early, plus the offset most of its years show", () => {
  const filings = (pairs: Array<[number, string]>) => pairs.map(([fiscal_year, period_end]) => ({ fiscal_year, period_end, filed: null }));
  assert.equal(labelOffset(filings([[2019, "2019-12-31"], [2020, "2021-12-31"], [2022, "2022-12-31"], [2023, "2023-12-31"]])), 0);
  assert.equal(labelOffset(filings([[2016, "2017-01-29"], [2017, "2018-01-28"], [2018, "2019-02-03"]])), -1);
  assert.equal(labelOffset(filings([[2016, "2017-01-01"], [2017, "2017-12-31"], [2020, "2021-01-03"]])), 0);
});

const percent = (value: number): Figure => ({ kind: "value", value, text: `${(value * 100).toFixed(2)}%` });
const unpriced: Figure = { kind: "outcome", outcome: "price_missing", text: "5 years on: none" };
const read = (fy: number, required: number | Figure, realized: number, priceReturn: number | Figure, period: Absent | null = null, trailing: Partial<Record<3 | 5, number>> = {}): BacktestRow => {
  const base = inputs("2020-02-01", `${fy}-12-31`, "1", "1");
  const trailed = (value: number | undefined): Growth => value === undefined
    ? { fcf: noFiling, per_share: noFiling, shares: noFiling }
    : { fcf: percent(value), per_share: percent(value + 0.01), shares: percent(-0.01) };
  return {
    kind: "read", ticker: "T", fiscal_year: fy, filed: "2020-01-31", inputs: base, period,
    price: { kind: "value", value: 10, text: "10" }, todays_multiple: { kind: "value", value: 20, text: "20.00x" },
    required_growth: typeof required === "number" ? percent(required) : required,
    share_change: percent(0.01),
    realized: { fcf: percent(realized), per_share: percent(realized + 0.02), shares: percent(-0.02) },
    trailing: { 3: trailed(trailing[3]), 5: trailed(trailing[5]) },
    price_return: typeof priceReturn === "number" ? percent(priceReturn) : priceReturn,
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
    ...GAP_LEAD,
    "  - **3-year gap.** 0 rows from 0 issuers, and 0 more with no 5-year price return. At or above 0, 0 rows from 0 issuers, 0 at or above 10% a year, median n/a. Below 0, 0 rows from 0 issuers, 0 at or above 10% a year, median n/a.",
    "    - Lowest third: 0 rows.",
    "    - Middle third: 0 rows.",
    "    - Highest third: 0 rows.",
    "  - **5-year gap.** 0 rows from 0 issuers, and 0 more with no 5-year price return. At or above 0, 0 rows from 0 issuers, 0 at or above 10% a year, median n/a. Below 0, 0 rows from 0 issuers, 0 at or above 10% a year, median n/a.",
    "    - Lowest third: 0 rows.",
    "    - Middle third: 0 rows.",
    "    - Highest third: 0 rows.",
    // FY2016 to FY2019 have both realized figures; FY2020 is a period_mismatch.
    "- **Buybacks.** 4 rows have realized growth in total and per share and a d. Median a year: total 7.00%, per share 9.00%, realized share change -2.00%, d 1.00%.",
  ].join("\n"));
  assert.match(text, /^## Caveats\n\n- Small N\.$/mu);
  assert.match(text, /^\| T \| 2020 \| 2020-01-31 \| 2020-02-01 \|.* \| \*\*period_mismatch\*\* \(FY2021\); trailing_3y: \*\*no_fy_facts\*\*.* \|$/mu);
  assert.match(text, /^\| T \| 2021 \| n\/a \| n\/a \|.* \| \*\*no_filing_date\*\* \(No FY2021 filing date\.\) \|$/mu);
  assert.ok(text.startsWith("# FCF required-growth backtest, 2026-11-11\n\nGenerated by `npm run backtest:fcf -- --tickers T`."));
});

test("five years after a 29 February close is 28 February, so a late end close is still stale", () => {
  const leap: CloseSeries = { ...closes, closes: [{ trade_date: "2016-02-29", close_text: "50" }, { trade_date: "2021-03-15", close_text: "100" }] };
  const row = backtestRow({
    ticker: "HIST", fiscal_year: 2015, filed: "2016-02-26", label_offset: 0,
    base: inputs("2016-02-27", "2015-12-31", "1100000000", "100000000"),
    later: inputs("2021-02-27", "2020-12-31", "1600000000", "200000000"),
    earlier: noEarlier, closes: leap, splits: { ...split, splits: [] },
  });
  assert.deepEqual([row.price_return.kind === "outcome" && row.price_return.outcome, row.price_return.text], [
    "stale_price",
    "5 years on: The first captured close on or after 2021-02-28 is 2021-03-15.",
  ]);
});

const GAP_LEAD = ["- **Trailing against required, ex ante.** The gap is trailing growth of total free cash flow minus required growth, both known at the as-of date. The trailing CAGR runs from the 10-K 3 or 5 fiscal years earlier to the row's own, each as first filed. Each split counts rows with a gap and a 5-year price return, sorted by the gap; a period_mismatch row is left out."];

test("the gap, trailing minus required, splits the 5-year price return by sign and by third, with N for each", () => {
  const rows: BacktestRow[] = [
    // Required 5% each; 3-year gaps -4, -2, -1, 0, +1, +3 and +6 points.
    // FY2016 and FY2017 are another issuer's, so a bucket counts its issuers apart from its rows.
    { ...read(2016, 0.05, 0.05, 0.02, null, { 3: 0.01, 5: 0.0 }), ticker: "A" },
    { ...read(2017, 0.05, 0.05, 0.05, null, { 3: 0.03, 5: 0.07 }), ticker: "A" },
    read(2018, 0.05, 0.05, 0.08, null, { 3: 0.04 }),
    read(2019, 0.05, 0.05, 0.1, null, { 3: 0.05 }),
    read(2020, 0.05, 0.05, 0.12, null, { 3: 0.06 }),
    read(2021, 0.05, 0.05, 0.15, null, { 3: 0.08 }),
    read(2015, 0.05, 0.05, 0.2, null, { 3: 0.11 }),
    // A gap with no 5-year price, one mislabeled, and one with no required growth: none is in a split.
    read(2014, 0.05, 0.05, unpriced, null, { 3: 0.2 }),
    read(2013, 0.05, 0.05, 0.5, { kind: "outcome", outcome: "period_mismatch", text: "FY2014" }, { 3: 0.2 }),
    read(2012, { kind: "outcome", outcome: "missing_input", input: "net_cash", text: "none" }, 0.05, 0.5, null, { 3: 0.2 }),
  ];
  const text = renderBacktest({ rows, issuers: [] }, { ranOn: "2026-11-21", command: "c", notes: "" });
  const lines = text.split("\n");
  const from = lines.indexOf(GAP_LEAD[0]!);
  assert.deepEqual(lines.slice(from + 1, from + 9), [
    "  - **3-year gap.** 7 rows from 2 issuers, and 1 more with no 5-year price return. At or above 0, 4 rows from 1 issuer, 4 at or above 10% a year, median 13.50%. Below 0, 3 rows from 2 issuers, 0 at or above 10% a year, median 5.00%.",
    // Seven rows split 3, 2 and 2, lowest gap first.
    "    - Lowest third, gap -4.00 to -1.00 points: 3 rows from 2 issuers, 0 at or above 10% a year, median 5.00%.",
    "    - Middle third, gap 0.00 to 1.00 points: 2 rows from 1 issuer, 2 at or above 10% a year, median 11.00%.",
    "    - Highest third, gap 3.00 to 6.00 points: 2 rows from 1 issuer, 2 at or above 10% a year, median 17.50%.",
    "  - **5-year gap.** 2 rows from 1 issuer, and 0 more with no 5-year price return. At or above 0, 1 row from 1 issuer, 0 at or above 10% a year, median 5.00%. Below 0, 1 row from 1 issuer, 0 at or above 10% a year, median 2.00%.",
    "    - Lowest third, gap -5.00 to -5.00 points: 1 row from 1 issuer, 0 at or above 10% a year, median 2.00%.",
    "    - Middle third, gap 2.00 to 2.00 points: 1 row from 1 issuer, 0 at or above 10% a year, median 5.00%.",
    "    - Highest third: 0 rows.",
  ]);
});

test("every buybacks median is over the same rows, so a row with no d leaves all four", () => {
  // PG FY2020 (2026-11-11 run): both realized measures, and no d.
  const noD = { ...read(2020, 0.01, 0.3, 0.1), share_change: { kind: "outcome", outcome: "numeric_limit_exceeded", text: "share change" } } as BacktestRow;
  const text = renderBacktest({ rows: [read(2019, 0.01, 0.05, 0.1), noD], issuers: [] }, { ranOn: "2026-11-21", command: "c", notes: "" });
  assert.match(text, /^- \*\*Buybacks\.\*\* 1 row has realized growth in total and per share and a d; 1 more has no d\. Median a year: total 5\.00%, per share 7\.00%, realized share change -2\.00%, d 1\.00%\.$/mu);
});
