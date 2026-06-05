import test from "node:test";
import assert from "node:assert/strict";

import { buildMetricsComparisonBlock } from "../src/metrics-comparison-block-builder.ts";
import type {
  MaterializedMetric,
  MaterializedPeer,
} from "../src/metrics-comparison-materializer.ts";

const AAPL = { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" } as const;
const MSFT = { kind: "issuer", id: "33333333-3333-4333-a333-333333333333" } as const;
const GOOG = { kind: "issuer", id: "44444444-4444-4444-a444-444444444444" } as const;

let factSeq = 0;
function ref(): string {
  factSeq += 1;
  return `f0000000-0000-4000-8000-${String(factSeq).padStart(12, "0")}`;
}

function m(
  metric: MaterializedMetric["metric"],
  value_num: number,
  format: MaterializedMetric["format"],
  currency?: string,
): MaterializedMetric {
  return { metric, value_ref: ref(), value_num, format, ...(currency === undefined ? {} : { currency }) };
}

const BASE = {
  id: "block-1",
  snapshot_id: "11111111-1111-4111-a111-111111111111",
  as_of: "2024-11-01T20:30:00.000Z",
  source_refs: ["aaaaaaaa-aaaa-4aaa-a000-0000000000ed"],
};

test("buildMetricsComparisonBlock lays out subjects × present columns with tone, format, and gaps", () => {
  const peers: MaterializedPeer[] = [
    {
      subject: AAPL,
      metrics: [m("revenue", 391_035_000_000, "currency"), m("gross_margin", 0.462, "percent"), m("net_margin", 0.24, "percent")],
    },
    {
      subject: MSFT,
      metrics: [m("revenue", 245_000_000_000, "currency"), m("gross_margin", 0.69, "percent"), m("net_margin", 0.36, "percent")],
    },
    {
      // GOOG is missing net_margin → a gap cell in a column others fill.
      subject: GOOG,
      metrics: [m("revenue", 307_000_000_000, "currency"), m("gross_margin", 0.57, "percent")],
    },
  ];

  const block = buildMetricsComparisonBlock({ peers, primary: AAPL, base: BASE });

  // Columns no subject fills (growth, P/E) are dropped; the rest keep order.
  assert.deepEqual(block.metrics, ["Revenue", "Gross Margin", "Net Margin"]);
  assert.deepEqual(block.subjects, [AAPL, MSFT, GOOG]);
  assert.deepEqual(block.primary_subject_ref, AAPL);

  // Base fields + default data_ref.
  assert.equal(block.kind, "metrics_comparison");
  assert.equal(block.snapshot_id, BASE.snapshot_id);
  assert.equal(block.as_of, BASE.as_of);
  assert.deepEqual(block.source_refs, BASE.source_refs);
  assert.deepEqual(block.data_ref, { kind: "metrics_comparison", id: "block-1" });

  // Pre-rendered display values.
  assert.equal(block.cells[0][0]?.format, "$391.0B");
  assert.equal(block.cells[0][1]?.format, "46.2%");
  assert.equal(block.cells[1][0]?.format, "$245.0B");

  // Revenue is directionless → no tone.
  assert.equal(block.cells[0][0]?.tone, undefined);

  // gross_margin (higher better): MSFT 0.69 best, AAPL 0.462 worst, GOOG middle.
  assert.equal(block.cells[0][1]?.tone, "negative");
  assert.equal(block.cells[1][1]?.tone, "positive");
  assert.equal(block.cells[2][1]?.tone, "neutral");

  // net_margin column: AAPL+MSFT present, GOOG is a null gap.
  assert.equal(block.cells[0][2]?.tone, "negative");
  assert.equal(block.cells[1][2]?.tone, "positive");
  assert.equal(block.cells[2][2], null);
});

test("buildMetricsComparisonBlock includes a lower-is-better P/E column when present", () => {
  const peers: MaterializedPeer[] = [
    { subject: AAPL, metrics: [m("pe_ratio", 30, "multiple")] },
    { subject: MSFT, metrics: [m("pe_ratio", 20, "multiple")] },
  ];

  const block = buildMetricsComparisonBlock({ peers, primary: AAPL, base: BASE });

  assert.deepEqual(block.metrics, ["P/E"]);
  assert.equal(block.cells[0][0]?.format, "30.0×");
  // Lower P/E is better: MSFT (20) positive, AAPL (30) negative.
  assert.equal(block.cells[0][0]?.tone, "negative");
  assert.equal(block.cells[1][0]?.tone, "positive");
});

test("buildMetricsComparisonBlock carries a title only when provided", () => {
  const peers: MaterializedPeer[] = [{ subject: AAPL, metrics: [m("revenue", 1_000_000, "currency")] }];

  const untitled = buildMetricsComparisonBlock({ peers, primary: AAPL, base: BASE });
  assert.equal("title" in untitled, false);

  const titled = buildMetricsComparisonBlock({ peers, primary: AAPL, base: { ...BASE, title: "Peers" } });
  assert.equal(titled.title, "Peers");
});

test("buildMetricsComparisonBlock formats revenue in the metric's own currency", () => {
  const peers: MaterializedPeer[] = [
    { subject: AAPL, metrics: [m("revenue", 391_035_000_000, "currency", "USD")] },
    { subject: MSFT, metrics: [m("revenue", 80_000_000_000, "currency", "EUR")] },
  ];
  const block = buildMetricsComparisonBlock({ peers, primary: AAPL, base: BASE });
  assert.equal(block.cells[0][0]?.format, "$391.0B");
  assert.match(block.cells[1][0]?.format ?? "", /^€80\.0B$/);
});

test("buildMetricsComparisonBlock falls back to USD when a currency metric carries no currency", () => {
  const peers: MaterializedPeer[] = [{ subject: AAPL, metrics: [m("revenue", 1_000_000_000, "currency")] }];
  const block = buildMetricsComparisonBlock({ peers, primary: AAPL, base: BASE });
  assert.equal(block.cells[0][0]?.format, "$1.0B");
});
