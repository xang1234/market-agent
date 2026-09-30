import assert from "node:assert/strict";
import test from "node:test";

import type { IssuerFundamentalFact } from "../../fundamentals/src/issuer-fundamentals-reader.ts";
import type { VerifierFact } from "../../snapshot/src/snapshot-verifier.ts";
import { buildIssuerFactBlocks, listingsForComparison } from "../src/fact-blocks.ts";

const SNAPSHOT_ID = "11111111-1111-4111-a111-111111111111";
const AS_OF = "2026-09-01T00:00:00.000Z";
const SOURCE_ID = "00000000-0000-4000-a000-000000000001";

let nextId = 0;
function fact(metric_key: string, fiscal_year: number, fiscal_period: string, value_num: number): IssuerFundamentalFact {
  nextId += 1;
  return {
    fact_id: `f0000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`,
    metric_key,
    display_name: metric_key,
    value_num,
    value_text: null,
    unit: "currency",
    currency: "USD",
    scale: 1,
    fiscal_year,
    fiscal_period,
    as_of: AS_OF,
    source_id: SOURCE_ID,
  };
}

function verifierFacts(facts: ReadonlyArray<IssuerFundamentalFact>): VerifierFact[] {
  return facts.map((f) => ({
    fact_id: f.fact_id,
    source_id: f.source_id,
    unit: "currency",
    period_kind: "fiscal_q",
    period_start: null,
    period_end: null,
    as_of: AS_OF,
    fiscal_year: f.fiscal_year,
    fiscal_period: f.fiscal_period,
  }));
}

function quarters(count: number): IssuerFundamentalFact[] {
  const out: IssuerFundamentalFact[] = [];
  for (let i = 0; i < count; i += 1) {
    const year = 2024 + Math.floor(i / 4);
    const period = `Q${(i % 4) + 1}`;
    const revenue = (i + 1) * 1e9;
    out.push(
      fact("revenue", year, period, revenue),
      fact("gross_profit", year, period, revenue * 0.6),
      fact("operating_income", year, period, revenue * 0.4),
      fact("net_income", year, period, revenue * 0.3),
    );
  }
  return out;
}

function blocksFor(facts: ReadonlyArray<IssuerFundamentalFact>) {
  return buildIssuerFactBlocks({ facts, verifierFacts: verifierFacts(facts), snapshotId: SNAPSHOT_ID, asOf: AS_OF });
}

test("builds a latest-quarter metric_row and an 8-quarter revenue_bars chart, oldest first", () => {
  const facts = quarters(10);
  const [metricRow, bars] = blocksFor(facts);

  assert.equal(metricRow.kind, "metric_row");
  assert.deepEqual(
    (metricRow.items as Array<{ label: string }>).map((item) => item.label),
    ["Revenue", "Gross profit", "Operating income", "Net income"],
  );
  assert.match(String(metricRow.title), /Q2 2026/);

  assert.equal(bars.kind, "revenue_bars");
  const barLabels = (bars.bars as Array<{ label: string }>).map((bar) => bar.label);
  assert.equal(barLabels.length, 8);
  assert.equal(barLabels[0], "Q3 2024");
  assert.equal(barLabels.at(-1), "Q2 2026");
});

test("every rendered value is a cited, bound fact with its source on the block", () => {
  for (const block of blocksFor(quarters(3))) {
    const valueRefs = JSON.stringify(block).match(/"value_ref":"([^"]+)"/g)?.map((m) => m.slice(13, -1)) ?? [];
    assert.ok(valueRefs.length > 0, `${block.kind} renders no facts`);
    const params = (block.data_ref as { params?: { fact_bindings?: Array<{ fact_id: string }> } }).params;
    const bound = new Set(params?.fact_bindings?.map((binding) => binding.fact_id));
    const cited = new Set(block.provenance_fact_refs as string[]);
    for (const ref of valueRefs) {
      assert.ok(bound.has(ref), `${block.kind}: ${ref} has no fact binding`);
      assert.ok(cited.has(ref), `${block.kind}: ${ref} is not cited`);
    }
    assert.deepEqual(block.source_refs, [SOURCE_ID]);
    assert.equal(block.snapshot_id, SNAPSHOT_ID);
    assert.deepEqual((block.data_ref as { kind: string }).kind, block.kind);
  }
});

test("bindings carry the verifier's fact metadata without the source id", () => {
  const facts = quarters(1);
  const [metricRow] = blocksFor(facts);
  const binding = (metricRow.data_ref as { params: { fact_bindings: Array<Record<string, unknown>> } })
    .params.fact_bindings[0];
  assert.equal(binding.source_id, undefined);
  assert.equal(binding.period_kind, "fiscal_q");
  assert.equal(binding.fiscal_period, "Q1");
});

test("metric_row omits metrics the latest quarter does not report", () => {
  const facts = [fact("revenue", 2026, "Q1", 5e9), fact("net_income", 2026, "Q1", 1e9)];
  const [metricRow] = blocksFor(facts);
  assert.deepEqual(
    (metricRow.items as Array<{ label: string }>).map((item) => item.label),
    ["Revenue", "Net income"],
  );
});

test("no quarterly revenue means no fact blocks", () => {
  assert.deepEqual(blocksFor([fact("net_income", 2026, "Q1", 1e9)]), []);
  assert.deepEqual(blocksFor([]), []);
});

test("facts the verifier cannot load are left out rather than rendered unbound", () => {
  const facts = quarters(2);
  const loadable = verifierFacts(facts).filter((f) => f.fact_id !== facts[0].fact_id);
  const blocks = buildIssuerFactBlocks({ facts, verifierFacts: loadable, snapshotId: SNAPSHOT_ID, asOf: AS_OF });
  assert.equal(JSON.stringify(blocks).includes(facts[0].fact_id), false);
});

test("a comparison charts the listing the user asked for, not an arbitrary one of the issuer's", () => {
  const issuer = "60000000-0000-4000-8000-000000000001";
  const peer = "60000000-0000-4000-8000-000000000002";
  const listings = listingsForComparison(
    [issuer, peer],
    new Map([[issuer, { listing_id: "listing-requested", label: "GOOG" }]]),
    new Map([
      [issuer, { listing_id: "listing-alphabetical", label: "GOOGA" }],
      [peer, { listing_id: "listing-peer", label: "MSFT" }],
    ]),
  );
  assert.deepEqual(listings.get(issuer), { listing_id: "listing-requested", label: "GOOG" });
  // Auto-selected peers were never resolved, so they use the issuer's active listing.
  assert.deepEqual(listings.get(peer), { listing_id: "listing-peer", label: "MSFT" });
});
