import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPerfComparisonBlock,
  loadPerfComparisonBlocks,
  perfDisclosureBlocks,
  type SealedPriceRange,
} from "../src/perf-block.ts";
import { fakeQuery } from "./fake-query.ts";

const SNAPSHOT_ID = "11111111-1111-4111-a111-111111111111";
const AS_OF = "2026-09-01T00:00:00.000Z";
const MARKET_SOURCE = "00000000-0000-4000-a000-000000000009";

function range(ticker: string, listingId: string, closes: number[], start = "2026-08-22T00:00:00.000Z"): SealedPriceRange {
  return {
    listing_id: listingId,
    label: ticker,
    bar_range_id: `b${listingId.slice(1)}`,
    source_id: MARKET_SOURCE,
    interval: "1d",
    adjustment_basis: "split_and_div_adjusted",
    delay_class: "eod",
    range_start: start,
    range_end: AS_OF,
    as_of: AS_OF,
    bars: closes.map((close, index) => ({ ts: `2026-08-${String(22 + index).padStart(2, "0")}T00:00:00.000Z`, close })),
  };
}

const NVDA = range("NVDA", "62000000-0000-4000-8000-000000000001", [100, 110, 121]);
const AMD = range("AMD", "62000000-0000-4000-8000-000000000002", [50, 45, 55]);

test("builds a percent-return comparison from sealed daily bars, one series per company", () => {
  const block = buildPerfComparisonBlock({ ranges: [NVDA, AMD], snapshotId: SNAPSHOT_ID, asOf: AS_OF });
  assert.ok(block);
  assert.equal(block.kind, "perf_comparison");
  assert.equal(block.normalization, "pct_return");
  assert.equal(block.basis, "split_and_div_adjusted");
  assert.deepEqual(block.subject_labels, ["NVDA", "AMD"]);
  assert.deepEqual(block.subject_refs, [
    { kind: "listing", id: NVDA.listing_id },
    { kind: "listing", id: AMD.listing_id },
  ]);
  const series = block.series as Array<{ name: string; unit: string; points: Array<{ x: string; y: number }> }>;
  assert.deepEqual(series.map((s) => s.name), ["NVDA", "AMD"]);
  assert.equal(series[0].unit, "%");
  assert.deepEqual(series[0].points.map((p) => p.x), ["2026-08-22", "2026-08-23", "2026-08-24"]);
  assert.deepEqual(series[0].points.map((p) => Number(p.y.toFixed(6))), [0, 10, 21]);
  assert.deepEqual(series[1].points.map((p) => Number(p.y.toFixed(6))), [0, -10, 10]);
});

