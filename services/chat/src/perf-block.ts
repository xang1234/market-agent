// Price performance for a comparison, drawn only from sealed data: each
// company's line is its stored daily bars (market_bar_ranges / market_bars),
// normalized to percent return over one shared window. The snapshot pins every
// series (series_specs: listing, stored bar range, source), the block cites them
// (data_ref.params.series_refs), and the points travel in the block, so the
// chart shows exactly what was sealed; nothing is fetched live.
//
// Lines are drawn over the dates every company has (an IPO mid-window or a
// venue holiday would otherwise misalign them), each measured from the first
// shared close. Delayed or end-of-day prices get the pricing disclosure the
// verifier requires for their series.
//
// Lines are only comparable on one price basis (#191): Polygon's prices are
// split-adjusted only, so their returns exclude dividends, while other sources
// also adjust for dividends. The chart uses a basis every company has (split-
// adjusted first) and says which; companies on different bases get a named gap
// instead of a chart. Ranges Polygon wrote under the old dividend-adjusted label
// are never used (cache-repository.ts).
//
// A year-to-date request (#192) charts the requested window instead: from the
// final close before January 1 to the latest completed session every company
// has, the same for all (ytd-window.ts). It reads a stored range per company
// that covers the year-end, and anything short of a full window is a named
// gap, never a shorter window called YTD.
//
// ponytail: uses each listing's latest stored window and requires them to be
// identical; a shared sub-window across different stored ranges is the upgrade.
// A live YTD turn fetches and stores its window before the cutoff
// (ytd-hydration.ts); this module still reads only stored bars.

import { createHash } from "node:crypto";

import { MISLABELED_POLYGON_RANGE_SQL } from "../../market/src/cache-repository.ts";
import { selectYtdWindow, ytdReturns, ytdYear, type YtdWindow } from "../../market/src/ytd-window.ts";
import { compileDisclosurePolicy } from "../../snapshot/src/disclosure-policy.ts";
import type { SnapshotSubjectRef } from "../../snapshot/src/manifest-staging.ts";
import { stableUuid } from "./chat-ids.ts";

type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
};

const INTERVAL = "1d";
// In order of preference when every company has both.
const COMPARABLE_BASES = ["split_adjusted", "split_and_div_adjusted"] as const;
type ComparableBasis = (typeof COMPARABLE_BASES)[number];
const BASIS_WORDS: Record<ComparableBasis, string> = {
  split_adjusted: "split-adjusted only",
  split_and_div_adjusted: "split- and dividend-adjusted",
};
const NORMALIZATION = "pct_return";
// A YTD window needs a stored range that starts by Christmas Eve of the prior
// year (exchange-local), so its last December sessions are in it. Ranges are
// compared against the start of Dec 25 UTC, which is after Dec 24 begins in
// every exchange's time zone; selectYtdWindow then checks the bars themselves.
const YEAR_END_LOOKBACK = "-12-25T00:00:00.000Z";

// A price window the question asks for; absent, the latest stored window.
export type PriceWindow = "ytd";

type PerfInput = {
  listings: ReadonlyArray<{ id: string; label: string }>;
  snapshotId: string;
  asOf: string;
  window?: PriceWindow;
};

export type SealedPriceRange = {
  listing_id: string;
  label: string;
  bar_range_id: string;
  source_id: string;
  interval: string;
  adjustment_basis: string;
  delay_class: string;
  range_start: string;
  range_end: string;
  as_of: string;
  bars: ReadonlyArray<{ ts: string; close: number }>;
};

type Block = Record<string, unknown>;

// The chart plus any pricing disclosure it requires. Empty on failure: the price
// chart is optional, so an unavailable market read omits only the chart and
// never the comparison it sits next to.
export async function loadPerfComparisonBlocks(
  db: QueryExecutor,
  input: PerfInput,
): Promise<ReadonlyArray<Block>> {
  if (input.listings.length < 2) return [];
  try {
    const block = await loadSealedRanges(db, input);
    if (block === null) return [];
    return block.kind === "perf_comparison" ? [block, ...perfDisclosureBlocks(block)] : [block];
  } catch (reason) {
    console.warn("[chat] price performance unavailable; showing the comparison without it", reason);
    return [];
  }
}

