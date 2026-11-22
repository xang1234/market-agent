import test from "node:test";
import assert from "node:assert/strict";

import { extractNonGaapReconciliations } from "../src/reader/non-gaap-reconciliation-extractor.ts";
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
      // A total of the adjustments is no adjustment itself.
      { measure: "operating_income", gaap: 36_010, non_gaap: 37_822, scale: "millions", adjustments: [] },
      { measure: "net_income", gaap: 31_910, non_gaap: 33_366, scale: "millions", adjustments: [["Income tax impact of non-GAAP adjustments (D)", -356]] },
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