test("every series is sealed: a spec pins the stored bar range and its source, and the block cites it", () => {
  const block = buildPerfComparisonBlock({ ranges: [NVDA, AMD], snapshotId: SNAPSHOT_ID, asOf: AS_OF });
  assert.ok(block);
  const specs = block.provenance_series_specs as Array<Record<string, unknown>>;
  const seriesRefs = (block.data_ref as { params: { series_refs: string[] } }).params.series_refs;
  assert.equal(specs.length, 2);
  assert.deepEqual(specs.map((spec) => spec.series_ref), seriesRefs);
  assert.equal(specs[0].bar_range_id, NVDA.bar_range_id);
  assert.equal(specs[0].listing_id, NVDA.listing_id);
  assert.equal(specs[0].source_id, MARKET_SOURCE);
  for (const ref of seriesRefs) assert.match(ref, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(block.source_refs, [MARKET_SOURCE]);
  assert.equal((block.data_ref as { kind: string }).kind, "perf_comparison");
});

test("companies whose stored windows differ are not charted against each other", () => {
  const shifted = range("AMD", AMD.listing_id, [50, 45, 55], "2026-08-15T00:00:00.000Z");
  assert.equal(buildPerfComparisonBlock({ ranges: [NVDA, shifted], snapshotId: SNAPSHOT_ID, asOf: AS_OF }), null);
});

test("fewer than two companies with bars means no chart", () => {
  assert.equal(buildPerfComparisonBlock({ ranges: [NVDA], snapshotId: SNAPSHOT_ID, asOf: AS_OF }), null);
  const empty = { ...AMD, bars: [] };
  assert.equal(buildPerfComparisonBlock({ ranges: [NVDA, empty], snapshotId: SNAPSHOT_ID, asOf: AS_OF }), null);
});

test("each sealed series records its basis and normalization", () => {
  const block = buildPerfComparisonBlock({ ranges: [NVDA, AMD], snapshotId: SNAPSHOT_ID, asOf: AS_OF });
  const specs = block?.provenance_series_specs as Array<Record<string, unknown>>;
  assert.ok(specs.every((spec) => spec.adjustment_basis === "split_and_div_adjusted" && spec.normalization === "pct_return"));
});

test("a failed price read omits only the chart", async () => {
  const db = { query: fakeQuery(() => { throw new Error("market cache unavailable"); }) };
  const blocks = await loadPerfComparisonBlocks(db, {
    listings: [{ id: NVDA.listing_id, label: "NVDA" }, { id: AMD.listing_id, label: "AMD" }],
    snapshotId: SNAPSHOT_ID,
    asOf: AS_OF,
  });
  assert.deepEqual(blocks, []);
});

test("each sealed series carries its stored delay class", () => {
  const block = buildPerfComparisonBlock({ ranges: [NVDA, AMD], snapshotId: SNAPSHOT_ID, asOf: AS_OF });
  const specs = block?.provenance_series_specs as Array<Record<string, unknown>>;
  assert.deepEqual(specs.map((spec) => spec.delay_class), ["eod", "eod"]);
});

test("end-of-day prices come with the pricing disclosure the verifier requires, covering each series", () => {
  const block = buildPerfComparisonBlock({ ranges: [NVDA, AMD], snapshotId: SNAPSHOT_ID, asOf: AS_OF });
  assert.ok(block);
  const disclosures = perfDisclosureBlocks(block);
  assert.equal(disclosures.length, 1);
  assert.equal(disclosures[0].kind, "disclosure");
  assert.equal(disclosures[0].snapshot_id, SNAPSHOT_ID);
  assert.deepEqual(disclosures[0].source_refs, [MARKET_SOURCE]);
  assert.match(JSON.stringify(disclosures[0].items), /end[- ]of[- ]day|EOD/i);
});

test("lines use only the dates every company has, each measured from the first shared close", () => {
  // AMD is missing 08-22 (e.g. a holiday or a mid-window listing); NVDA has it.
  const amdLate = {
    ...AMD,
    bars: [
      { ts: "2026-08-23T00:00:00.000Z", close: 40 },
      { ts: "2026-08-24T00:00:00.000Z", close: 44 },
    ],
  };
  const block = buildPerfComparisonBlock({ ranges: [NVDA, amdLate], snapshotId: SNAPSHOT_ID, asOf: AS_OF });
  assert.ok(block);
  const series = block.series as Array<{ points: Array<{ x: string; y: number }> }>;
  for (const line of series) assert.deepEqual(line.points.map((p) => p.x), ["2026-08-23", "2026-08-24"]);
  // The label describes the window actually drawn, not the stored range.
  assert.equal(block.default_range, "2026-08-23 to 2026-08-24");
  assert.deepEqual(series[0].points.map((p) => Number(p.y.toFixed(6))), [0, 10]);
  assert.deepEqual(series[1].points.map((p) => Number(p.y.toFixed(6))), [0, 10]);
});

test("fewer than two shared dates means no chart", () => {
  const amdOneShared = { ...AMD, bars: [{ ts: "2026-08-24T00:00:00.000Z", close: 55 }] };
  assert.equal(buildPerfComparisonBlock({ ranges: [NVDA, amdOneShared], snapshotId: SNAPSHOT_ID, asOf: AS_OF }), null);
});

test("a stale stored range is disclosed as of its own timestamp, not the answer time", () => {
  const stale = "2026-08-24T21:00:00.000Z";
  const older = "2026-08-24T20:00:00.000Z";
  const block = buildPerfComparisonBlock({
    ranges: [{ ...NVDA, as_of: stale }, { ...AMD, as_of: older }],
    snapshotId: SNAPSHOT_ID,
    asOf: AS_OF,
  });
  assert.ok(block);
  assert.equal(block.as_of, older);
  const [disclosure] = perfDisclosureBlocks(block);
  const text = JSON.stringify(disclosure.items);
  assert.ok(text.includes(older), text);
  assert.ok(!text.includes(AS_OF), text);
});

test("only ranges stored by the turn's cutoff are selected, so a mid-turn refresh cannot seal later prices", async () => {
  const seen: Array<{ text: string; values?: unknown[] }> = [];
  const db = { query: fakeQuery((text, values) => { seen.push({ text, values }); return { rows: [] }; }) };
  await loadPerfComparisonBlocks(db, {
    listings: [{ id: NVDA.listing_id, label: "NVDA" }, { id: AMD.listing_id, label: "AMD" }],
    snapshotId: SNAPSHOT_ID,
    asOf: AS_OF,
  });
  const [ranges] = seen;
  assert.match(ranges.text, /as_of <= \$4::timestamptz/);
  assert.equal(ranges.values?.[3], AS_OF);
});