// The disclosures the verifier derives from the chart's sealed series (e.g.
// end-of-day or delayed pricing), built by the same policy so they match.
export function perfDisclosureBlocks(chart: Block): ReadonlyArray<Block> {
  return compileDisclosurePolicy({
    snapshot_id: String(chart.snapshot_id),
    manifest: {
      subject_refs: chart.subject_refs as ReadonlyArray<SnapshotSubjectRef>,
      source_ids: chart.source_refs as ReadonlyArray<string>,
      series_specs: chart.provenance_series_specs as never,
      as_of: String(chart.as_of),
      basis: chart.basis as ComparableBasis,
      normalization: NORMALIZATION,
    },
  }).required_disclosure_blocks;
}

async function loadSealedRanges(
  db: QueryExecutor,
  input: PerfInput,
): Promise<Block | null> {
  // A YTD window covers the cutoff's year on the exchanges' calendars.
  const zones = input.window === "ytd" ? await listingTimeZones(db, input.listings) : new Map<string, string>();
  const zoneOf = (listingId: string) => zones.get(listingId) ?? "UTC";
  const years = new Set(input.listings.map((listing) => ytdYear(input.asOf, zoneOf(listing.id))));
  if (input.window === "ytd" && years.size > 1) {
    return ytdGapBlock(input, "the companies' exchanges are in different calendar years at the cutoff");
  }
  const year = input.window === "ytd" ? [...years][0] : undefined;
  // One statement, so the range and its bars come from one consistent view: a
  // cache refresh upserts the same bar_range_id and replaces its bars, and two
  // reads could pair old metadata with new prices.
  const { rows: ranges } = await db.query<{
    bar_range_id: string;
    listing_id: string;
    adjustment_basis: ComparableBasis;
    source_id: string;
    delay_class: string;
    range_start: Date | string;
    range_end: Date | string;
    as_of: Date | string;
    bars: Array<{ ts: string; close: number }>;
  }>(
    `with picked as (
       select distinct on (listing_id, adjustment_basis)
              bar_range_id, listing_id, adjustment_basis, source_id, delay_class, range_start, range_end, as_of
         from market_bar_ranges
        where listing_id = any($1::uuid[])
          and interval = $2
          and adjustment_basis = any($3::text[])
          and not ${MISLABELED_POLYGON_RANGE_SQL}
          -- Nothing stored after the turn's cutoff: a refresh landing mid-turn
          -- must not seal prices later than the snapshot's as_of.
          and as_of <= $4::timestamptz
          -- A YTD window: only ranges that reach back over the year-end.
          and ($5::timestamptz is null or range_start <= $5::timestamptz)
        order by listing_id, adjustment_basis, range_end desc, fetched_at desc
     )
     select picked.bar_range_id::text as bar_range_id,
            picked.listing_id::text as listing_id,
            picked.adjustment_basis,
            picked.source_id::text as source_id,
            picked.delay_class, picked.range_start, picked.range_end, picked.as_of,
            coalesce(
              (select json_agg(json_build_object('ts', bar.ts, 'close', bar.close::float8) order by bar.ts)
                 from market_bars bar
                where bar.bar_range_id = picked.bar_range_id),
              '[]'::json
            ) as bars
       from picked`,
    [
      input.listings.map((listing) => listing.id),
      INTERVAL,
      COMPARABLE_BASES,
      input.asOf,
      year === undefined ? null : `${year - 1}${YEAR_END_LOOKBACK}`,
    ],
  );
  const rangeOf = (listingId: string, basis: ComparableBasis) =>
    ranges.find((range) => range.listing_id === listingId && range.adjustment_basis === basis);
  const sealedOf = (listing: { id: string; label: string }, basis: ComparableBasis): SealedPriceRange | undefined => {
    const range = rangeOf(listing.id, basis);
    return range && {
      listing_id: listing.id,
      label: listing.label,
      bar_range_id: range.bar_range_id,
      source_id: range.source_id,
      interval: INTERVAL,
      adjustment_basis: basis,
      delay_class: range.delay_class,
      range_start: iso(range.range_start),
      range_end: iso(range.range_end),
      as_of: iso(range.as_of),
      bars: range.bars.map((bar) => ({ ts: iso(bar.ts), close: bar.close })),
    };
  };
  const hasRange = (listing: { id: string }) => ranges.some((range) => range.listing_id === listing.id);
  const shared = COMPARABLE_BASES.filter((basis) => input.listings.every((listing) => rangeOf(listing.id, basis)));
  if (year !== undefined) {
    // A company with no range reaching back over the year-end is the gap, on any basis.
    const uncovered = input.listings.find((listing) => !hasRange(listing));
    if (uncovered) return ytdGapBlock(input, `${uncovered.label} has no prices from before ${year}`);
    if (shared.length === 0) return basisGapBlock(input, ranges);
    return ytdBlock(input, shared, sealedOf, zoneOf);
  }
  // Every company or no chart: a chart quietly missing one would cover fewer
  // companies than the comparison beside it.
  if (!input.listings.every(hasRange)) return null;
  if (shared.length === 0) return basisGapBlock(input, ranges);
  for (const basis of shared) {
    const sealed = input.listings.map((listing) => sealedOf(listing, basis)!);
    const chart = buildPerfComparisonBlock({ ranges: sealed, snapshotId: input.snapshotId, asOf: input.asOf });
    if (chart) return chart;
  }
  return null;
}

