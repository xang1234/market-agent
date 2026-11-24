import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { extractNonGaapReconciliations, readTables } from "../src/reader/non-gaap-reconciliation-extractor.ts";
import { EX99_RELEASE_HTML } from "./fixtures/sec-8k-release.ts";

const SAMPLE_SOURCE_UUID = "11111111-1111-4111-a111-111111111111";

const RECONCILIATION_TABLE = `
<html>
  <body>
    <table>
      <tr><th>Reconciliation of GAAP to non-GAAP results</th><th>Fiscal 2024</th></tr>
      <tr><td>GAAP operating income</td><td>$114,301</td></tr>
      <tr><td>Stock-based compensation expense</td><td>12,400</td></tr>
      <tr><td>Acquisition-related charges</td><td>800</td></tr>
      <tr><td>Non-GAAP operating income</td><td>$127,501</td></tr>
    </table>
  </body>
</html>`;

test("extractNonGaapReconciliations links a non-GAAP value to its explicit GAAP counterpart", () => {
  const result = extractNonGaapReconciliations({
    html: RECONCILIATION_TABLE,
    source_id: SAMPLE_SOURCE_UUID,
    as_of: "2026-05-06T00:00:00.000Z",
  });

  assert.equal(result.items.length, 1);
  const item = result.items[0]!;
  assert.equal(item.item_type, "non_gaap_reconciliation");
  assert.equal(item.measure_key, "operating_income");
  assert.equal(item.non_gaap.label, "Non-GAAP operating income");
  assert.equal(item.non_gaap.value_num, 127_501);
  assert.equal(item.gaap.label, "GAAP operating income");
  assert.equal(item.gaap.value_num, 114_301);
  assert.deepEqual(
    item.adjustments.map((adjustment) => [adjustment.label, adjustment.value_num]),
    [
      ["Stock-based compensation expense", 12_400],
      ["Acquisition-related charges", 800],
    ],
  );
  assert.equal(item.unit, "currency");
  assert.equal(item.currency, "USD");
  assert.equal(item.period_label, "Fiscal 2024");
  assert.equal(item.source_id, SAMPLE_SOURCE_UUID);
});

test("extractNonGaapReconciliations ignores tables without explicit GAAP and non-GAAP rows", () => {
  const result = extractNonGaapReconciliations({
    html: "<table><tr><td>Revenue</td><td>$10</td></tr></table>",
    source_id: SAMPLE_SOURCE_UUID,
    as_of: "2026-05-06T00:00:00.000Z",
  });

  assert.deepEqual(result.items, []);
});

test("extractNonGaapReconciliations extracts each numeric period column", () => {
  const result = extractNonGaapReconciliations({
    html: `
      <table>
        <tr><th>GAAP to non-GAAP reconciliation</th><th>2024</th><th>2023</th></tr>
        <tr><td>GAAP net income</td><td>$93,736</td><td>$96,995</td></tr>
        <tr><td>Legal settlement expense</td><td>500</td><td>300</td></tr>
        <tr><td>Non-GAAP net income</td><td>$94,236</td><td>$97,295</td></tr>
      </table>`,
    source_id: SAMPLE_SOURCE_UUID,
    as_of: "2026-05-06T00:00:00.000Z",
  });

  assert.equal(result.items.length, 2);
  assert.deepEqual(
    result.items.map((item) => ({
      period_label: item.period_label,
      gaap: item.gaap.value_num,
      non_gaap: item.non_gaap.value_num,
      adjustment: item.adjustments[0]?.value_num,
    })),
    [
      { period_label: "2024", gaap: 93_736, non_gaap: 94_236, adjustment: 500 },
      { period_label: "2023", gaap: 96_995, non_gaap: 97_295, adjustment: 300 },
    ],
  );
});

test("extractNonGaapReconciliations preserves empty table cells so period columns do not shift", () => {
  const result = extractNonGaapReconciliations({
    html: `
      <table>
        <tr><th></th><th>2024</th><th>2023</th></tr>
        <tr><td>GAAP net income</td><td>$93,736</td><td>$96,995</td></tr>
        <tr><td>Legal settlement expense</td><td>500</td><td></td></tr>
        <tr><td>Non-GAAP net income</td><td>$94,236</td><td>$96,995</td></tr>
      </table>`,
    source_id: SAMPLE_SOURCE_UUID,
    as_of: "2026-05-06T00:00:00.000Z",
  });

  assert.equal(result.items.length, 2);
  assert.deepEqual(
    result.items.map((item) => ({
      period_label: item.period_label,
      adjustments: item.adjustments.map((adjustment) => adjustment.value_num),
    })),
    [
      { period_label: "2024", adjustments: [500] },
      { period_label: "2023", adjustments: [] },
    ],
  );
});

test("extractNonGaapReconciliations recognizes non GAAP spelling variants", () => {
  const result = extractNonGaapReconciliations({
    html: `
      <table>
        <tr><th>GAAP to non GAAP reconciliation</th><th>2024</th></tr>
        <tr><td>GAAP operating income</td><td>$114,301</td></tr>
        <tr><td>Stock-based compensation expense</td><td>12,400</td></tr>
        <tr><td>Non GAAP operating income</td><td>$126,701</td></tr>
      </table>`,
    source_id: SAMPLE_SOURCE_UUID,
    as_of: "2026-05-06T00:00:00.000Z",
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]!.non_gaap.label, "Non GAAP operating income");
});

