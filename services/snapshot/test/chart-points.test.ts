import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { compileDisclosurePolicy } from "../src/disclosure-policy.ts";
import type { JsonValue } from "../src/manifest-staging.ts";
import type { QueryExecutor } from "../../shared/src/http.ts";
import { verifySnapshotSeal, type SnapshotVerificationInput, type VerifierBlock } from "../src/snapshot-verifier.ts";

const snapshotId = "00000000-0000-4000-8000-000000000001";
const sourceId = "00000000-0000-4000-8000-000000000006";
const nvdaListing = "00000000-0000-4000-8000-000000000021";
const amdListing = "00000000-0000-4000-8000-000000000022";
const nvdaRange = "00000000-0000-4000-8000-000000000031";
const amdRange = "00000000-0000-4000-8000-000000000032";
const nvdaSeries = "00000000-0000-4000-8000-000000000041";
const amdSeries = "00000000-0000-4000-8000-000000000042";
const AS_OF = "2026-09-01T00:00:00.000Z";
const TICKERS: Record<string, string> = { [nvdaListing]: "NVDA", [amdListing]: "AMD" };

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

type Bar = { ts: string; close: number };
type Line = { name?: string; unit?: string; points: Array<{ x: string; y: number }> };

const daily = (closes: number[]): Bar[] => closes.map((close, index) => ({ ts: `2026-08-${22 + index}T00:00:00.000Z`, close }));
// New York sessions stamped at local midnight.
const ny = (date: string, close: number): Bar => ({ ts: `${date}T${date >= "2026-03-08" ? "04" : "05"}:00:00.000Z`, close });

const LATEST = {
  bars: { [nvdaRange]: daily([100, 110, 121]), [amdRange]: daily([50, 45, 55]) },
  hashes: [
    sha256('[["2026-08-22T00:00:00.000Z",100],["2026-08-23T00:00:00.000Z",110],["2026-08-24T00:00:00.000Z",121]]'),
    sha256('[["2026-08-22T00:00:00.000Z",50],["2026-08-23T00:00:00.000Z",45],["2026-08-24T00:00:00.000Z",55]]'),
  ],
  series: [
    { points: [{ x: "2026-08-22", y: 0 }, { x: "2026-08-23", y: 10.000000000000009 }, { x: "2026-08-24", y: 20.999999999999996 }] },
    { points: [{ x: "2026-08-22", y: 0 }, { x: "2026-08-23", y: -9.999999999999998 }, { x: "2026-08-24", y: 10.000000000000009 }] },
  ],
};

const YTD_WINDOW = { kind: "ytd", year: 2026, baseline_date: "2025-12-31", end_date: "2026-08-31" };
const YTD = {
  // AMD's Dec 30 close is before the baseline, and NVDA's Sep 1 session was
  // stored after the window ended: neither is in the window or its digest.
  bars: {
    [nvdaRange]: [ny("2025-12-31", 100), ny("2026-01-02", 110), ny("2026-08-31", 120), ny("2026-09-01", 130)],
    [amdRange]: [ny("2025-12-30", 40), ny("2025-12-31", 50), ny("2026-01-02", 45), ny("2026-08-31", 60)],
  },
  hashes: [
    sha256('[["2025-12-31T05:00:00.000Z",100],["2026-01-02T05:00:00.000Z",110],["2026-08-31T04:00:00.000Z",120]]'),
    sha256('[["2025-12-31T05:00:00.000Z",50],["2026-01-02T05:00:00.000Z",45],["2026-08-31T04:00:00.000Z",60]]'),
  ],
  series: [
    { points: [{ x: "2025-12-31", y: 0 }, { x: "2026-01-02", y: 10 }, { x: "2026-08-31", y: 20 }] },
    { points: [{ x: "2025-12-31", y: 0 }, { x: "2026-01-02", y: -10 }, { x: "2026-08-31", y: 20 }] },
  ],
};

type Window = Record<string, string | number>;

