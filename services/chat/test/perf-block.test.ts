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

function storedRow(r: SealedPriceRange) {
  return {
    bar_range_id: r.bar_range_id,
    listing_id: r.listing_id,
    adjustment_basis: r.adjustment_basis,
    source_id: r.source_id,
    delay_class: r.delay_class,
    range_start: r.range_start,
    range_end: r.range_end,
    as_of: r.as_of,
    bars: r.bars,
  };
}

test("range metadata and its bars are read in one statement, so a concurrent refresh cannot mix them", async () => {
  let queries = 0;
  const db = { query: fakeQuery(() => { queries += 1; return { rows: [storedRow(NVDA), storedRow(AMD)] }; }) };
  const blocks = await loadPerfComparisonBlocks(db, {
    listings: [{ id: NVDA.listing_id, label: "NVDA" }, { id: AMD.listing_id, label: "AMD" }],
    snapshotId: SNAPSHOT_ID,
    asOf: AS_OF,
  });
  assert.equal(queries, 1);
  assert.equal(blocks[0]?.kind, "perf_comparison");
});

test("a company without stored prices means no chart, rather than a chart missing a company", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const db = { query: fakeQuery(() => ({ rows: [storedRow(NVDA), storedRow(AMD)] })) };
  const blocks = await loadPerfComparisonBlocks(db, {
    listings: [
      { id: NVDA.listing_id, label: "NVDA" },
      { id: AMD.listing_id, label: "AMD" },
      { id: "62000000-0000-4000-8000-000000000003", label: "INTC" },
    ],
    snapshotId: SNAPSHOT_ID,
    asOf: AS_OF,
  });
  assert.deepEqual(blocks, []);
  assert.equal(warn.mock.callCount(), 0, "refused deliberately, not by a swallowed error");
});

test("each sealed series pins a digest of the stored bars, so a later refresh of the same range is detectable", () => {
  const block = buildPerfComparisonBlock({ ranges: [NVDA, AMD], snapshotId: SNAPSHOT_ID, asOf: AS_OF });
  const refreshed = buildPerfComparisonBlock({
    ranges: [NVDA, { ...AMD, bars: AMD.bars.map((bar) => ({ ...bar, close: bar.close + 1 })) }],
    snapshotId: SNAPSHOT_ID,
    asOf: AS_OF,
  });
  const digests = (b: typeof block) => (b?.provenance_series_specs as Array<{ bars_sha256: string }>).map((s) => s.bars_sha256);
  for (const digest of digests(block)) assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digests(block)[0], digests(refreshed)[0]);
  assert.notEqual(digests(block)[1], digests(refreshed)[1]);
});

const LISTINGS = [{ id: NVDA.listing_id, label: "NVDA" }, { id: AMD.listing_id, label: "AMD" }];
const asBasis = (r: SealedPriceRange, adjustment_basis: string) =>
  ({ ...r, adjustment_basis, bar_range_id: `${r.bar_range_id.slice(0, -1)}${adjustment_basis.length % 10}` });

test("prices on one basis are charted on it; split-adjusted returns say they exclude dividends (#191)", async () => {
  const seen: string[] = [];
  const rows = [NVDA, AMD].flatMap((r) => [storedRow(asBasis(r, "split_adjusted")), storedRow(asBasis(r, "split_and_div_adjusted"))]);
  const db = { query: fakeQuery((text) => { seen.push(text); return { rows }; }) };
  const [chart, disclosure] = await loadPerfComparisonBlocks(db, { listings: LISTINGS, snapshotId: SNAPSHOT_ID, asOf: AS_OF });
  assert.equal(chart?.kind, "perf_comparison");
  assert.equal(chart.basis, "split_adjusted", "split-adjusted first when every company has both");
  assert.equal(chart.title, "Price return (split-adjusted, excluding dividends)");
  const specs = chart.provenance_series_specs as Array<{ adjustment_basis: string }>;
  assert.ok(specs.every((spec) => spec.adjustment_basis === "split_adjusted"));
  assert.match((disclosure?.items as string[]).join(" "), /dividends are not included/);
  // Polygon ranges stored under the old dividend-adjusted label are never read.
  assert.match(seen[0], /not \(source_id = '00000000-0000-4000-a000-000000000009'::uuid and adjustment_basis = 'split_and_div_adjusted'\)/);
});

test("companies whose prices share no basis get a named gap instead of a chart (#191)", async () => {
  const rows = [storedRow(asBasis(NVDA, "split_adjusted")), storedRow(asBasis(AMD, "split_and_div_adjusted"))];
  const blocks = await loadPerfComparisonBlocks(
    { query: fakeQuery(() => ({ rows })) },
    { listings: LISTINGS, snapshotId: SNAPSHOT_ID, asOf: AS_OF },
  );
  assert.deepEqual(blocks.map((block) => block.kind), ["rich_text"]);
  assert.equal(
    (blocks[0].segments as Array<{ text: string }>)[0].text,
    "Price performance is not shown: the stored prices are on different bases (NVDA's are split-adjusted only; AMD's are split- and dividend-adjusted), so their returns would not be comparable.",
  );
});