test("extractNonGaapReconciliations reads an EDGAR-built table: spanned headers, split cells and section headers", () => {
  const result = extractNonGaapReconciliations({ html: EX99_RELEASE_HTML, source_id: SAMPLE_SOURCE_UUID, as_of: "2026-05-06T00:00:00.000Z" });
  const quarter = "Three Months Ended October 26, 2025";
  const reported = result.items.filter((item) => item.period_label === quarter);
  assert.deepEqual(
    reported.map((item) => ({
      measure: item.measure_key,
      gaap: item.gaap.value_num,
      non_gaap: item.non_gaap.value_num,
      adjustments: item.adjustments.map((adjustment) => [adjustment.label, adjustment.value_num]),
      scale: item.scale,
    })),
    [
      // A margin row is no anchor, and a negative split as "(2" and ")" keeps its sign.
      { measure: "gross_profit", gaap: 41_849, non_gaap: 42_147, scale: "millions", adjustments: [
        ["Acquisition-related and other costs (A)", 122], ["Stock-based compensation expense (B)", 178], ["Other (C)", -2],
      ] },
      { measure: "operating_expenses", gaap: 5_839, non_gaap: 4_325, scale: "millions", adjustments: [
        ["Stock-based compensation expense (B)", -1_474], ["Acquisition-related and other costs (A)", -40],
      ] },
      // A total with no lines above it is the add-back the release states.
      { measure: "operating_income", gaap: 36_010, non_gaap: 37_822, scale: "millions", adjustments: [["Total impact of non-GAAP adjustments to operating income", 1_812]] },
      { measure: "net_income", gaap: 31_910, non_gaap: 33_366, scale: "millions", adjustments: [
        ["Total pre-tax impact of non-GAAP adjustments", 1_812], ["Income tax impact of non-GAAP adjustments (D)", -356],
      ] },
      // "GAAP" alone takes its measure from the section header above it.
      { measure: "eps_diluted", gaap: 1.3, non_gaap: 1.36, scale: "millions", adjustments: [] },
    ],
  );
  assert.deepEqual(
    [...new Set(result.items.map((item) => item.period_label))],
    [quarter, "Three Months Ended July 27, 2025", "Three Months Ended October 27, 2024", "Nine Months Ended October 26, 2025", "Nine Months Ended October 27, 2024"],
  );
  assert.equal(result.items.length, 25);
});

test("extractNonGaapReconciliations keys per-share rows as EPS, never as net income", () => {
  const result = extractNonGaapReconciliations({
    html: `
      <table>
        <tr><th>GAAP to non-GAAP reconciliation</th><th>Q3 2025</th></tr>
        <tr><td>GAAP net income</td><td>$100</td></tr>
        <tr><td>Stock-based compensation</td><td>10</td></tr>
        <tr><td>Non-GAAP net income</td><td>$110</td></tr>
        <tr><td>GAAP net income per diluted share</td><td>$1.00</td></tr>
        <tr><td>Stock-based compensation</td><td>0.10</td></tr>
        <tr><td>Non-GAAP net income per diluted share</td><td>$1.10</td></tr>
      </table>`,
    source_id: SAMPLE_SOURCE_UUID,
    as_of: "2026-05-06T00:00:00.000Z",
  });
  assert.deepEqual(result.items.map((item) => [item.measure_key, item.gaap.value_num, item.non_gaap.value_num]), [
    ["net_income", 100, 110],
    ["eps_diluted", 1, 1.1],
  ]);
});

const lines = (html: string) => extractNonGaapReconciliations({ html, source_id: SAMPLE_SOURCE_UUID, as_of: "2026-05-06T00:00:00.000Z" }).items
  .map((item) => [item.measure_key, item.period_label, item.gaap.value_num, item.non_gaap.value_num, item.adjustments.map((line) => [line.label, line.value_num])]);

test("extractNonGaapReconciliations reads MCD's real 10-K reconciliations: self-closing cells, a $ cell before the figure, split % cells", () => {
  const html = readFileSync(new URL("./fixtures/sec-10k/mcd.htm", import.meta.url), "utf8");
  // Each add-back stays in its own year, and no percent change is a reconciled figure.
  assert.deepEqual(lines(html), [
    ["net_income", "Amount 2025", 8_563, 8_741, [["(Gains)/Charges, net of tax", 178]]],
    ["net_income", "Amount 2024", 8_223, 8_459, [["(Gains)/Charges, net of tax", 236]]],
    ["eps_diluted", "Amount 2025", 11.95, 12.2, [["(Gains)/Charges", 0.25]]],
    ["eps_diluted", "Amount 2024", 11.39, 11.72, [["(Gains)/Charges", 0.33]]],
    ["operating_income", "Amount 2025", 12_393, 12_621, [["(Gains)/charges", 229]]],
    ["operating_income", "Amount 2024", 11_712, 12_003, [["(Gains)/charges", 291]]],
  ]);
});