function spec(seriesRef: string, listingId: string, barRangeId: string, hash: string, window?: Window) {
  return {
    series_ref: seriesRef,
    source_id: sourceId,
    listing_id: listingId,
    bar_range_id: barRangeId,
    bars_sha256: hash,
    interval: "1d",
    adjustment_basis: "split_adjusted",
    normalization: "pct_return",
    points: "perf_lines",
    delay_class: "eod",
    range: { start: "2025-12-01T05:00:00.000Z", end: AS_OF },
    ...(window ? { window } : {}),
    as_of: AS_OF,
  };
}

function sealInput(
  chart: { hashes: string[]; series: Line[] },
  options: { window?: Window; seriesRefs?: string[]; subjectLabels?: string[] } = {},
): SnapshotVerificationInput {
  const specs = [
    spec(nvdaSeries, nvdaListing, nvdaRange, chart.hashes[0], options.window),
    spec(amdSeries, amdListing, amdRange, chart.hashes[1], options.window),
  ];
  const manifest = {
    subject_refs: [{ kind: "listing" as const, id: nvdaListing }, { kind: "listing" as const, id: amdListing }],
    fact_refs: [],
    claim_refs: [],
    event_refs: [],
    document_refs: [],
    source_ids: [sourceId],
    series_specs: specs,
    as_of: AS_OF,
    basis: "split_adjusted" as const,
    normalization: "pct_return" as const,
  };
  const policy = compileDisclosurePolicy({ snapshot_id: snapshotId, manifest });
  const block = {
    id: "perf",
    kind: "perf_comparison",
    snapshot_id: snapshotId,
    data_ref: { kind: "perf_comparison", id: "perf", params: { series_refs: options.seriesRefs ?? [nvdaSeries, amdSeries] } },
    source_refs: [sourceId],
    as_of: AS_OF,
    subject_refs: manifest.subject_refs,
    subject_labels: options.subjectLabels ?? ["NVDA", "AMD"],
    series: chart.series.map((line, index) => ({ name: ["NVDA", "AMD"][index], unit: "%", ...line })),
  } as VerifierBlock;
  return {
    snapshot_id: snapshotId,
    manifest,
    sources: [{ source_id: sourceId }],
    required_disclosures: policy.required_disclosures,
    blocks: [block, ...(policy.required_disclosure_blocks as unknown as VerifierBlock[])],
  };
}

// The rows the seal's queries return: timestamptz as a Date, close as float8.
type StoredRange = {
  listing_id: string;
  source_id: string;
  interval: string;
  adjustment_basis: string;
  range_start: string;
  range_end: string;
  delay_class: string;
  as_of: string;
};

// The stored ranges the specs name, unless a test says otherwise.
const STORED: Record<string, StoredRange> = Object.fromEntries([[nvdaRange, nvdaListing], [amdRange, amdListing]].map(([range, listing]) => [range, {
  listing_id: listing,
  source_id: sourceId,
  interval: "1d",
  adjustment_basis: "split_adjusted",
  range_start: "2025-12-01T05:00:00.000Z",
  range_end: AS_OF,
  delay_class: "eod",
  as_of: AS_OF,
}]));

