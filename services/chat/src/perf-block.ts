// A comparison's year-to-date price performance (#192): the one figure chat
// shows outside the financial engine, source-linked but not engine-verified
// until #444 lets the engine state a price return (#398 D2). Drawn only from
// sealed bars; nothing is fetched live. A window short of the full year, or no
// longer current at the cutoff (#256), is a named gap, never a shorter window
// called YTD. The analyst agent's price tool draws a week or month to date the
// same way, for one company or several (#678).
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
import { closeLabel, PERF_POINTS, perfLines, returnLabel, type PerfLine } from "../../market/src/perf-points.ts";
import { isCurrentEnd, PERIOD_WORDS, periodStart, sessionDate, type PricePeriod, type YtdWindow } from "../../market/src/ytd-window.ts";
import { compileDisclosurePolicy } from "../../snapshot/src/disclosure-policy.ts";
import type { SnapshotSubjectRef } from "../../snapshot/src/manifest-staging.ts";
import { noteBlock, stableUuid } from "./chat-ids.ts";
import type { PacketFigure } from "./evidence-packet.ts";
import { structuredRefsFromHandoff } from "./local-runtime-structured.ts";
import type { ChatResolvedSubjectPreResolution } from "./subjects.ts";
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
// A window needs a stored range that starts by the eighth day before its start
// (exchange-local), so the close before it is in it. Ranges are compared
// against the start of the seventh day before, UTC, which is after the eighth
// begins in every exchange's time zone; selectWindow then checks the bars
// themselves. For YTD that is Dec 25 UTC.
const LOOKBACK_DAYS = 7;
// A week or month to date that stops more than three days before the last
// completed session is not to date: a weekend and a holiday fit in three.
// ponytail: stands in for an exchange calendar, as ytd-window.ts's week does.
const SHORT_PERIOD_CURRENT_DAYS = 3;

type PerfInput = {
  listings: ReadonlyArray<{ id: string; label: string }>;
  snapshotId: string;
  asOf: string;
  // The frozen data modes' prices (frozenDataMode): their YTD window is charted
  // whatever its age, since nothing can refresh it.
  frozenPrices?: boolean;
  // YTD unless given (#678).
  period?: PricePeriod;
  // Tells apart the ids of two charts in one snapshot (#678).
  scope?: string;
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
  currency: string;
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
    const block = await loadPricePerformance(db, input);
    return block.kind === "perf_comparison" ? [block, ...perfDisclosureBlocks(block)] : [block];
  } catch (reason) {
    console.warn("[chat] price performance unavailable; answering without it", reason);
    return [];
  }
}

// The disclosures the verifier derives from the charts' sealed series (e.g.
// end-of-day or delayed pricing), built by the same policy so they match. One
// block covers every chart of a snapshot, as its id is the policy's own.
export function perfDisclosureBlocks(...charts: ReadonlyArray<Block>): ReadonlyArray<Block> {
  const [first] = charts;
  if (first === undefined) return [];
  return compileDisclosurePolicy({
    snapshot_id: String(first.snapshot_id),
    manifest: {
      subject_refs: charts.flatMap((chart) => chart.subject_refs as ReadonlyArray<SnapshotSubjectRef>),
      source_ids: [...new Set(charts.flatMap((chart) => chart.source_refs as ReadonlyArray<string>))],
      series_specs: charts.flatMap((chart) => chart.provenance_series_specs as ReadonlyArray<never>),
      as_of: charts.map((chart) => String(chart.as_of)).sort()[0]!,
      basis: first.basis as ComparableBasis,
      normalization: NORMALIZATION,
    },
  }).required_disclosure_blocks;
}