test("extractNonGaapReconciliations reads a period whose month and day sit above its year, and labels indented by blank cells", () => {
  const html = `<table>
    <tr><td colspan="4"></td><td colspan="3">Three Months Ended</td><td></td><td colspan="3">Three Months Ended</td></tr>
    <tr><td colspan="4"></td><td colspan="3">October 26,</td><td></td><td colspan="3">October 27,</td></tr>
    <tr><td colspan="4"></td><td colspan="3">2025</td><td></td><td colspan="3">2024</td></tr>
    <tr><td colspan="4">GAAP operating expenses</td><td>$</td><td>5,839</td><td></td><td></td><td>$</td><td>4,287</td><td></td></tr>
    <tr><td colspan="3"></td><td>Stock-based compensation expense (B)</td><td></td><td>(1,474</td><td>)</td><td></td><td></td><td>(1,100</td><td>)</td></tr>
    <tr><td colspan="4">Non-GAAP operating expenses</td><td>$</td><td>4,365</td><td></td><td></td><td>$</td><td>3,187</td><td></td></tr>
    <tr><td colspan="4">Diluted net income per share (A)</td></tr>
    <tr><td colspan="3"></td><td>GAAP</td><td>$</td><td>1.30</td><td></td><td></td><td>$</td><td>0.78</td><td></td></tr>
    <tr><td colspan="3"></td><td>Non-GAAP**</td><td>$</td><td>1.36</td><td></td><td></td><td>$</td><td>0.81</td><td></td></tr>
  </table>`;
  assert.deepEqual(lines(html), [
    ["operating_expenses", "Three Months Ended October 26, 2025", 5_839, 4_365, [["Stock-based compensation expense (B)", -1_474]]],
    ["operating_expenses", "Three Months Ended October 27, 2024", 4_287, 3_187, [["Stock-based compensation expense (B)", -1_100]]],
    ["eps_diluted", "Three Months Ended October 26, 2025", 1.3, 1.36, []],
    ["eps_diluted", "Three Months Ended October 27, 2024", 0.78, 0.81, []],
  ]);
});

test("extractNonGaapReconciliations places a header row below a cell spanning two rows", () => {
  const html = `<table>
    <tr><th rowspan="2">Reconciliation of GAAP to non-GAAP</th><th colspan="2">Three Months Ended</th></tr>
    <tr><th>September 27, 2025</th><th>September 28, 2024</th></tr>
    <tr><td>GAAP operating income</td><td>$1,270</td><td>$724</td></tr>
    <tr><td>Stock-based compensation</td><td>419</td><td>353</td></tr>
    <tr><td>Non-GAAP operating income</td><td>$1,689</td><td>$1,077</td></tr>
  </table>`;
  assert.deepEqual(lines(html), [
    ["operating_income", "Three Months Ended September 27, 2025", 1_270, 1_689, [["Stock-based compensation", 419]]],
    ["operating_income", "Three Months Ended September 28, 2024", 724, 1_077, [["Stock-based compensation", 353]]],
  ]);
});

test("extractNonGaapReconciliations closes on a non-GAAP total, and never on a row about the adjustments", () => {
  const html = `<table>
    <tr><th>GAAP to non-GAAP reconciliation</th><th>Q3 2025</th></tr>
    <tr><td>GAAP operating income</td><td>$100</td></tr>
    <tr><td>Stock-based compensation</td><td>10</td></tr>
    <tr><td>Total non-GAAP operating income</td><td>$110</td></tr>
    <tr><td>Total GAAP operating expenses</td><td>$50</td></tr>
    <tr><td>Stock-based compensation</td><td>(8)</td></tr>
    <tr><td>Total non-GAAP operating expenses</td><td>$42</td></tr>
  </table>
  <table>
    <tr><th>Reconciliation of GAAP to non-GAAP</th><th>Q3 2025</th></tr>
    <tr><td>GAAP operating income</td><td>$36,010</td></tr>
    <tr><td>Impact of non-GAAP adjustments to operating income</td><td>1,812</td></tr>
    <tr><td>Non-GAAP operating income</td><td>$37,822</td></tr>
  </table>`;
  assert.deepEqual(lines(html), [
    ["operating_income", "Q3 2025", 100, 110, [["Stock-based compensation", 10]]],
    ["operating_expenses", "Q3 2025", 50, 42, [["Stock-based compensation", -8]]],
    ["operating_income", "Q3 2025", 36_010, 37_822, [["Impact of non-GAAP adjustments to operating income", 1_812]]],
  ]);
});

