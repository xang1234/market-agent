// A comparison's year-to-date price performance (#192): the one figure chat
// shows outside the financial engine, source-linked but not engine-verified
// until #444 lets the engine state a price return (#398 D2). Drawn only from
// sealed bars; nothing is fetched live. A window short of the full year, or no
// longer current at the cutoff (#256), is a named gap, never a shorter window
// called YTD.
//
// Lines are only comparable on one price basis (#191): Polygon's prices are
// split-adjusted only, so their returns exclude dividends, while other sources
// also adjust for dividends. The chart uses a basis every company has (split-
// adjusted first) and says which; companies on different bases get a named gap
// instead of a chart. Ranges Polygon wrote under the old dividend-adjusted label
// are never used (cache-repository.ts).
//

import { createSqlPeerSetResolver } from "../../fundamentals/src/peer-set-resolver.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";
import { MISLABELED_POLYGON_RANGE_SQL } from "../../market/src/cache-repository.ts";
import { PERF_POINTS, perfLines, type PerfLine } from "../../market/src/perf-points.ts";
import { isCurrentEnd, sessionDate, ytdYear, type YtdWindow } from "../../market/src/ytd-window.ts";
import { compileDisclosurePolicy } from "../../snapshot/src/disclosure-policy.ts";
import type { SnapshotSubjectRef } from "../../snapshot/src/manifest-staging.ts";
import { noteBlock, stableUuid } from "./chat-ids.ts";
import type { QueryExecutor } from "../../shared/src/http.ts";

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