// A YTD request (#192): New York sessions stamped at local midnight.
const ytdBar = (date: string, close: number) => ({
  ts: `${date}T${date >= "2026-03-08" ? "04" : "05"}:00:00.000Z`,
  close,
});
function ytdRow(r: SealedPriceRange, bars: Array<{ ts: string; close: number }>) {
  return { ...storedRow(r), adjustment_basis: "split_adjusted", range_start: "2025-12-01T05:00:00.000Z", bars };
}
function ytdDb(rangeRows: Array<Record<string, unknown>>, seen: Array<{ text: string; values?: unknown[] }> = []) {
  return {
    query: fakeQuery((text, values) => {
      seen.push({ text, values });
      if (text.includes("from listings")) {
        return { rows: LISTINGS.map((listing) => ({ listing_id: listing.id, timezone: "America/New_York" })) };
      }
      return { rows: rangeRows };
    }),
  };
}

test("a YTD request charts from the last close before January 1 to the latest common session (#192)", async () => {
  const seen: Array<{ text: string; values?: unknown[] }> = [];
  const nvda = [ytdBar("2025-12-31", 100), ytdBar("2026-01-02", 110), ytdBar("2026-08-31", 120)];
  const amd = [ytdBar("2025-12-31", 50), ytdBar("2026-01-02", 45), ytdBar("2026-08-31", 60)];
  const [chart, disclosure] = await loadPerfComparisonBlocks(
    ytdDb([ytdRow(NVDA, nvda), ytdRow(AMD, amd)], seen),
    { listings: LISTINGS, snapshotId: SNAPSHOT_ID, asOf: AS_OF, window: "ytd" },
  );
  assert.equal(chart?.kind, "perf_comparison");
  assert.equal(chart.title, "Price return YTD 2026 (split-adjusted, excluding dividends)");
  assert.equal(chart.default_range, "YTD 2026: 2025-12-31 close to 2026-08-31 close");
  const series = chart.series as Array<{ name: string; points: Array<{ x: string; y: number }> }>;
  assert.deepEqual(series[0].points.map((point) => point.x), ["2025-12-31", "2026-01-02", "2026-08-31"]);
  assert.equal(series[0].points.at(-1)?.y, 20, "from the 100 baseline, not the 110 January close");
  assert.equal(series[1].points.at(-1)?.y, 20);
  const specs = chart.provenance_series_specs as Array<{ window: unknown; bars_sha256: string }>;
  assert.deepEqual(specs[0].window, { kind: "ytd", year: 2026, baseline_date: "2025-12-31", end_date: "2026-08-31" });
  assert.equal(disclosure?.kind, "disclosure");
  // Only ranges reaching back over the year-end are read: by the start of Dec 25
  // UTC, so a New York range from Dec 24 (05:00Z) qualifies.
  const rangesQuery = seen.find((query) => query.text.includes("market_bar_ranges"))!;
  assert.equal(rangesQuery.values?.[4], "2025-12-25T00:00:00.000Z");
});

test("a YTD request that can't be met is a named gap, not a shorter window (#192)", async () => {
  // AMD has no stored range reaching back over the year-end.
  const blocks = await loadPerfComparisonBlocks(
    ytdDb([ytdRow(NVDA, [ytdBar("2025-12-31", 100), ytdBar("2026-08-31", 120)])]),
    { listings: LISTINGS, snapshotId: SNAPSHOT_ID, asOf: AS_OF, window: "ytd" },
  );
  assert.deepEqual(blocks.map((block) => block.kind), ["rich_text"]);
  assert.equal(
    (blocks[0].segments as Array<{ text: string }>)[0].text,
    "Year-to-date price performance is not shown: AMD has no prices from before 2026.",
  );
});

test("the YTD gap names the company without pre-year prices, whatever basis the others have (#192)", async () => {
  // NVDA's only range is dividend-adjusted; AMD has none.
  const nvda = { ...ytdRow(NVDA, [ytdBar("2025-12-31", 100), ytdBar("2026-08-31", 120)]), adjustment_basis: "split_and_div_adjusted" };
  const blocks = await loadPerfComparisonBlocks(ytdDb([nvda]), { listings: LISTINGS, snapshotId: SNAPSHOT_ID, asOf: AS_OF, window: "ytd" });
  assert.equal(
    (blocks[0].segments as Array<{ text: string }>)[0].text,
    "Year-to-date price performance is not shown: AMD has no prices from before 2026.",
  );
});