test("extractNonGaapReconciliations keys basic EPS apart from diluted, the qualifier in parentheses", () => {
  const html = `<table>
    <tr><th>GAAP to non-GAAP reconciliation</th><th>Q3 2025</th></tr>
    <tr><td>GAAP net income per share (basic)</td><td>$1.02</td></tr>
    <tr><td>Non-GAAP net income per share (basic)</td><td>$1.12</td></tr>
    <tr><td>GAAP net income per share (diluted)</td><td>$1.00</td></tr>
    <tr><td>Non-GAAP net income per share (diluted)</td><td>$1.10</td></tr>
  </table>
  <table>
    <tr><th>GAAP to non-GAAP reconciliation</th><th>Q3 2025</th></tr>
    <tr><td>GAAP net income/(loss) per share</td><td>$0.98</td></tr>
    <tr><td>Non-GAAP net income/(loss) per share</td><td>$1.08</td></tr>
  </table>`;
  assert.deepEqual(lines(html).map(([measure, , gaap, nonGaap]) => [measure, gaap, nonGaap]), [
    ["eps_basic", 1.02, 1.12],
    ["eps_diluted", 1, 1.1],
    // "/(loss)" names one measure, never two.
    ["eps_diluted", 0.98, 1.08],
  ]);
});

test("extractNonGaapReconciliations reads a row of net income and EPS as one measure per figure of its period, else not at all", () => {
  const html = `<table>
    <tr><td></td><td colspan="11">Three Months Ended</td></tr>
    <tr><td></td><td colspan="5">September 27, 2025</td><td></td><td colspan="5">September 28, 2024</td></tr>
    <tr><td>GAAP net income / earnings per share</td><td>$</td><td>1,243</td><td></td><td>$</td><td>0.75</td><td></td><td>$</td><td>771</td><td></td><td>$</td><td>0.47</td></tr>
    <tr><td>Stock-based compensation</td><td colspan="2">419</td><td></td><td colspan="2">0.26</td><td></td><td colspan="2">353</td><td></td><td colspan="2">0.22</td></tr>
    <tr><td>Amortization of acquisition-related intangibles</td><td colspan="2">303</td><td></td><td colspan="2">0.19</td><td></td><td colspan="2">—</td><td></td><td colspan="2">—</td></tr>
    <tr><td>Non-GAAP net income / earnings per share</td><td>$</td><td>1,965</td><td></td><td>$</td><td>1.20</td><td></td><td>$</td><td>1,124</td><td></td><td>$</td><td>0.69</td></tr>
  </table>
  <table>
    <tr><th>Reconciliation of GAAP to non-GAAP</th><th colspan="2">September 27, 2025</th></tr>
    <tr><th></th><th>Net income</th><th>Per share</th></tr>
    <tr><td>GAAP net income / earnings per share</td><td>$1,243</td><td>$0.75</td></tr>
    <tr><td>Non-GAAP net income / earnings per share</td><td>$1,965</td><td>$1.20</td></tr>
  </table>`;
  const sep2025 = "Three Months Ended September 27, 2025";
  const sep2024 = "Three Months Ended September 28, 2024";
  assert.deepEqual(lines(html), [
    ["net_income", sep2025, 1_243, 1_965, [["Stock-based compensation", 419], ["Amortization of acquisition-related intangibles", 303]]],
    ["eps_diluted", sep2025, 0.75, 1.2, [["Stock-based compensation", 0.26], ["Amortization of acquisition-related intangibles", 0.19]]],
    ["net_income", sep2024, 771, 1_124, [["Stock-based compensation", 353]]],
    ["eps_diluted", sep2024, 0.47, 0.69, [["Stock-based compensation", 0.22]]],
  ]);
});

test("extractNonGaapReconciliations reads a figure with its % in the next cell as a percent, no add-back", () => {
  const html = `<table>
    <tr><th>GAAP to non-GAAP reconciliation</th><th colspan="3">Q3 2025</th></tr>
    <tr><td>GAAP net income</td><td>$</td><td>100</td><td></td></tr>
    <tr><td>Effective tax rate</td><td></td><td>21.5</td><td>%</td></tr>
    <tr><td>Stock-based compensation</td><td></td><td>10</td><td></td></tr>
    <tr><td>Non-GAAP net income</td><td>$</td><td>110</td><td></td></tr>
  </table>`;
  assert.deepEqual(lines(html), [["net_income", "Q3 2025", 100, 110, [["Stock-based compensation", 10]]]]);
});

test("extractNonGaapReconciliations heads a figure with the header over its empty $ column, in a table that prints no $", () => {
  const html = `<table>
    <tr><td>Reconciliation of GAAP to non-GAAP (In thousands)</td><td></td><td colspan="3">Three Months Ended October 26, 2025</td></tr>
    <tr><td>GAAP operating income</td><td></td><td></td><td>100</td><td></td></tr>
    <tr><td>Stock-based compensation</td><td></td><td></td><td>10</td><td></td></tr>
    <tr><td>Non-GAAP operating income</td><td></td><td></td><td>110</td><td></td></tr>
  </table>`;
  assert.deepEqual(lines(html), [["operating_income", "Three Months Ended October 26, 2025", 100, 110, [["Stock-based compensation", 10]]]]);
});