function barsDb(bars: Record<string, Bar[]>, ranges: Record<string, StoredRange> = STORED): QueryExecutor & { failures: unknown[] } {
  const failures: unknown[] = [];
  return {
    failures,
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      if (text.includes("from market_bars")) {
        const ids = values?.[0] as string[];
        const rows = ids.flatMap((id) => (bars[id] ?? []).map((bar) => ({ bar_range_id: id, ts: new Date(bar.ts), close: bar.close })));
        return { rows: rows as unknown as R[] };
      }
      if (text.includes("from market_bar_ranges")) {
        const ids = values?.[0] as string[];
        const rows = ids.flatMap((id) => (ranges[id] ? [{ bar_range_id: id, ...ranges[id], range_start: new Date(ranges[id].range_start), range_end: new Date(ranges[id].range_end), as_of: new Date(ranges[id].as_of) }] : []));
        return { rows: rows as unknown as R[] };
      }
      if (text.includes("from listings")) {
        const ids = values?.[0] as string[];
        return { rows: ids.map((id) => ({ listing_id: id, timezone: "America/New_York", ticker: TICKERS[id] })) as unknown as R[] };
      }
      if (text.includes("insert into verifier_fail_logs")) {
        failures.push(JSON.parse(String(values?.[3])));
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

const pointsFailures = (result: Awaited<ReturnType<typeof verifySnapshotSeal>>) =>
  result.failures.filter((failure) => failure.reason_code === "series_points_mismatch").map((failure) => failure.details);

test("a latest-window chart whose points are its sealed bars' returns seals", async () => {
  assert.deepEqual(await verifySnapshotSeal(sealInput(LATEST), barsDb(LATEST.bars)), { ok: true, failures: [] });
});

test("a line whose bars are another listing's, source's or basis' range fails, though its points match them (#315 review)", async () => {
  for (const [field, value] of [["listing_id", amdListing], ["source_id", "00000000-0000-4000-8000-000000000007"], ["adjustment_basis", "unadjusted"], ["range_end", "2026-08-31T00:00:00.000Z"]]) {
    const result = await verifySnapshotSeal(sealInput(LATEST), barsDb(LATEST.bars, { ...STORED, [nvdaRange]: { ...STORED[nvdaRange]!, [field]: value } }));
    assert.deepEqual(pointsFailures(result), [{ block_id: "perf", series_ref: nvdaSeries, reason: "range" }], field);
  }
  const missing = await verifySnapshotSeal(sealInput(LATEST), barsDb(LATEST.bars, { [amdRange]: STORED[amdRange]! }));
  assert.deepEqual(pointsFailures(missing), [{ block_id: "perf", series_ref: nvdaSeries, reason: "range" }], "no stored range");
});

test("a chart whose spec claims fresher or more real-time prices than its stored range fails; an older claim passes (#315 review)", async () => {
  const realTime = await verifySnapshotSeal(sealInput(LATEST), barsDb(LATEST.bars, { ...STORED, [nvdaRange]: { ...STORED[nvdaRange]!, delay_class: "real_time" } }));
  assert.deepEqual(pointsFailures(realTime), [{ block_id: "perf", series_ref: nvdaSeries, reason: "range" }], "delay class");
  const older = await verifySnapshotSeal(sealInput(LATEST), barsDb(LATEST.bars, { ...STORED, [nvdaRange]: { ...STORED[nvdaRange]!, as_of: "2026-08-31T00:00:00.000Z" } }));
  assert.deepEqual(pointsFailures(older), [{ block_id: "perf", series_ref: nvdaSeries, reason: "range" }], "the spec is fresher than the stored range");
  const refreshed = await verifySnapshotSeal(sealInput(LATEST), barsDb(LATEST.bars, { ...STORED, [nvdaRange]: { ...STORED[nvdaRange]!, as_of: "2026-09-02T00:00:00.000Z" } }));
  assert.deepEqual(pointsFailures(refreshed), [], "refreshed since the chart was drawn");
});

test("a line shown under a company other than its series' listing fails (#315 review)", async () => {
  const input = sealInput(LATEST);
  const [chart, ...rest] = input.blocks;
  const swapped = { ...chart!, subject_refs: [...(chart!.subject_refs ?? [])].reverse() };
  const result = await verifySnapshotSeal({ ...input, blocks: [swapped, ...rest] }, barsDb(LATEST.bars));
  assert.deepEqual(pointsFailures(result), [{ block_id: "perf", series_ref: nvdaSeries, reason: "subject" }]);
});

test("a line whose legend name, subject label or unit is not its listing's ticker and percent fails (#316)", async () => {
  const [nvda, amd] = LATEST.series;
  const swapped = await verifySnapshotSeal(sealInput({ ...LATEST, series: [{ ...nvda!, name: "AMD" }, { ...amd!, name: "NVDA" }] }), barsDb(LATEST.bars));
  assert.deepEqual(pointsFailures(swapped), [{ block_id: "perf", series_ref: nvdaSeries, reason: "label" }], "swapped legend names");
  const subject = await verifySnapshotSeal(sealInput(LATEST, { subjectLabels: ["NVDA", "Advanced Micro Devices"] }), barsDb(LATEST.bars));
  assert.deepEqual(pointsFailures(subject), [{ block_id: "perf", series_ref: amdSeries, reason: "label" }], "a subject label that is not the ticker");
  const missing = await verifySnapshotSeal(sealInput(LATEST, { subjectLabels: ["NVDA"] }), barsDb(LATEST.bars));
  assert.deepEqual(pointsFailures(missing), [{ block_id: "perf", series_ref: amdSeries, reason: "label" }], "a line with no subject label");
  const unit = await verifySnapshotSeal(sealInput({ ...LATEST, series: [nvda!, { ...amd!, unit: "USD" }] }), barsDb(LATEST.bars));
  assert.deepEqual(pointsFailures(unit), [{ block_id: "perf", series_ref: amdSeries, reason: "label" }], "a unit other than percent");
});

test("a YTD chart seals against its sealed window, ignoring sessions stored after it", async () => {
  assert.deepEqual(await verifySnapshotSeal(sealInput(YTD, { window: YTD_WINDOW }), barsDb(YTD.bars)), { ok: true, failures: [] });
});

test("a drawn point that differs from the sealed bars' return fails the seal", async () => {
  const series = [LATEST.series[0], { points: [...LATEST.series[1].points.slice(0, 2), { x: "2026-08-24", y: 12 }] }];
  const db = barsDb(LATEST.bars);
  const result = await verifySnapshotSeal(sealInput({ ...LATEST, series }), db);
  assert.equal(result.ok, false);
  assert.deepEqual(pointsFailures(result), [{ block_id: "perf", series_ref: amdSeries, reason: "points" }]);
  assert.deepEqual(db.failures, [{ block_id: "perf", series_ref: amdSeries, reason: "points" }]);
});

test("a stored close that changed since the chart was drawn fails on its digest", async () => {
  const bars = { ...LATEST.bars, [nvdaRange]: daily([100, 110, 122]) };
  const result = await verifySnapshotSeal(sealInput(LATEST), barsDb(bars));
  assert.deepEqual(pointsFailures(result), [{ block_id: "perf", series_ref: nvdaSeries, reason: "hash" }]);
});

test("a YTD chart whose sealed window is not the one its bars give fails on the window", async () => {
  const window = { ...YTD_WINDOW, baseline_date: "2025-12-30" };
  const result = await verifySnapshotSeal(sealInput(YTD, { window }), barsDb(YTD.bars));
  assert.deepEqual(pointsFailures(result), [{ block_id: "perf", series_ref: null, reason: "window" }]);
});

test("a drawn line with no sealed series behind it fails on the count", async () => {
  const series = [...LATEST.series, { points: [{ x: "2026-08-22", y: 0 }, { x: "2026-08-23", y: 5 }] }];
  const result = await verifySnapshotSeal(sealInput({ ...LATEST, series }), barsDb(LATEST.bars));
  assert.deepEqual(pointsFailures(result), [{ block_id: "perf", series_ref: null, reason: "count" }]);
});

test("two lines citing one sealed series fail as a duplicate", async () => {
  const result = await verifySnapshotSeal(sealInput(LATEST, { seriesRefs: [nvdaSeries, nvdaSeries] }), barsDb(LATEST.bars));
  assert.deepEqual(pointsFailures(result), [{ block_id: "perf", series_ref: nvdaSeries, reason: "duplicate" }]);
});

test("without the seal's transaction a chart's points cannot be checked, so it does not seal", async () => {
  const result = await verifySnapshotSeal(sealInput(LATEST));
  assert.deepEqual(result, {
    ok: false,
    failures: [{ reason_code: "series_points_mismatch", details: { block_id: "perf", series_ref: null, reason: "unverifiable" } }],
  });
});

test("a chart whose series spec does not say how its points were drawn cannot be checked", async () => {
  const input = sealInput(LATEST);
  const [first, ...others] = input.manifest.series_specs as Array<{ [key: string]: JsonValue }>;
  const { points: _points, ...unmarked } = first!;
  const result = await verifySnapshotSeal({ ...input, manifest: { ...input.manifest, series_specs: [unmarked, ...others] } }, barsDb(LATEST.bars));
  assert.deepEqual(pointsFailures(result), [{ block_id: "perf", series_ref: nvdaSeries, reason: "unverifiable" }]);
});

test("a live-rendered chart, with no embedded points, is not checked", async () => {
  const input = sealInput(LATEST);
  const [chart, ...rest] = input.blocks;
  const { series: _series, ...live } = chart;
  assert.deepEqual(await verifySnapshotSeal({ ...input, blocks: [live, ...rest] }), { ok: true, failures: [] });
});

// A sealed answer whose prose cites the chart's lines (#317).
function withChips(input: SnapshotVerificationInput, chips: Array<[string, string]>, sourceRefs = [sourceId]): SnapshotVerificationInput {
  const answer = {
    id: "answer",
    kind: "rich_text",
    snapshot_id: snapshotId,
    data_ref: { kind: "rich_text", id: "answer" },
    source_refs: sourceRefs,
    as_of: AS_OF,
    segments: chips.flatMap(([ref_id, format]) => [{ type: "text", text: " returned " }, { type: "ref", ref_kind: "series", ref_id, format }]),
  } as VerifierBlock;
  return { ...input, blocks: [answer, ...input.blocks] };
}

const failures = (result: Awaited<ReturnType<typeof verifySnapshotSeal>>) =>
  result.failures.map((failure) => [failure.reason_code, failure.details]);

test("a price return chip showing its line's last point as the chart labels it seals (#317)", async () => {
  const result = await verifySnapshotSeal(withChips(sealInput(LATEST), [[nvdaSeries, "21%"], [amdSeries, "10%"]]), barsDb(LATEST.bars));
  assert.deepEqual(result, { ok: true, failures: [] });
});

test("a price return chip showing anything but its line's last point fails (#317)", async () => {
  const result = await verifySnapshotSeal(withChips(sealInput(LATEST), [[nvdaSeries, "10%"], [amdSeries, "10%"]]), barsDb(LATEST.bars));
  assert.deepEqual(failures(result), [
    ["series_ref_format_mismatch", { block_id: "answer", series_ref: nvdaSeries, format: "10%", shown: ["21%"] }],
  ]);
});

test("a price return chip on a sealed series no chart draws fails: there is no verified line to show (#317)", async () => {
  const undrawn = "00000000-0000-4000-8000-000000000043";
  const input = sealInput(LATEST);
  const manifest = { ...input.manifest, series_specs: [...input.manifest.series_specs!, spec(undrawn, nvdaListing, nvdaRange, LATEST.hashes[0]!)] };
  const result = await verifySnapshotSeal(withChips({ ...input, manifest }, [[undrawn, "21%"]]), barsDb(LATEST.bars));
  assert.deepEqual(failures(result), [
    ["series_ref_format_mismatch", { block_id: "answer", series_ref: undrawn, format: "21%", shown: [] }],
  ]);
});

test("a price return chip on a series the snapshot did not seal fails (#317)", async () => {
  const unsealed = "00000000-0000-4000-8000-000000000044";
  const result = await verifySnapshotSeal(withChips(sealInput(LATEST), [[unsealed, "21%"]]), barsDb(LATEST.bars));
  assert.deepEqual(failures(result), [
    ["missing_series_ref", { block_id: "answer", series_ref: unsealed }],
    ["series_ref_format_mismatch", { block_id: "answer", series_ref: unsealed, format: "21%", shown: [] }],
  ]);
});

test("a price return chip in prose that does not cite its series' source fails (#317)", async () => {
  const result = await verifySnapshotSeal(withChips(sealInput(LATEST), [[nvdaSeries, "21%"]], []), barsDb(LATEST.bars));
  assert.deepEqual(failures(result), [
    ["missing_source_ref", { block_id: "answer", series_ref: nvdaSeries, source_id: sourceId, scope: "block_series_source" }],
  ]);
});