test("exchanges in different calendar years at the cutoff are a YTD gap before any range is read (#192)", async () => {
  const seen: Array<{ text: string; values?: unknown[] }> = [];
  const db = {
    query: fakeQuery((text, values) => {
      seen.push({ text, values });
      // At 01:00Z on Jan 1, New York is still in 2025 and Tokyo is in 2026.
      return { rows: [{ listing_id: NVDA.listing_id, timezone: "America/New_York" }, { listing_id: AMD.listing_id, timezone: "Asia/Tokyo" }] };
    }),
  };
  const blocks = await loadPerfComparisonBlocks(db, { listings: LISTINGS, snapshotId: SNAPSHOT_ID, asOf: "2026-01-01T01:00:00.000Z", window: "ytd" });
  assert.equal(
    (blocks[0].segments as Array<{ text: string }>)[0].text,
    "Year-to-date price performance is not shown: the companies' exchanges are in different calendar years at the cutoff.",
  );
  assert.ok(seen.every((query) => !query.text.includes("market_bar_ranges")));
});

// #256: cached ranges that stopped in May, stored on May 30.
function staleYtdRows(basis = "split_adjusted") {
  const stale = (r: SealedPriceRange, closes: [number, number]) => ({
    ...ytdRow(r, [ytdBar("2025-12-31", closes[0]), ytdBar("2026-05-29", closes[1])]),
    adjustment_basis: basis,
    as_of: "2026-05-30T04:00:00.000Z",
  });
  return [stale(NVDA, [100, 120]), stale(AMD, [50, 60])];
}
const CURRENT_CUTOFF = "2026-10-06T16:00:00.000Z"; // Tuesday noon in New York

test("a current YTD request whose cached prices stopped months ago is a named gap, not a chart (#256)", async () => {
  const blocks = await loadPerfComparisonBlocks(ytdDb(staleYtdRows()), { listings: LISTINGS, snapshotId: SNAPSHOT_ID, asOf: CURRENT_CUTOFF, window: "ytd" });
  assert.deepEqual(blocks.map((block) => block.kind), ["rich_text"], "no chart, so no stale return reaches the narrative");
  assert.equal(
    (blocks[0].segments as Array<{ text: string }>)[0].text,
    "Year-to-date price performance is not shown: the latest close every company has is 2026-05-29, too old to be current at the 2026-10-06 cutoff.",
  );
});

test("the same cached prices chart at a cutoff they are current for, not judged against today (#256)", async () => {
  // Saturday May 30: Friday May 29 is the last completed session.
  const [chart] = await loadPerfComparisonBlocks(ytdDb(staleYtdRows()), { listings: LISTINGS, snapshotId: SNAPSHOT_ID, asOf: "2026-05-30T16:00:00.000Z", window: "ytd" });
  assert.equal(chart?.kind, "perf_comparison");
  assert.equal(chart.default_range, "YTD 2026: 2025-12-31 close to 2026-05-29 close");
});

test("a window ending before a long weekend is still current (#256)", async () => {
  // Tuesday after Labor Day (Monday Sep 7, 2026), before the close: Friday is the latest session.
  const rows = [NVDA, AMD].map((r, i) => ytdRow(r, [ytdBar("2025-12-31", 100 + i), ytdBar("2026-09-04", 120 + i)]));
  const [chart] = await loadPerfComparisonBlocks(ytdDb(rows), { listings: LISTINGS, snapshotId: SNAPSHOT_ID, asOf: "2026-09-08T14:00:00.000Z", window: "ytd" });
  assert.equal(chart?.kind, "perf_comparison");
  assert.equal(chart.default_range, "YTD 2026: 2025-12-31 close to 2026-09-04 close");
});

test("a stale basis gives way to a current one every company has (#256)", async () => {
  const current = [NVDA, AMD].map((r, i) => ({
    ...ytdRow(r, [ytdBar("2025-12-31", 100 + i), ytdBar("2026-10-05", 130 + i)]),
    adjustment_basis: "split_and_div_adjusted",
  }));
  const [chart] = await loadPerfComparisonBlocks(ytdDb([...staleYtdRows(), ...current]), { listings: LISTINGS, snapshotId: SNAPSHOT_ID, asOf: CURRENT_CUTOFF, window: "ytd" });
  assert.equal(chart?.kind, "perf_comparison");
  assert.equal(chart.basis, "split_and_div_adjusted");
  assert.equal(chart.default_range, "YTD 2026: 2025-12-31 close to 2026-10-05 close");
});

test("a frozen dataset charts its stored YTD window whatever its age (#256)", async () => {
  const [chart] = await loadPerfComparisonBlocks(ytdDb(staleYtdRows()), { listings: LISTINGS, snapshotId: SNAPSHOT_ID, asOf: CURRENT_CUTOFF, window: "ytd", frozenPrices: true });
  assert.equal(chart?.kind, "perf_comparison");
  assert.equal(chart.default_range, "YTD 2026: 2025-12-31 close to 2026-05-29 close");
});