test("extractNonGaapReconciliations keeps a gross margin reconciled in dollars as gross profit, and skips one in percent", () => {
  const html = `<table>
    <tr><th>GAAP to non-GAAP reconciliation</th><th>Q3 2025</th></tr>
    <tr><td>GAAP gross margin</td><td>$100</td></tr>
    <tr><td>Stock-based compensation</td><td>10</td></tr>
    <tr><td>Non-GAAP gross margin</td><td>$110</td></tr>
    <tr><td>GAAP gross margin</td><td>73.4%</td></tr>
    <tr><td>Stock-based compensation</td><td>0.3</td></tr>
    <tr><td>Non-GAAP gross margin</td><td>73.7%</td></tr>
  </table>`;
  assert.deepEqual(lines(html), [["gross_profit", "Q3 2025", 100, 110, [["Stock-based compensation", 10]]]]);
});

test("extractNonGaapReconciliations keeps a total with no lines above it as the add-back, and skips one that sums lines above", () => {
  const html = `<table>
    <tr><th>GAAP to non-GAAP reconciliation</th><th>Q3 2025</th></tr>
    <tr><td>GAAP net income</td><td>$100</td></tr>
    <tr><td>Total stock-based compensation</td><td>10</td></tr>
    <tr><td>Non-GAAP net income</td><td>$110</td></tr>
    <tr><td>GAAP operating income</td><td>$120</td></tr>
    <tr><td>Stock-based compensation: cost of revenue</td><td>4</td></tr>
    <tr><td>Stock-based compensation: research and development</td><td>6</td></tr>
    <tr><td>Total stock-based compensation</td><td>10</td></tr>
    <tr><td>Non-GAAP operating income</td><td>$130</td></tr>
  </table>`;
  assert.deepEqual(lines(html), [
    ["net_income", "Q3 2025", 100, 110, [["Total stock-based compensation", 10]]],
    ["operating_income", "Q3 2025", 120, 130, [["Stock-based compensation: cost of revenue", 4], ["Stock-based compensation: research and development", 6]]],
  ]);
});

test("extractNonGaapReconciliations keeps an open reconciliation past a row of dashes and a subheading", () => {
  const html = `<table>
    <tr><th>GAAP to non-GAAP reconciliation</th><th>Q3 2025</th><th>Q3 2024</th></tr>
    <tr><td>Diluted net income per share</td><td></td><td></td></tr>
    <tr><td>GAAP</td><td>$1.30</td><td>$0.78</td></tr>
    <tr><td>Non-GAAP adjustments:</td><td></td><td></td></tr>
    <tr><td>Stock-based compensation</td><td>0.06</td><td>0.03</td></tr>
    <tr><td>Restructuring charges</td><td>—</td><td>&#8212;</td></tr>
    <tr><td>Non-GAAP</td><td>$1.36</td><td>$0.81</td></tr>
  </table>`;
  assert.deepEqual(lines(html), [
    ["eps_diluted", "Q3 2025", 1.3, 1.36, [["Stock-based compensation", 0.06]]],
    ["eps_diluted", "Q3 2024", 0.78, 0.81, [["Stock-based compensation", 0.03]]],
  ]);
});

test("extractNonGaapReconciliations never puts two figures of one row in one slot, past a year cell spanning both columns", () => {
  const html = `<table>
    <tr><td></td><td colspan="2">Three Months Ended</td></tr>
    <tr><td></td><td>September 27, 2025</td><td>September 28, 2024</td></tr>
    <tr><td>GAAP operating income</td><td>$1,270</td><td>$724</td></tr>
    <tr><td></td><td colspan="2">2025</td></tr>
    <tr><td>Stock-based compensation</td><td>419</td><td>353</td></tr>
    <tr><td>Non-GAAP operating income</td><td>$1,689</td><td>$1,077</td></tr>
  </table>`;
  assert.deepEqual(lines(html), [
    ["operating_income", "Three Months Ended September 27, 2025", 1_270, 1_689, [["Stock-based compensation", 419]]],
    ["operating_income", "Three Months Ended September 28, 2024", 724, 1_077, [["Stock-based compensation", 353]]],
  ]);
});

test("extractNonGaapReconciliations reads a negative percent split across cells as a percent, and a Unicode minus as a sign", () => {
  const html = `<table>
    <tr><th>GAAP to non-GAAP reconciliation</th><th colspan="3">Q3 2025</th></tr>
    <tr><td>GAAP net income</td><td>$</td><td>100</td><td></td></tr>
    <tr><td>Change in effective tax rate</td><td></td><td>(2.5</td><td>)</td><td>%</td></tr>
    <tr><td>Change in operating margin</td><td></td><td>(1.5</td><td>)%</td></tr>
    <tr><td>Gain on investments</td><td></td><td>&minus;5</td><td></td></tr>
    <tr><td>Stock-based compensation</td><td></td><td>10</td><td></td></tr>
    <tr><td>Non-GAAP net income</td><td>$</td><td>105</td><td></td></tr>
  </table>`;
  assert.deepEqual(lines(html), [["net_income", "Q3 2025", 100, 105, [["Gain on investments", -5], ["Stock-based compensation", 10]]]]);
});