// The figures a price chart shows, one return and one close per line, each a
// series chip the seal checks against the line (#678). The period reads its
// dates in full, as a week's would read as one month by month and year.
export function priceFigures(chart: Block, period: PricePeriod): Array<Omit<PacketFigure, "id">> {
  const lines = chart.series as ReadonlyArray<{ name: string; points: ReadonlyArray<{ y: number }> }>;
  const specs = chart.provenance_series_specs as ReadonlyArray<{ series_ref: string; end_close: number; currency: string; window: { baseline_date: string; end_date: string } }>;
  const sources = chart.source_refs as ReadonlyArray<string>;
  return lines.flatMap((line, index) => {
    const spec = specs[index]!;
    const { baseline_date, end_date } = spec.window;
    return [
      { company: line.name, metric: "Price return", period: `${PERIOD_WORDS[period].phrase}, from the ${dayText(baseline_date)} close to the ${dayText(end_date)} close`, value: returnLabel(line.points.at(-1)!.y), quantity: { kind: "fraction", value: line.points.at(-1)!.y / 100 }, series_ref: spec.series_ref, source_ids: sources },
      { company: line.name, metric: "Last close", period: `the ${dayText(end_date)} session`, value: closeLabel(spec.end_close, spec.currency), quantity: { kind: "amount", value: spec.end_close }, series_ref: spec.series_ref, source_ids: sources },
    ];
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayText = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`;

// For companies the user named by listing, that listing (and its ticker),
// keyed by lowercase issuer id.
export function requestedListingsOf(
  subjects: ReadonlyArray<ChatResolvedSubjectPreResolution>,
): Map<string, { listing_id: string; label: string }> {
  const out = new Map<string, { listing_id: string; label: string }>();
  for (const subject of subjects) {
    // A handoff the resolver did not hydrate names no listing.
    if (subject.subject_ref.kind !== "listing" || subject.handoff?.context === undefined) continue;
    const refs = structuredRefsFromHandoff(subject.handoff);
    const listing = refs.listings.find((candidate) => candidate.ref.id === subject.subject_ref.id);
    const issuer = refs.issuer?.id.toLowerCase();
    if (issuer === undefined || listing === undefined || out.has(issuer)) continue;
    out.set(issuer, { listing_id: listing.ref.id, label: listing.ticker ?? subject.display_label });
  }
  return out;
}

// The price return over a period to date (YTD unless given) of one company or
// several: the chart, or the note that stands in its place. The analyst agent
// reads it alone (#678), its disclosures compiled once over every chart of the
// answer (perfDisclosureBlocks). A failed read rejects.
export async function loadPricePerformance(
  db: QueryExecutor,
  input: PerfInput,
): Promise<Block> {
  const zones = await listingTimeZones(db, input.listings);
  const zoneOf = (listingId: string) => zones.get(listingId) ?? "UTC";
  const period = input.period ?? "ytd";
  const starts = new Set(input.listings.map((listing) => periodStart(period, input.asOf, zoneOf(listing.id))));
  if (starts.size > 1) {
    return gapBlock(input, `the companies' exchanges are in different ${period === "ytd" ? "calendar years" : `${period}s`} at the cutoff`);
  }
  const [start] = starts as Set<string>;
  const since = period === "ytd" ? start!.slice(0, 4) : start!;
  // One statement, so the range and its bars come from one consistent view: a
  // cache refresh upserts the same bar_range_id and replaces its bars, and two
  // reads could pair old metadata with new prices.
  const lookback = new Date(Date.parse(`${start}T00:00:00.000Z`) - LOOKBACK_DAYS * 86_400_000).toISOString();
  const { rows: stored } = await db.query<{
    bar_range_id: string;
    listing_id: string;
    ticker: string;
    adjustment_basis: ComparableBasis;
    source_id: string;
    delay_class: string;
    range_start: Date | string;
    range_end: Date | string;
    as_of: Date | string;
    currency: string;
    bars: Array<{ ts: string; close: number }>;
  }>(
    `with picked as (
       select distinct on (listing_id, adjustment_basis)
              bar_range_id, listing_id, adjustment_basis, source_id, delay_class, range_start, range_end, as_of, currency
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
        -- A range that reaches back over the close before the window first;
        -- one that does not only says the listing has prices on file.
        order by listing_id, adjustment_basis, range_start <= $5::timestamptz desc, range_end desc, fetched_at desc
     )
     select picked.bar_range_id::text as bar_range_id,
            picked.listing_id::text as listing_id,
            listings.ticker,
            picked.adjustment_basis,
            picked.source_id::text as source_id,
            picked.delay_class, picked.range_start, picked.range_end, picked.as_of, picked.currency,
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
      lookback,
    ],
  );
  const ranges = stored.filter((range) => Date.parse(iso(range.range_start)) <= Date.parse(lookback));
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
      currency: range.currency,
      bars: range.bars.map((bar) => ({ ts: iso(bar.ts), close: bar.close })),
    };
  };
  const priced = (listing: { id: string }, among: typeof stored) => among.some((range) => range.listing_id === listing.id && range.bars.length > 0);
  const shared = COMPARABLE_BASES.filter((basis) => input.listings.every((listing) => rangeOf(listing.id, basis)));
  // No range stored, or one the provider answered with no bars (#678).
  const unpriced = input.listings.find((listing) => !priced(listing, stored));
  if (unpriced) return gapBlock(input, `${unpriced.label} has no daily prices on file`);
  const uncovered = input.listings.find((listing) => !priced(listing, ranges));
  if (uncovered) return gapBlock(input, `${uncovered.label} has no prices from before ${since}`);
  if (shared.length === 0) return basisGapBlock(input, ranges);
  return windowBlock(input, start!, shared, sealedOf, zoneOf);
}

// The chart on the first basis every company has that gives a full, current
// window from `start`; otherwise the reason there is none.
function windowBlock(
  input: PerfInput,
  start: string,
  shared: ReadonlyArray<ComparableBasis>,
  sealedOf: (listing: { id: string; label: string }, basis: ComparableBasis) => SealedPriceRange | undefined,
  zoneOf: (listingId: string) => string,
): Block {
  const period = input.period ?? "ytd";
  let gap = "";
  for (const basis of shared) {
    const sealed = input.listings.map((listing) => sealedOf(listing, basis)!);
    const drawn = perfLines({
      kind: "window",
      start,
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
      : input.listings.find((listing) => !isCurrentEnd(window.endDate, input.asOf, zoneOf(listing.id), period === "ytd" ? undefined : SHORT_PERIOD_CURRENT_DAYS));
    if (stale === undefined) {
      return buildWindowPerfBlock({ ranges: sealed, window, lines: drawn.lines, snapshotId: input.snapshotId, period, scope: input.scope ?? "" });
    }
    gap ||= `the latest close every company has is ${window.endDate}, too old to be current at the ${sessionDate(input.asOf, zoneOf(stale.id))} cutoff`;
  }
  return gapBlock(input, gap);
}

function gapBlock(input: PerfInput, gap: string): Block {
  const period = input.period ?? "ytd";
  return noteBlock(input, `${input.scope ?? ""}perf_${period}_gap`, `${PERIOD_WORDS[period].gap} price performance is not shown: ${gap}.`);
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
    `${input.scope ?? ""}perf_basis_gap`,
    `Price performance is not shown: the stored prices are on different bases (${bases.join("; ")}), so their returns would not be comparable.`,
  );
}

// The chart for a selected window: each line from the shared baseline close,
// the window stated in the block, each series' digest over exactly the bars
// the line uses, and the close it ends on, so a reload can show nothing else.
function buildWindowPerfBlock(input: {
  ranges: ReadonlyArray<SealedPriceRange>;
  window: YtdWindow;
  lines: ReadonlyArray<PerfLine>;
  snapshotId: string;
  period: PricePeriod;
  scope: string;
}): Block {
  const { window, period } = input;
  const skipped = window.skippedSessions > 0
    ? `; ${window.skippedSessions} session${window.skippedSessions === 1 ? "" : "s"} not every company traded skipped`
    : "";
  const named = period === "ytd" ? `YTD ${window.year}` : PERIOD_WORDS[period].range;
  return assemblePerfBlock({
    ranges: input.ranges,
    snapshotId: input.snapshotId,
    scope: input.scope,
    title: chartTitle(input.ranges[0].adjustment_basis, period === "ytd" ? ` YTD ${window.year}` : `, ${PERIOD_WORDS[period].range.toLowerCase()}`),
    defaultRange: `${named}: ${window.baselineDate} close to ${window.endDate} close${skipped}`,
    lines: input.lines,
    closes: window.bars.map((bars) => bars.at(-1)!.close),
    window: period === "ytd"
      ? { kind: "ytd", year: window.year, baseline_date: window.baselineDate, end_date: window.endDate }
      : { kind: "window", period, start: window.start, baseline_date: window.baselineDate, end_date: window.endDate },
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
  scope: string;
  title: string;
  defaultRange: string;
  // Per range, its line and the close it ends on.
  lines: ReadonlyArray<PerfLine>;
  closes: ReadonlyArray<number>;
  window: Record<string, unknown>;
}): Block {
  const { ranges } = input;
  const specs = ranges.map((range, index) => ({
    series_ref: stableUuid(`series:${input.snapshotId}:${input.scope}${range.bar_range_id}`),
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
    end_close: input.closes[index],
    currency: range.currency,
  }));
  const id = stableUuid(`block:${input.snapshotId}:${input.scope}perf_comparison`);
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
    const listing = requested.get(issuerId.toLowerCase()) ?? active.get(issuerId);
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
    `select r.id::text as issuer_id,
            l.listing_id::text as listing_id,
            l.ticker,
            i.legal_name
       from unnest($1::uuid[]) as r(id)
       join issuers i on i.issuer_id = current_issuer_id(r.id)
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
       ) l on true`,
    [issuerIds, asOf],
  );
  return new Map(rows.map((row) => [row.issuer_id, { listing_id: row.listing_id, label: row.ticker ?? row.legal_name }]));
}