// The YTD chart on the first basis every company has that gives a full window;
// otherwise the reason there is none.
function ytdBlock(
  input: PerfInput,
  shared: ReadonlyArray<ComparableBasis>,
  sealedOf: (listing: { id: string; label: string }, basis: ComparableBasis) => SealedPriceRange | undefined,
  zoneOf: (listingId: string) => string,
): Block {
  let gap = "";
  for (const basis of shared) {
    const sealed = input.listings.map((listing) => sealedOf(listing, basis)!);
    const window = selectYtdWindow(
      input.listings.map((listing, index) => ({ label: listing.label, timeZone: zoneOf(listing.id), bars: sealed[index].bars })),
      input.asOf,
    );
    if (window.ok) return buildYtdPerfBlock({ ranges: sealed, window, snapshotId: input.snapshotId });
    gap ||= window.gap;
  }
  return ytdGapBlock(input, gap);
}

function ytdGapBlock(input: PerfInput, gap: string): Block {
  return noteBlock(input, "perf_ytd_gap", `Year-to-date price performance is not shown: ${gap}.`);
}

async function listingTimeZones(
  db: QueryExecutor,
  listings: ReadonlyArray<{ id: string }>,
): Promise<Map<string, string>> {
  const { rows } = await db.query<{ listing_id: string; timezone: string }>(
    `select listing_id::text as listing_id, timezone from listings where listing_id = any($1::uuid[])`,
    [listings.map((listing) => listing.id)],
  );
  return new Map(rows.map((row) => [row.listing_id, row.timezone]));
}

// Companies whose stored prices share no basis: say so where the chart would
// be, rather than draw returns that do and don't include dividends side by side.
function basisGapBlock(
  input: PerfInput,
  ranges: ReadonlyArray<{ listing_id: string; adjustment_basis: ComparableBasis }>,
): Block {
  const bases = input.listings.map((listing) => {
    const words = COMPARABLE_BASES
      .filter((basis) => ranges.some((range) => range.listing_id === listing.id && range.adjustment_basis === basis))
      .map((basis) => BASIS_WORDS[basis]);
    return `${listing.label}'s are ${words.join(" or ")}`;
  });
  return noteBlock(
    input,
    "perf_basis_gap",
    `Price performance is not shown: the stored prices are on different bases (${bases.join("; ")}), so their returns would not be comparable.`,
  );
}

// A named gap where the chart would be.
function noteBlock(input: PerfInput, idKey: string, text: string): Block {
  const id = stableUuid(`block:${input.snapshotId}:${idKey}`);
  return {
    id,
    kind: "rich_text",
    snapshot_id: input.snapshotId,
    data_ref: { kind: "rich_text", id },
    source_refs: [],
    as_of: input.asOf,
    segments: [{ type: "text", text }],
  };
}

export function buildPerfComparisonBlock(input: {
  ranges: ReadonlyArray<SealedPriceRange>;
  snapshotId: string;
  asOf: string;
}): Block | null {
  const ranges = input.ranges;
  if (ranges.length < 2) return null;
  const [first] = ranges;
  // Lines are only comparable over the same window...
  if (ranges.some((range) => range.range_start !== first.range_start || range.range_end !== first.range_end)) {
    return null;
  }
  // ...and on the same dates: keep only dates every company has.
  const closesByDate = ranges.map((range) => new Map(range.bars.map((bar) => [bar.ts.slice(0, 10), bar.close])));
  const sharedDates = [...closesByDate[0].keys()]
    .filter((date) => closesByDate.every((closes) => closes.has(date)))
    .sort();
  if (sharedDates.length < 2 || closesByDate.some((closes) => !(closes.get(sharedDates[0])! > 0))) return null;

  return assemblePerfBlock({
    ranges,
    snapshotId: input.snapshotId,
    title: chartTitle(first.adjustment_basis, ""),
    // The window actually drawn: the shared dates, not the stored range.
    defaultRange: `${sharedDates[0]} to ${sharedDates[sharedDates.length - 1]}`,
    // The digest pins the whole stored range the line was drawn from.
    digested: ranges.map((range) => range.bars),
    points: closesByDate.map((closes) => {
      const base = closes.get(sharedDates[0])!;
      return sharedDates.map((date) => ({ x: date, y: (closes.get(date)! / base - 1) * 100 }));
    }),
  });
}