test("a footnote row inside the table is a note, not a column of figures", () => {
  const table = (footnote: string) => `<table>
    <tr><td></td><td>Three Months Ended June 30, 2025</td></tr>
    <tr><td>GAAP net income</td><td>100</td></tr>
    <tr><td>Stock-based compensation</td><td>10</td></tr>
    <tr><td>Non-GAAP net income</td><td>110</td></tr>
    ${footnote}
  </table>`;
  const read = (html: string) => extractNonGaapReconciliations({ html, source_id: SAMPLE_SOURCE_UUID, as_of: "2026-05-06T00:00:00.000Z" }).items
    .map((item) => [item.measure_key, item.gaap.value_num, item.non_gaap.value_num, item.adjustments.map((line) => line.value_num)]);
  const expected = [["net_income", 100, 110, [10]]];
  assert.deepEqual(read(table("")), expected);
  assert.deepEqual(read(table("<tr><td>(1)</td><td>Excludes stock-based compensation.</td></tr>")), expected);
  assert.deepEqual(read(table("<tr><td>1</td><td>Excludes stock-based compensation.</td></tr>")), expected);
});

test("a bare year under a column a header already dates is an amount, and heads its column only when nothing above names a year", () => {
  const html = `<table>
    <tr><th>GAAP to non-GAAP reconciliation</th><th>Q3 2025</th></tr>
    <tr><td>GAAP net income</td><td>2000</td></tr>
    <tr><td>Stock-based compensation</td><td>10</td></tr>
    <tr><td>Non-GAAP net income</td><td>2,010</td></tr>
  </table>
  <table>
    <tr><td></td><td colspan="2">Years Ended December 31,</td></tr>
    <tr><td>(In millions)</td><td>2025</td><td>2024</td></tr>
    <tr><td>GAAP net income</td><td>2000</td><td>1,900</td></tr>
    <tr><td>Stock-based compensation</td><td>10</td><td>9</td></tr>
    <tr><td>Non-GAAP net income</td><td>2,010</td><td>1,909</td></tr>
  </table>`;
  assert.deepEqual(lines(html), [
    ["net_income", "Q3 2025", 2_000, 2_010, [["Stock-based compensation", 10]]],
    ["net_income", "Years Ended December 31, 2025", 2_000, 2_010, [["Stock-based compensation", 10]]],
    ["net_income", "Years Ended December 31, 2024", 1_900, 1_909, [["Stock-based compensation", 9]]],
  ]);
});

test("a total is a subtotal only when it sums a run of the lines just above it, so a sole total after another line is a line", () => {
  const html = `<table>
    <tr><th>GAAP to non-GAAP reconciliation</th><th>Q3 2025</th></tr>
    <tr><td>GAAP net income</td><td>$31,910</td></tr>
    <tr><td>Income tax impact of non-GAAP adjustments</td><td>(532)</td></tr>
    <tr><td>Total pre-tax impact of non-GAAP adjustments</td><td>389</td></tr>
    <tr><td>Non-GAAP net income</td><td>$31,767</td></tr>
    <tr><td>GAAP operating income</td><td>$120</td></tr>
    <tr><td>Stock-based compensation: cost of revenue</td><td>4</td></tr>
    <tr><td>Total cost of revenue adjustments</td><td>4</td></tr>
    <tr><td>Stock-based compensation: research and development</td><td>6</td></tr>
    <tr><td>Total operating expense adjustments</td><td>6</td></tr>
    <tr><td>Total adjustments</td><td>10</td></tr>
    <tr><td>Non-GAAP operating income</td><td>$130</td></tr>
    <tr><td>GAAP diluted EPS</td><td>$0.75</td></tr>
    <tr><td>Stock-based compensation</td><td>0.26</td></tr>
    <tr><td>Amortization of intangibles</td><td>0.34</td></tr>
    <tr><td>Income tax provision</td><td>(0.09)</td></tr>
    <tr><td>Total adjustments</td><td>0.52</td></tr>
    <tr><td>Non-GAAP diluted EPS</td><td>$1.27</td></tr>
  </table>`;
  assert.deepEqual(lines(html), [
    ["net_income", "Q3 2025", 31_910, 31_767, [["Income tax impact of non-GAAP adjustments", -532], ["Total pre-tax impact of non-GAAP adjustments", 389]]],
    ["operating_income", "Q3 2025", 120, 130, [["Stock-based compensation: cost of revenue", 4], ["Stock-based compensation: research and development", 6]]],
    // 0.26 + 0.34 - 0.09 is 0.51, a cent off the printed 0.52 by rounding.
    ["eps_diluted", "Q3 2025", 0.75, 1.27, [["Stock-based compensation", 0.26], ["Amortization of intangibles", 0.34], ["Income tax provision", -0.09]]],
  ]);
});

test("&mdash; and &ndash; read as dashes: a row of them states no figure, and a label keeps its dash", () => {
  const html = `<table>
    <tr><th>GAAP to non-GAAP reconciliation</th><th>Q3 2025</th><th>Q3 2024</th></tr>
    <tr><td>GAAP operating income</td><td>$100</td><td>$90</td></tr>
    <tr><td>Stock-based compensation &ndash; cost of revenue</td><td>10</td><td>8</td></tr>
    <tr><td>Restructuring charges</td><td>&mdash;</td><td>&ndash;</td></tr>
    <tr><td>Non-GAAP operating income</td><td>$110</td><td>$98</td></tr>
  </table>`;
  assert.deepEqual(readTables(html)[0]!.rows.map((row) => row.label), [
    "GAAP to non-GAAP reconciliation", "GAAP operating income", "Stock-based compensation – cost of revenue", "Non-GAAP operating income",
  ]);
  assert.deepEqual(lines(html)[0], ["operating_income", "Q3 2025", 100, 110, [["Stock-based compensation – cost of revenue", 10]]]);
});