type PerfInput = {
  listings: ReadonlyArray<{ id: string; label: string }>;
  snapshotId: string;
  asOf: string;
  // The frozen data modes' prices (frozenDataMode): their YTD window is charted
  // whatever its age, since nothing can refresh it.
  frozenPrices?: boolean;
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

// The chart plus any pricing disclosure it requires, or the gap that stands
// where it would be. Empty on failure: an unavailable market read omits only
// the chart, never the answer it sits in.
export async function loadPerfComparisonBlocks(
  db: QueryExecutor,
  input: PerfInput,
): Promise<ReadonlyArray<Block>> {
  if (input.listings.length < 2) return [];
  try {
    const block = await loadSealedRanges(db, input);
    return block.kind === "perf_comparison" ? [block, ...perfDisclosureBlocks(block)] : [block];
  } catch (reason) {
    console.warn("[chat] price performance unavailable; answering without it", reason);
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
): Promise<Block> {
  const zones = await listingTimeZones(db, input.listings);
  const zoneOf = (listingId: string) => zones.get(listingId) ?? "UTC";
  const years = new Set(input.listings.map((listing) => ytdYear(input.asOf, zoneOf(listing.id))));
  if (years.size > 1) return ytdGapBlock(input, "the companies' exchanges are in different calendar years at the cutoff");
  const [year] = years as Set<number>;
  // One statement, so the range and its bars come from one consistent view: a
  // cache refresh upserts the same bar_range_id and replaces its bars, and two
  // reads could pair old metadata with new prices.
  const { rows: ranges } = await db.query<{
    bar_range_id: string;
    listing_id: string;
    ticker: string;
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
          -- must not seal prices later than the snapshot's as_of. The cutoff is
          -- the prices' market time, not when the cache wrote them: a late write
          -- of earlier sessions (a YTD fetch outliving its client timeout, #232)
          -- holds no prices from after the cutoff, and the seal pins exactly the
          -- bars drawn (bar_range_id + bars_sha256). Filtering on write time would
          -- compare the database's clock with the app's and let a concurrent
          -- refresh of the same range hide one this turn just fetched.
          and as_of <= $4::timestamptz
          -- Only ranges that reach back over the year-end.
          and range_start <= $5::timestamptz
        order by listing_id, adjustment_basis, range_end desc, fetched_at desc
     )
     select picked.bar_range_id::text as bar_range_id,
            picked.listing_id::text as listing_id,
            listings.ticker,
            picked.adjustment_basis,
            picked.source_id::text as source_id,
            picked.delay_class, picked.range_start, picked.range_end, picked.as_of,
            coalesce(
              (select json_agg(json_build_object('ts', bar.ts, 'close', bar.close::float8) order by bar.ts)
                 from market_bars bar
                where bar.bar_range_id = picked.bar_range_id),
              '[]'::json
            ) as bars
       from picked
       join listings on listings.listing_id = picked.listing_id`,
    [
      input.listings.map((listing) => listing.id),
      INTERVAL,
      COMPARABLE_BASES,
      input.asOf,
      `${year! - 1}${YEAR_END_LOOKBACK}`,
    ],
  );
  const rangeOf = (listingId: string, basis: ComparableBasis) =>
    ranges.find((range) => range.listing_id === listingId && range.adjustment_basis === basis);
  const sealedOf = (listing: { id: string; label: string }, basis: ComparableBasis): SealedPriceRange | undefined => {
    const range = rangeOf(listing.id, basis);
    // Labelled with the listing's stored ticker, as the seal checks (#316).
    return range && {
      listing_id: listing.id,
      label: range.ticker,
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
  const uncovered = input.listings.find((listing) => !hasRange(listing));
  if (uncovered) return ytdGapBlock(input, `${uncovered.label} has no prices from before ${year}`);
  if (shared.length === 0) return basisGapBlock(input, ranges);
  return ytdBlock(input, shared, sealedOf, zoneOf);
}

// The YTD chart on the first basis every company has that gives a full,
// current window; otherwise the reason there is none.
function ytdBlock(
  input: PerfInput,
  shared: ReadonlyArray<ComparableBasis>,
  sealedOf: (listing: { id: string; label: string }, basis: ComparableBasis) => SealedPriceRange | undefined,
  zoneOf: (listingId: string) => string,
): Block {
  let gap = "";
  for (const basis of shared) {
    const sealed = input.listings.map((listing) => sealedOf(listing, basis)!);
    const drawn = perfLines({
      kind: "ytd",
      series: input.listings.map((listing, index) => ({ label: listing.label, timeZone: zoneOf(listing.id), bars: sealed[index].bars })),
      cutoff: input.asOf,
    });
    if (!drawn.ok) {
      gap ||= drawn.gap;
      continue;
    }
    const { window } = drawn;
    const stale = input.frozenPrices
      ? undefined
      : input.listings.find((listing) => !isCurrentEnd(window.endDate, input.asOf, zoneOf(listing.id)));
    if (stale === undefined) return buildYtdPerfBlock({ ranges: sealed, window, lines: drawn.lines, snapshotId: input.snapshotId });
    gap ||= `the latest close every company has is ${window.endDate}, too old to be current at the ${sessionDate(input.asOf, zoneOf(stale.id))} cutoff`;
  }
  return ytdGapBlock(input, gap);
}

function ytdGapBlock(input: PerfInput, gap: string): Block {
  return noteBlock(input, "perf_ytd_gap", `Year-to-date price performance is not shown: ${gap}.`);
}

export async function listingTimeZones(
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

// The YTD chart for a selected window: each line from the shared baseline close,
// the window stated in the block, and each series' digest over exactly the bars
// the line uses, so a reload can show nothing else.
export function buildYtdPerfBlock(input: {
  ranges: ReadonlyArray<SealedPriceRange>;
  window: YtdWindow;
  lines: ReadonlyArray<PerfLine>;
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
    lines: input.lines,
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
  // Per range, its line.
  lines: ReadonlyArray<PerfLine>;
  window: Record<string, unknown>;
}): Block {
  const { ranges } = input;
  const specs = ranges.map((range, index) => ({
    series_ref: stableUuid(`series:${input.snapshotId}:${range.bar_range_id}`),
    source_id: range.source_id,
    listing_id: range.listing_id,
    bar_range_id: range.bar_range_id,
    bars_sha256: input.lines[index].bars_sha256,
    interval: range.interval,
    adjustment_basis: range.adjustment_basis,
    normalization: NORMALIZATION,
    points: PERF_POINTS,
    delay_class: range.delay_class,
    range: { start: range.range_start, end: range.range_end },
    window: input.window,
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
    series: ranges.map((range, index) => ({ name: range.label, unit: "%", points: input.lines[index].points })),
    // Promoted to manifest.series_specs when the answer is sealed.
    provenance_series_specs: specs,
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export type CompanyListing = { listing_id: string | null; label: string };

const PEER_LIMIT = 4;

export async function turnCompanies(
  db: QueryExecutor,
  issuers: ReadonlyArray<IssuerSubjectRef>,
  wantsPeers: boolean,
): Promise<ReadonlyArray<IssuerSubjectRef>> {
  const [primary] = issuers;
  return issuers.length === 1 && primary !== undefined && wantsPeers ? [primary, ...(await peersOf(db, primary))] : issuers;
}

async function peersOf(db: QueryExecutor, issuer: IssuerSubjectRef): Promise<ReadonlyArray<IssuerSubjectRef>> {
  try {
    return await createSqlPeerSetResolver(db).resolvePeers(issuer.id, { limit: PEER_LIMIT });
  } catch (reason) {
    console.warn("[chat] peer set unavailable; answering about the company alone", reason);
    return [];
  }
}

export async function priceListingsForTurn(
  db: QueryExecutor,
  input: {
    issuers: ReadonlyArray<IssuerSubjectRef>;
    wantsPeers: boolean;
    requestedListings?: ReadonlyMap<string, CompanyListing>;
    asOf: string;
  },
): Promise<Array<{ id: string; label: string }>> {
  const companies = await turnCompanies(db, input.issuers, input.wantsPeers);
  if (companies.length < 2) return [];
  const issuerIds = companies.map((company) => company.id);
  const active = await companyListings(db, issuerIds, input.asOf);
  return priceListingsForComparison(issuerIds, listingsForComparison(issuerIds, input.requestedListings ?? new Map(), active));
}

export function priceListingsForComparison(
  issuerIds: ReadonlyArray<string>,
  companies: ReadonlyMap<string, CompanyListing>,
): Array<{ id: string; label: string }> {
  const listings = issuerIds.flatMap((issuerId) => {
    const company = companies.get(issuerId);
    return company?.listing_id ? [{ id: company.listing_id, label: company.label }] : [];
  });
  return listings.length === issuerIds.length ? listings : [];
}

export function listingsForComparison(
  issuerIds: ReadonlyArray<string>,
  requested: ReadonlyMap<string, CompanyListing>,
  active: ReadonlyMap<string, CompanyListing>,
): Map<string, CompanyListing> {
  const out = new Map<string, CompanyListing>();
  for (const issuerId of issuerIds) {
    const listing = requested.get(issuerId) ?? active.get(issuerId);
    if (listing) out.set(issuerId, listing);
  }
  return out;
}

export async function companyListings(
  db: Pick<QueryExecutor, "query">,
  issuerIds: ReadonlyArray<string>,
  asOf: string,
): Promise<Map<string, CompanyListing>> {
  const { rows } = await db.query<{ issuer_id: string; listing_id: string | null; ticker: string | null; legal_name: string }>(
    `select i.issuer_id::text as issuer_id,
            l.listing_id::text as listing_id,
            l.ticker,
            i.legal_name
       from issuers i
       left join lateral (
         select l.listing_id, l.ticker
           from instruments ins
           join listings l on l.instrument_id = ins.instrument_id
          where ins.issuer_id = i.issuer_id
            -- Active at the turn's cutoff (the resolver's rule, lookup.ts).
            and (l.active_from is null or l.active_from <= $2::timestamptz)
            and (l.active_to is null or l.active_to > $2::timestamptz)
          order by l.ticker
          limit 1
       ) l on true
      where i.issuer_id = any($1::uuid[])`,
    [issuerIds, asOf],
  );
  return new Map(rows.map((row) => [row.issuer_id, { listing_id: row.listing_id, label: row.ticker ?? row.legal_name }]));
}