// The YTD chart for a selected window: each line from the shared baseline close,
// the window stated in the block, and each series' digest over exactly the bars
// the line uses, so a reload can show nothing else.
export function buildYtdPerfBlock(input: {
  ranges: ReadonlyArray<SealedPriceRange>;
  window: YtdWindow;
  snapshotId: string;
}): Block {
  const { window } = input;
  const skipped = window.skippedSessions > 0
    ? `; ${window.skippedSessions} session${window.skippedSessions === 1 ? "" : "s"} not every company traded skipped`
    : "";
  return assemblePerfBlock({
    ranges: input.ranges,
    snapshotId: input.snapshotId,
    title: chartTitle(input.ranges[0].adjustment_basis, ` YTD ${window.year}`),
    defaultRange: `YTD ${window.year}: ${window.baselineDate} close to ${window.endDate} close${skipped}`,
    digested: window.bars,
    points: window.bars.map((bars) => {
      const returns = ytdReturns(bars);
      return window.dates.map((date, index) => ({ x: date, y: returns[index] }));
    }),
    window: { kind: "ytd", year: window.year, baseline_date: window.baselineDate, end_date: window.endDate },
  });
}

// Split-adjusted prices give a price return: dividends are not in it.
function chartTitle(basis: string, period: string): string {
  return basis === "split_adjusted"
    ? `Price return${period} (split-adjusted, excluding dividends)`
    : `Price performance${period}`;
}

function assemblePerfBlock(input: {
  ranges: ReadonlyArray<SealedPriceRange>;
  snapshotId: string;
  title: string;
  defaultRange: string;
  // Per range: the bars its digest pins, and its line.
  digested: ReadonlyArray<ReadonlyArray<{ ts: string; close: number }>>;
  points: ReadonlyArray<ReadonlyArray<{ x: string; y: number }>>;
  window?: Record<string, unknown>;
}): Block {
  const { ranges } = input;
  const specs = ranges.map((range, index) => ({
    series_ref: stableUuid(`series:${input.snapshotId}:${range.bar_range_id}`),
    source_id: range.source_id,
    listing_id: range.listing_id,
    bar_range_id: range.bar_range_id,
    // The cache reuses bar_range_id when it refreshes a range, so the ID alone
    // does not pin these prices; the digest of the bars does.
    bars_sha256: createHash("sha256")
      .update(JSON.stringify(input.digested[index].map((bar) => [bar.ts, bar.close])))
      .digest("hex"),
    interval: range.interval,
    adjustment_basis: range.adjustment_basis,
    normalization: NORMALIZATION,
    delay_class: range.delay_class,
    range: { start: range.range_start, end: range.range_end },
    ...(input.window ? { window: input.window } : {}),
    as_of: range.as_of,
  }));
  const id = stableUuid(`block:${input.snapshotId}:perf_comparison`);
  return {
    id,
    kind: "perf_comparison",
    snapshot_id: input.snapshotId,
    data_ref: { kind: "perf_comparison", id, params: { series_refs: specs.map((spec) => spec.series_ref) } },
    source_refs: [...new Set(ranges.map((range) => range.source_id))],
    // As fresh as its oldest stored range, not the answer time: a cached range
    // may be stale, and the pricing disclosure must not overstate freshness.
    as_of: ranges.map((range) => range.as_of).sort()[0],
    title: input.title,
    subject_refs: ranges.map((range) => ({ kind: "listing", id: range.listing_id })),
    subject_labels: ranges.map((range) => range.label),
    default_range: input.defaultRange,
    basis: ranges[0].adjustment_basis,
    normalization: NORMALIZATION,
    series: ranges.map((range, index) => ({ name: range.label, unit: "%", points: input.points[index] })),
    // Promoted to manifest.series_specs when the answer is sealed.
    provenance_series_specs: specs,
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