test("a table's scale ignores an exception's parenthetical, and reads a bare \"(Millions)\" as AMD prints it", () => {
  const table = `<table><tr><td></td><td>Q3 2025</td></tr><tr><td>Revenue</td><td>$100</td></tr></table>`;
  assert.equal(readTables(`<p>Amounts in millions, except shares (in thousands)</p>${table}`)[0]!.scale, "millions");
  assert.equal(readTables(`<p>(Millions) (Unaudited)</p>${table}`)[0]!.scale, "millions");
  assert.equal(readTables(`<p>(Millions except per share amounts and percentages) (Unaudited)</p>${table}`)[0]!.scale, "millions");
  assert.equal(readTables(`<p>(In thousands)</p>${table}`)[0]!.scale, "thousands");
  // A table straight after another continues its statement, as AMD's net income table does its gross profit's.
  assert.deepEqual(readTables(`<p>(in millions)</p>${table}\n${table}<p>Unaudited</p>${table}`).map((read) => read.scale), ["millions", "millions", undefined]);
  // A table that says its amounts are dollars keeps no earlier scale (Devin on #764).
  const dollars = `<table><tr><td>Amounts in dollars</td><td>Q3 2025</td></tr><tr><td>GAAP operating income</td><td>$20,000,000</td></tr></table>`;
  assert.deepEqual(readTables(`<p>(in millions)</p>${table}\n${dollars}`).map((read) => read.scale), ["millions", undefined]);
});

test("a total sums its lines to each one's printed rounding, its own included (Devin on #764)", () => {
  const html = `<table>
    <tr><th>GAAP to non-GAAP reconciliation</th><th>Q3 2025</th></tr>
    <tr><td>GAAP operating income</td><td>$10.0</td></tr>
    <tr><td>Stock-based compensation, cost of revenue</td><td>0.24</td></tr>
    <tr><td>Stock-based compensation, operating expenses</td><td>0.30</td></tr>
    <tr><td>Total stock-based compensation</td><td>0.5</td></tr>
    <tr><td>Non-GAAP operating income</td><td>$10.5</td></tr>
  </table>`;
  assert.deepEqual(lines(html), [["operating_income", "Q3 2025", 10, 10.5, [["Stock-based compensation, cost of revenue", 0.24], ["Stock-based compensation, operating expenses", 0.3]]]]);
});

test("NVIDIA's real reconciliation: the non-GAAP cost of revenue closes its own GAAP row, no add-back to gross profit", () => {
  const html = readFileSync(new URL("./fixtures/sec-8k-nvda-reconciliation.htm", import.meta.url), "utf8");
  const quarter = lines(html).filter(([, period]) => period === "Three Months Ended October 26, 2025");
  assert.deepEqual(quarter, [
    ["gross_profit", "Three Months Ended October 26, 2025", 41_849, 41_967, [["Acquisition-related and other costs (A)", 48], ["Stock-based compensation expense (B)", 70]]],
    ["operating_expenses", "Three Months Ended October 26, 2025", 5_839, 4_215, [["Stock-based compensation expense (B)", -1_585], ["Acquisition-related and other costs (A)", -39]]],
    ["operating_income", "Three Months Ended October 26, 2025", 36_010, 37_752, [["Total impact of non-GAAP adjustments to operating income", 1_742]]],
    ["other_income_net", "Three Months Ended October 26, 2025", 1_926, 573, [["Gains from non-marketable equity securities and publicly-held equity securities, net", -1_354], ["Interest expense related to amortization of debt discount", 1]]],
    ["net_income", "Three Months Ended October 26, 2025", 31_910, 31_767, [["Total pre-tax impact of non-GAAP adjustments", 389], ["Income tax impact of non-GAAP adjustments (C)", -532]]],
  ]);
});

test("a bare scale word is a note only in parentheses, so prose that opens with \"Billions\" sets no scale", () => {
  const table = `<table><tr><td></td><td>Q3 2025</td></tr><tr><td>Revenue</td><td>$100</td></tr></table>`;
  // AMD's EX-99.1 has "...what is possible. Billions of people..." in its prose.
  assert.equal(readTables(`<p>Condensed Statements (in millions). Billions of devices run our platform.</p>${table}`)[0]!.scale, "millions");
  assert.equal(readTables(`<p>Billions of people use our products.</p>${table}`)[0]!.scale, undefined);
  assert.equal(readTables(`<p>(Billions)</p>${table}`)[0]!.scale, "billions");
  // A parenthetical that counts something else names no scale (#749 review r2).
  assert.equal(readTables(`<p>Condensed Statements (in millions). Growth across our ecosystem (billions of devices).</p>${table}`)[0]!.scale, "millions");
  assert.equal(readTables(`<p>Headcount summary (thousands of employees).</p>${table}`)[0]!.scale, undefined);
  assert.equal(readTables(`<p>(in thousands of dollars)</p>${table}`)[0]!.scale, "thousands");
});

