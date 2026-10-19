// A price chart's drawn points are what its sealed series produce (#236). Each
// line i is drawn from data_ref.params.series_refs[i], whose manifest spec pins
// a stored bar range and the digest of its bars. The seal reloads those bars
// through its database client, in one statement, recomputes every line with the
// function chat draws with (perf-points.ts), and requires the digests and the
// points to match exactly. The cache replaces a range's bars in place when it
// refreshes, so this holds at seal time only; read-back trusts the seal. Each
// line is shown under its listing's ticker, in percent (#316).

import { isDeepStrictEqual } from "node:util";

import { PERF_POINTS, perfLines, type PerfLine } from "../../market/src/perf-points.ts";
import { sessionDate, windowClosedAt, type DailyClose } from "../../market/src/ytd-window.ts";
import type { JsonValue } from "./manifest-staging.ts";
import { isRecord, type QueryExecutor } from "../../shared/src/http.ts";

export type ChartPointsReason = "count" | "duplicate" | "subject" | "unverifiable" | "range" | "label" | "window" | "hash" | "points";

export type ChartPointsFailure = { block_id: string; series_ref: string | null; reason: ChartPointsReason };

export type DrawnChart = {
  block_id: string;
  series_refs: ReadonlyArray<string>;
  series: ReadonlyArray<{ name?: unknown; unit?: unknown; points: unknown }>;
  // Line i's company: the listing its series' bars must belong to.
  subject_refs: ReadonlyArray<unknown>;
  // Line i's subject chip, its listing's ticker like series[i].name.
  subject_labels: ReadonlyArray<unknown>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SealedWindow = { year: number; baseline_date: string; end_date: string };

type SealedSeries = {
  bar_range_id: string;
  listing_id: string;
  // The stored range the spec says it is: market_bar_ranges' identity.
  range: StoredRange;
  // What the chart's pricing disclosure is compiled from (#315 review).
  delay_class: string;
  as_of: number;
  bars_sha256: string;
  window: SealedWindow | null;
};

type StoredRange = { listing_id: string; source_id: string; interval: string; adjustment_basis: string; start: number; end: number };

// One drawn line and the sealed series it claims to be.
type ChartLine = { series_ref: string; spec: SealedSeries; points: unknown };

type StoredListing = { timezone: string; ticker: string };

export async function verifyChartPoints(
  charts: ReadonlyArray<DrawnChart>,
  seriesSpecs: ReadonlyArray<JsonValue>,
  db: QueryExecutor | undefined,
): Promise<ChartPointsFailure[]> {
  const specs = new Map(
    seriesSpecs.flatMap((spec) => isRecord(spec) && typeof spec.series_ref === "string" ? [[spec.series_ref, spec] as const] : []),
  );
  const failures: ChartPointsFailure[] = [];
  for (const chart of charts) {
    const fail = (reason: ChartPointsReason, series_ref: string | null = null) =>
      failures.push({ block_id: chart.block_id, series_ref, reason });
    if (chart.series.length !== chart.series_refs.length || chart.series_refs.some((ref) => !specs.has(ref))) {
      fail("count");
      continue;
    }
    const duplicate = chart.series_refs.find((ref, index) => chart.series_refs.indexOf(ref) !== index);
    if (duplicate !== undefined) {
      fail("duplicate", duplicate);
      continue;
    }
    const lines: ChartLine[] = [];
    for (const [index, series_ref] of chart.series_refs.entries()) {
      const spec = sealedSeries(specs.get(series_ref)!);
      if (spec === null) fail("unverifiable", series_ref);
      else lines.push({ series_ref, spec, points: chart.series[index].points });
    }
    if (lines.length !== chart.series.length || lines.length === 0) continue;
    const misattributed = lines.find((line, index) => {
      const subject = chart.subject_refs[index];
      return !isRecord(subject) || subject.kind !== "listing" || subject.id !== line.spec.listing_id;
    });
    if (misattributed !== undefined || chart.subject_refs.length !== lines.length) {
      fail("subject", misattributed?.series_ref ?? null);
      continue;
    }
    if (db === undefined) {
      fail("unverifiable");
      continue;
    }
    // The bars must be the range the spec names, not another listing's or
    // basis', and no fresher or more real-time than it: the pricing disclosure
    // is compiled from the spec. A refresh since the chart was drawn only makes
    // the stored as_of later.
    const stored = await loadRanges(db, lines.map((line) => line.spec.bar_range_id));
    const unbound = lines.find((line) => {
      const range = stored.get(line.spec.bar_range_id);
      return range === undefined || !isDeepStrictEqual(range.identity, line.spec.range) ||
        range.delay_class !== line.spec.delay_class || line.spec.as_of > range.as_of;
    });
    if (unbound !== undefined) {
      fail("range", unbound.series_ref);
      continue;
    }
    const listings = await loadListings(db, lines.map((line) => line.spec.listing_id));
    const mislabeled = lines.find((line, index) => {
      const ticker = listings.get(line.spec.listing_id)?.ticker;
      const { name, unit } = chart.series[index];
      return ticker === undefined || name !== ticker || chart.subject_labels[index] !== ticker || unit !== "%";
    });
    if (mislabeled !== undefined || chart.subject_labels.length !== lines.length) {
      fail("label", mislabeled?.series_ref ?? null);
      continue;
    }
    const outcome = await recompute(db, lines, listings);
    if (typeof outcome === "string") {
      fail(outcome);
      continue;
    }
    for (const [index, line] of lines.entries()) {
      if (outcome[index].bars_sha256 !== line.spec.bars_sha256) fail("hash", line.series_ref);
      else if (!isDeepStrictEqual(outcome[index].points, line.points)) fail("points", line.series_ref);
    }
  }
  return failures;
}

// Every line, recomputed from the bars its spec pins, in the mode it was drawn in.
async function recompute(
  db: QueryExecutor,
  lines: ReadonlyArray<ChartLine>,
  listings: ReadonlyMap<string, StoredListing>,
): Promise<ReadonlyArray<PerfLine> | "window"> {
  const [{ spec: { window } }] = lines;
  if (lines.some((line) => !isDeepStrictEqual(line.spec.window, window))) return "window";
  const bars = await loadBars(db, lines.map((line) => line.spec.bar_range_id));
  const barsOf = (line: ChartLine) => bars.get(line.spec.bar_range_id) ?? [];
  if (window === null) {
    const drawn = perfLines({ kind: "latest", bars: lines.map(barsOf) });
    return drawn.ok ? drawn.lines : "window";
  }
  const zoneOf = (line: ChartLine) => listings.get(line.spec.listing_id)!.timezone;
  // Sessions stored since the window ended are not part of it.
  const drawn = perfLines({
    kind: "ytd",
    series: lines.map((line) => ({
      label: line.series_ref,
      timeZone: zoneOf(line),
      bars: barsOf(line).filter((bar) => sessionDate(bar.ts, zoneOf(line)) <= window.end_date),
    })),
    cutoff: windowClosedAt(window.end_date, lines.map(zoneOf)),
  });
  if (
    !drawn.ok ||
    drawn.window.year !== window.year ||
    drawn.window.baselineDate !== window.baseline_date ||
    drawn.window.endDate !== window.end_date
  ) {
    return "window";
  }
  return drawn.lines;
}

async function loadBars(db: QueryExecutor, barRangeIds: ReadonlyArray<string>): Promise<Map<string, DailyClose[]>> {
  const { rows } = await db.query<{ bar_range_id: string; ts: Date | string; close: number }>(
    `select bar_range_id::text as bar_range_id, ts, close::float8 as close
       from market_bars
      where bar_range_id = any($1::uuid[])
      order by bar_range_id, ts`,
    [[...new Set(barRangeIds)]],
  );
  const bars = new Map<string, DailyClose[]>();
  for (const row of rows) {
    const range = bars.get(row.bar_range_id) ?? [];
    range.push({ ts: new Date(row.ts).toISOString(), close: row.close });
    bars.set(row.bar_range_id, range);
  }
  return bars;
}

async function loadRanges(
  db: QueryExecutor,
  barRangeIds: ReadonlyArray<string>,
): Promise<Map<string, { identity: StoredRange; delay_class: string; as_of: number }>> {
  const { rows } = await db.query<{
    bar_range_id: string;
    listing_id: string;
    source_id: string;
    interval: string;
    adjustment_basis: string;
    range_start: Date | string;
    range_end: Date | string;
    delay_class: string;
    as_of: Date | string;
  }>(
    `select bar_range_id::text as bar_range_id, listing_id::text as listing_id, source_id::text as source_id,
            interval, adjustment_basis, range_start, range_end, delay_class, as_of
       from market_bar_ranges
      where bar_range_id = any($1::uuid[])`,
    [[...new Set(barRangeIds)]],
  );
  return new Map(rows.map((row) => [row.bar_range_id, {
    identity: {
      listing_id: row.listing_id,
      source_id: row.source_id,
      interval: row.interval,
      adjustment_basis: row.adjustment_basis,
      start: new Date(row.range_start).getTime(),
      end: new Date(row.range_end).getTime(),
    },
    delay_class: row.delay_class,
    as_of: new Date(row.as_of).getTime(),
  }]));
}

async function loadListings(db: QueryExecutor, listingIds: ReadonlyArray<string>): Promise<Map<string, StoredListing>> {
  const { rows } = await db.query<{ listing_id: string } & StoredListing>(
    `select listing_id::text as listing_id, timezone, ticker from listings where listing_id = any($1::uuid[])`,
    [[...new Set(listingIds)]],
  );
  return new Map(rows.map((row) => [row.listing_id, { timezone: row.timezone, ticker: row.ticker }]));
}

// The fields the check reads, or null when the spec cannot be checked: only
// daily percent returns are drawn this way.
function sealedSeries(spec: Record<string, unknown>): SealedSeries | null {
  const { bar_range_id, listing_id, source_id, adjustment_basis, range, delay_class, as_of, bars_sha256, interval, normalization, points, window } = spec;
  if (
    points !== PERF_POINTS ||
    typeof bar_range_id !== "string" ||
    !UUID.test(bar_range_id) ||
    typeof listing_id !== "string" ||
    !UUID.test(listing_id) ||
    typeof source_id !== "string" ||
    typeof adjustment_basis !== "string" ||
    !isRecord(range) ||
    typeof range.start !== "string" ||
    typeof range.end !== "string" ||
    Number.isNaN(Date.parse(range.start)) ||
    Number.isNaN(Date.parse(range.end)) ||
    typeof delay_class !== "string" ||
    typeof as_of !== "string" ||
    Number.isNaN(Date.parse(as_of)) ||
    typeof bars_sha256 !== "string" ||
    interval !== "1d" ||
    normalization !== "pct_return"
  ) {
    return null;
  }
  const stored: StoredRange = {
    listing_id,
    source_id,
    interval,
    adjustment_basis,
    start: Date.parse(range.start),
    end: Date.parse(range.end),
  };
  const freshness = { delay_class, as_of: Date.parse(as_of) };
  if (window === undefined) return { bar_range_id, listing_id, range: stored, ...freshness, bars_sha256, window: null };
  if (
    !isRecord(window) ||
    window.kind !== "ytd" ||
    typeof window.year !== "number" ||
    typeof window.baseline_date !== "string" ||
    typeof window.end_date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(window.end_date)
  ) {
    return null;
  }
  return {
    bar_range_id,
    listing_id,
    range: stored,
    ...freshness,
    bars_sha256,
    window: { year: window.year, baseline_date: window.baseline_date, end_date: window.end_date },
  };
}
