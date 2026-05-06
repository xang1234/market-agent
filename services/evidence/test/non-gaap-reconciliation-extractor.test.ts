import test from "node:test";
import assert from "node:assert/strict";

import { extractNonGaapReconciliations } from "../src/reader/non-gaap-reconciliation-extractor.ts";

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