test("a non-GAAP row closes another measure only while that measure is still open", () => {
  const html = `<table>
    <tr><th>GAAP to non-GAAP reconciliation</th><th>Q3 2025</th></tr>
    <tr><td>GAAP operating income</td><td>$100</td></tr>
    <tr><td>Stock-based compensation</td><td>10</td></tr>
    <tr><td>Non-GAAP operating income</td><td>$110</td></tr>
    <tr><td>GAAP net income</td><td>$80</td></tr>
    <tr><td>Non-GAAP operating income adjustments</td><td>20</td></tr>
    <tr><td>Non-GAAP net income</td><td>$100</td></tr>
  </table>`;
  assert.deepEqual(lines(html), [
    ["operating_income", "Q3 2025", 100, 110, [["Stock-based compensation", 10]]],
    ["net_income", "Q3 2025", 80, 100, [["Non-GAAP operating income adjustments", 20]]],
  ]);
});

test("a row of a measure's adjustments is a line of it, not its non-GAAP figure", () => {
  const html = `<table>
    <tr><th>GAAP to non-GAAP reconciliation</th><th>Q3 2025</th></tr>
    <tr><td>GAAP operating income</td><td>$100</td></tr>
    <tr><td>Non-GAAP operating income adjustments</td><td>20</td></tr>
    <tr><td>Non-GAAP operating income</td><td>$120</td></tr>
  </table>`;
  assert.deepEqual(lines(html), [["operating_income", "Q3 2025", 100, 120, [["Non-GAAP operating income adjustments", 20]]]]);
});

test("a measure named before or after its adjustments is still that measure (#749 review r2)", () => {
  const before = `<table>
    <tr><th>GAAP to non-GAAP reconciliation</th><th>Q3 2025</th></tr>
    <tr><td>GAAP operating income before adjustments</td><td>$100</td></tr>
    <tr><td>Stock-based compensation</td><td>10</td></tr>
    <tr><td>Non-GAAP operating income</td><td>$110</td></tr>
  </table>`;
  assert.deepEqual(lines(before), [["operating_income", "Q3 2025", 100, 110, [["Stock-based compensation", 10]]]]);
  for (const closing of ["Non-GAAP net income after adjustments", "Non-GAAP net income excluding adjustments"]) {
    const after = `<table>
      <tr><th>GAAP to non-GAAP reconciliation</th><th>Q3 2025</th></tr>
      <tr><td>GAAP net income</td><td>$100</td></tr>
      <tr><td>Stock-based compensation</td><td>10</td></tr>
      <tr><td>${closing}</td><td>$110</td></tr>
    </table>`;
    assert.deepEqual(lines(after), [["net_income", "Q3 2025", 100, 110, [["Stock-based compensation", 10]]]], closing);
  }
});

test("a total restates one line only when equal to it, and rounds to its printed decimals", () => {
  const html = `<table>
    <tr><th>GAAP to non-GAAP reconciliation</th><th>Q3 2025</th></tr>
    <tr><td>GAAP net income</td><td>$100</td></tr>
    <tr><td>Interest expense</td><td>1</td></tr>
    <tr><td>Total pre-tax impact of non-GAAP adjustments</td><td>2</td></tr>
    <tr><td>Non-GAAP net income</td><td>$103</td></tr>
    <tr><td>GAAP diluted EPS</td><td>$1.00</td></tr>
    <tr><td>Stock-based compensation</td><td>0.10</td></tr>
    <tr><td>Amortization of intangibles</td><td>0.20</td></tr>
    <tr><td>Total other adjustments</td><td>0.40</td></tr>
    <tr><td>Non-GAAP diluted EPS</td><td>$1.70</td></tr>
  </table>`;
  assert.deepEqual(lines(html), [
    ["net_income", "Q3 2025", 100, 103, [["Interest expense", 1], ["Total pre-tax impact of non-GAAP adjustments", 2]]],
    ["eps_diluted", "Q3 2025", 1, 1.7, [["Stock-based compensation", 0.1], ["Amortization of intangibles", 0.2], ["Total other adjustments", 0.4]]],
  ]);
});

test("a row of bare years under a banner dating several columns heads its columns", () => {
  const html = `<table>
    <tr><td></td><td colspan="2">Years Ended December 31, 2025 and 2024</td></tr>
    <tr><td>(In millions)</td><td>2025</td><td>2024</td></tr>
    <tr><td>GAAP net income</td><td>2000</td><td>1,900</td></tr>
    <tr><td>Stock-based compensation</td><td>10</td><td>9</td></tr>
    <tr><td>Non-GAAP net income</td><td>2,010</td><td>1,909</td></tr>
  </table>`;
  assert.deepEqual(lines(html), [
    ["net_income", "Years Ended December 31, 2025 and 2024 2025", 2_000, 2_010, [["Stock-based compensation", 10]]],
    ["net_income", "Years Ended December 31, 2025 and 2024 2024", 1_900, 1_909, [["Stock-based compensation", 9]]],
  ]);
});
