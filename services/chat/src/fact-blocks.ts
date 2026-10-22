// Charts and tables for a chat answer, built from issuer facts with no model
// involvement: every value on screen is a reported fact, cited by id
// (value_ref), bound with the verifier's own metadata (data_ref.params.
// fact_bindings), and attributed to its source. The model only writes the
// narrative around them.
//
// Block choice is a fixed rule, not a model-driven tool loop:
// - one company: the latest quarter as a metric_row plus revenue over the last
//   8 quarters;
// - several companies (or one plus "peers"): a metrics_comparison of the latest
//   fiscal year, or the one the question names, built by analyze's
//   peer-comparison pipeline.

import { formatCompactCurrency, formatPercent } from "../../analyze/src/block-format.ts";
import { buildMetricsComparisonBlock } from "../../analyze/src/metrics-comparison-block-builder.ts";
import { materializeDerivedFacts, materializePeerMetricFacts } from "../../analyze/src/metrics-comparison-materializer.ts";
import { buildRevenueBarsBlock } from "../../analyze/src/revenue-bars-block-builder.ts";
import { loadVerifierFactsForRefs } from "../../evidence/src/local-runtime-evidence.ts";
import {
  loadRecentIssuerFundamentals,
  type IssuerFundamentalFact,
} from "../../fundamentals/src/issuer-fundamentals-reader.ts";
import { fetchPeerMetrics } from "../../fundamentals/src/peer-metrics.ts";
import { createSqlPeerSetResolver } from "../../fundamentals/src/peer-set-resolver.ts";
import { SEC_EDGAR_FILING_SOURCE_ID } from "../../fundamentals/src/provider-sources.ts";
import {
  createSecBackedStatementRepository,
  createSecBackedStatsRepository,
  SEC_DERIVATION_KIND,
} from "../../fundamentals/src/sec-facts-repository.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";
import { loadUsableFacts } from "../../fundamentals/src/usable-facts.ts";
import { returnLabel } from "../../market/src/perf-points.ts";
import type { VerifierFact } from "../../snapshot/src/snapshot-verifier.ts";
import { stableUuid } from "./chat-ids.ts";
import { readsEngine, STATEMENT_METRIC_LABELS, statementMetrics, unavailableMetrics, type ResearchScope } from "./research-scope.ts";
import { loadPerfComparisonBlocks, type PriceWindow } from "./perf-block.ts";
import { deriveQuarterMetrics, GROWTH, MARGINS, type QuarterMetric } from "./quarter-metrics.ts";

export const QUARTERS_SHOWN = 8;
const LATEST_QUARTER_METRICS = [
  ["revenue", "Revenue"],
  ["gross_profit", "Gross profit"],
  ["operating_income", "Operating income"],
  ["net_income", "Net income"],
] as const;
const METRIC_KEYS = LATEST_QUARTER_METRICS.map(([key]) => key);
const QUARTER_ORDER: Readonly<Record<string, number>> = { Q1: 1, Q2: 2, Q3: 3, Q4: 4 };

const PEER_LIMIT = 4;

type QueryExecutor = Parameters<typeof loadRecentIssuerFundamentals>[0] &
  Parameters<typeof loadVerifierFactsForRefs>[0] &
  Parameters<typeof materializePeerMetricFacts>[0] &
  Parameters<typeof createSecBackedStatementRepository>[0];
export type Block = Record<string, unknown>;
export type CitedFact = { fact_id: string; source_id: string };

// The fact blocks for a turn's companies (primary first).
export async function loadTurnFactBlocks(
  db: QueryExecutor,
  input: {
    issuers: ReadonlyArray<IssuerSubjectRef>;
    wantsPeers: boolean;
    // A single-company turn that asks about segments also gets the breakdown.
    wantsSegments?: boolean;
    // ...and one about margins, each margin across the quarters shown (#178).
    wantsMarginTrend?: boolean;
    // A single company's named fiscal quarter, shown instead of the latest (#290).
    fiscalQuarter?: FiscalQuarter;
    // A segment request reads segment facts only (#206).
    segmentsOnly?: boolean;
    snapshotId: string;
    asOf: string;
    // The listing the user asked for, per issuer (see listingsForComparison).
    requestedListings?: ReadonlyMap<string, CompanyListing>;
    // A comparison of the fiscal year the question names (requestedFiscalYear).
    fiscalYear?: number;
    // The price window the question names (requestedPriceWindow).
    priceWindow?: PriceWindow;
    // The window's cutoff when an earlier answer charted it (research-scope.ts),
    // so its baseline and end stay the ones already shown; else asOf.
    priceAsOf?: string;
    // A frozen dataset's prices, charted whatever their age (perf-block.ts).
    frozenPrices?: boolean;
  },
): Promise<ReadonlyArray<Block>> {
  const [primary] = input.issuers;
  if (primary === undefined) return [];
  const companies = await turnCompanies(db, input.issuers, input.wantsPeers);
  if (companies.length === 1 && input.segmentsOnly) {
    return loadSegmentBlocks(db, { issuer: primary, snapshotId: input.snapshotId, asOf: input.asOf });
  }
  if (companies.length === 1) {
    const blocks = await loadIssuerFactBlocks(db, {
      issuer: primary,
      snapshotId: input.snapshotId,
      asOf: input.asOf,
      wantsMarginTrend: input.wantsMarginTrend ?? false,
      ...(input.fiscalQuarter ? { quarter: input.fiscalQuarter } : {}),
    });
    if (!input.wantsSegments) return blocks;
    return Object.freeze([...blocks, ...(await loadSegmentBlocks(db, { issuer: primary, snapshotId: input.snapshotId, asOf: input.asOf }))]);
  }
  return loadComparisonFactBlocks(db, {
    companies,
    snapshotId: input.snapshotId,
    asOf: input.asOf,
    requestedListings: input.requestedListings ?? new Map(),
    fiscalYear: input.fiscalYear,
    priceWindow: input.priceWindow,
    priceAsOf: input.priceAsOf,
    frozenPrices: input.frozenPrices,
  });
}

// The companies a turn compares: the ones it names, or one plus its peers.
export async function turnCompanies(
  db: QueryExecutor,
  issuers: ReadonlyArray<IssuerSubjectRef>,
  wantsPeers: boolean,
): Promise<ReadonlyArray<IssuerSubjectRef>> {
  const [primary] = issuers;
  return issuers.length === 1 && primary !== undefined && wantsPeers ? [primary, ...(await peersOf(db, primary))] : issuers;
}

// The listings a turn's price chart covers, the same ones loadTurnFactBlocks
// charts, so their bars can be fetched before the cutoff (#232). None for a
// single company, which gets no price chart.
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

// A price window the question names: year to date ("YTD", "year-to-date").
// ponytail: YTD only; other named windows still chart the latest stored range.
export function requestedPriceWindow(question: string): PriceWindow | undefined {
  return /\b(?:ytd|year[- ]to[- ]date)\b/i.test(question) ? "ytd" : undefined;
}

// The fiscal year a question names ("fiscal 2025", "FY25", "2025 fiscal year").
// ponytail: years only; a named quarter still gets the latest fiscal year.
const FISCAL_YEAR = /\b(?:FY\s?'?|fiscal\s+(?:year\s+)?)(\d{4}|\d{2})\b|\b(\d{4})\s+fiscal\b/i;

export function requestedFiscalYear(question: string): number | undefined {
  const match = FISCAL_YEAR.exec(question);
  const year = match?.[1] ?? match?.[2];
  if (year === undefined) return undefined;
  return year.length === 2 ? 2000 + Number(year) : Number(year);
}

// A fiscal quarter a question names ("Q2 2025", "Q1 fiscal 2026", "Q4 FY26",
// "fiscal Q3 2025", "the second quarter of 2025") (#290). The quarter is each
// company's own fiscal quarter, as its facts are filed.
export type FiscalQuarter = { fiscal_year: number; fiscal_period: string };
// A comma may sit between the quarter and its year ("Q2, 2026", #292 review).
const NAMED_QUARTER = /\b(?:fiscal\s+)?Q([1-4]),?\s+(?:of\s+)?(?:fiscal\s+(?:year\s+)?|FY\s?'?)?(\d{4}|\d{2})\b/i;
const SPELLED_QUARTER = /\b(first|second|third|fourth)\s+(?:fiscal\s+)?quarter,?\s+(?:of\s+)?(?:fiscal\s+(?:year\s+)?|FY\s?)?(\d{4})\b/i;
const ORDINALS: Readonly<Record<string, number>> = { first: 1, second: 2, third: 3, fourth: 4 };
// The year first ("FY2026 Q3", "fiscal 2025 Q2", "FY26 Q1") (#292 review).
const YEAR_FIRST_QUARTER = /\b(?:FY\s?'?|fiscal\s+(?:year\s+)?)(\d{4}|\d{2})\s+Q([1-4])\b/i;

export function requestedFiscalQuarter(question: string): FiscalQuarter | undefined {
  const yearFirst = YEAR_FIRST_QUARTER.exec(question);
  if (yearFirst) {
    const year = yearFirst[1]!;
    return { fiscal_year: year.length === 2 ? 2000 + Number(year) : Number(year), fiscal_period: `Q${yearFirst[2]}` };
  }
  const named = NAMED_QUARTER.exec(question);
  const spelled = named ? null : SPELLED_QUARTER.exec(question);
  const quarter = named ? Number(named[1]) : spelled ? ORDINALS[spelled[1]!.toLowerCase()] : undefined;
  const year = named?.[2] ?? spelled?.[2];
  if (quarter === undefined || year === undefined) return undefined;
  return { fiscal_year: year.length === 2 ? 2000 + Number(year) : Number(year), fiscal_period: `Q${quarter}` };
}

async function peersOf(db: QueryExecutor, issuer: IssuerSubjectRef): Promise<ReadonlyArray<IssuerSubjectRef>> {
  try {
    return await createSqlPeerSetResolver(db).resolvePeers(issuer.id, { limit: PEER_LIMIT });
  } catch (reason) {
    console.warn("[chat] peer set unavailable; answering about the company alone", reason);
    return [];
  }
}

// Side-by-side fiscal-year metrics (revenue, margins, growth). Margins
// and growth are minted as derived facts with lineage by analyze's materializer,
// so every cell still cites a fact.
// ponytail: the materializer inserts fresh derived facts on each call (as
// analyze runs do); reuse identical ones if repeated comparisons bloat facts.
async function loadComparisonFactBlocks(
  db: QueryExecutor,
  input: {
    companies: ReadonlyArray<IssuerSubjectRef>;
    snapshotId: string;
    asOf: string;
    requestedListings: ReadonlyMap<string, CompanyListing>;
    fiscalYear?: number;
    priceWindow?: PriceWindow;
    priceAsOf?: string;
    frozenPrices?: boolean;
  },
): Promise<ReadonlyArray<Block>> {
  const issuerIds = input.companies.map((company) => company.id);
  const active = await companyListings(db, issuerIds, input.asOf).catch((reason) => {
    console.warn("[chat] company listings unavailable; comparing without tickers or prices", reason);
    return new Map<string, CompanyListing>();
  });
  const companies = listingsForComparison(issuerIds, input.requestedListings, active);
  const labelOf = (issuerId: string) => companies.get(issuerId)?.label ?? `issuer:${issuerId.slice(0, 8)}`;
  // The metrics and the price chart load independently: either can be missing
  // (no SEC-derived metrics, no cached prices) without dropping the other.
  const metrics = await loadMetricsComparisonBlocks(db, input, labelOf);
  // Price performance from sealed daily bars, with any pricing disclosure it
  // requires (perf-block.ts). Never throws.
  const performance = await loadPerfComparisonBlocks(db, {
    listings: priceListingsForComparison(issuerIds, companies),
    snapshotId: input.snapshotId,
    asOf: input.priceAsOf ?? input.asOf,
    window: input.priceWindow,
    frozenPrices: input.frozenPrices,
  });
  return Object.freeze([...metrics, ...performance]);
}

async function loadMetricsComparisonBlocks(
  db: QueryExecutor,
  input: { companies: ReadonlyArray<IssuerSubjectRef>; snapshotId: string; asOf: string; fiscalYear?: number },
  labelOf: (issuerId: string) => string,
): Promise<ReadonlyArray<Block>> {
  try {
    // As of the snapshot (#161): peer inputs known by the cutoff, and derived
    // margins/growth stamped at it, so the whole comparison is what was known then.
    const cutoff = input.asOf;
    const atCutoff = () => new Date(cutoff);
    const statements = createSecBackedStatementRepository(db, { fetcher: null, sourceId: SEC_EDGAR_FILING_SOURCE_ID, cutoff });
    const stats = createSecBackedStatsRepository(db, { statements, fetcher: null, cutoff, fiscalYear: input.fiscalYear, clock: atCutoff });
    const materialized = await materializePeerMetricFacts(
      db,
      await fetchPeerMetrics(stats, input.companies.map((company) => company.id)),
      { clock: atCutoff },
    );
    const factIds = [...new Set(materialized.flatMap((peer) => peer.metrics.map((metric) => metric.value_ref)))];
    const loadable = new Map(
      (await loadVerifierFactsForRefs(db, { fact_refs: factIds, cutoff: input.asOf, requireKnownByCutoff: true })).map((fact) => [fact.fact_id, fact]),
    );
    // Only cells the seal can load and bind render; the rest show as gaps.
    const peers = materialized.map((peer) => ({
      ...peer,
      metrics: peer.metrics.filter((metric) => loadable.has(metric.value_ref)),
    }));
    const cited = peers.flatMap((peer) => peer.metrics.map((metric) => loadable.get(metric.value_ref)!));
    if (cited.length === 0) return [];
    const labels = peers.map((peer) => labelOf(peer.subject.id));
    const block = buildMetricsComparisonBlock({
      peers,
      primary: input.companies[0],
      base: {
        id: blockId("metrics_comparison", input.snapshotId),
        snapshot_id: input.snapshotId,
        as_of: input.asOf,
        source_refs: [],
        title: comparisonTitle(
          labels,
          peers.map((peer) => peer.metrics[0] && loadable.get(peer.metrics[0].value_ref)),
          input.fiscalYear,
        ),
      },
    });
    return [
      {
        ...block,
        // Rows are shown by ticker (or name), not by reference id.
        subject_labels: labels,
        ...blockBase("metrics_comparison", input, cited.map(citedFact), loadable),
      },
    ];
  } catch (reason) {
    console.warn("[chat] metrics comparison unavailable", reason);
    return [];
  }
}

// The title names each company's fiscal year and when it ended, and how far
// apart those ends are (#180): calendars differ (NVDA's year ends in January,
// AAPL's in September), so "fiscal 2025" is not the same months for both. The
// gap is computed here from the period dates, never left to the model.
const MONTH_MS = 30.44 * 24 * 60 * 60 * 1000;

export function comparisonTitle(
  labels: ReadonlyArray<string>,
  periods: ReadonlyArray<Pick<VerifierFact, "fiscal_year" | "period_end"> | undefined>,
  fiscalYear: number | undefined,
): string {
  const parts = labels.map((label, index) => {
    const period = periods[index];
    return period?.period_end && typeof period.fiscal_year === "number"
      ? `${label} FY${period.fiscal_year} (ended ${endMonth(period.period_end)})`
      : `${label}: no ${fiscalYear === undefined ? "annual" : `FY${fiscalYear}`} figures`;
  });
  const ends = periods.flatMap((period) => period?.period_end ? [Date.parse(period.period_end)] : []);
  const months = ends.length > 1 ? Math.round((Math.max(...ends) - Math.min(...ends)) / MONTH_MS) : 0;
  const gap = months >= 2 ? `; fiscal years end ${ends.length > 2 ? "up to " : ""}${months} months apart` : "";
  return `Side by side: ${parts.join(", ")}${gap}`;
}

// "Jan 2025": the month a fiscal year ends, not the day. Every number in a
// title supports the narrative, and a day ("26") would also match unrelated
// figures; the exact date goes to the model in displayed_figures.
function endMonth(periodEnd: string): string {
  return new Date(`${periodEnd}T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

// Revenue by business segment for the latest quarter that has any (#157). Each
// segment is a `segments` row; its revenue is a fact whose subject is that
// segment, so every value cites a sealed fact. No segment facts, no block: the
// narrative then says the breakdown is not available.
async function loadSegmentBlocks(
  db: QueryExecutor,
  input: { issuer: IssuerSubjectRef; snapshotId: string; asOf: string },
): Promise<ReadonlyArray<Block>> {
  try {
    // Which facts are usable (eligibility, numeric, dated, currency, canonical,
    // known by the cutoff) is loadUsableFacts' rule (#159). What is segment-
    // specific stays here: top-level segments only (a child listed beside its
    // parent double-counts) whose definition existed at the cutoff.
    const { rows: segments } = await db.query<{ segment_id: string; name: string; definition_as_of: Date | string }>(
      `select segment_id::text as segment_id, name, definition_as_of
         from segments
        where issuer_id = $1::uuid
          and axis = 'business'
          and parent_segment_id is null
          and definition_as_of <= $2::timestamptz`,
      [input.issuer.id, input.asOf],
    );
    const segmentById = new Map(segments.map((segment) => [segment.segment_id, segment]));
    const facts = await loadUsableFacts(db, {
      subjectKind: "segment",
      subjectIds: segments.map((segment) => segment.segment_id),
      metricKeys: ["revenue"],
      periodKind: "fiscal_q",
      cutoff: input.asOf,
    });
    // One row per segment name and quarter: the latest definition known by the
    // cutoff (a redefined segment is a new version under the same name).
    const byNameAndQuarter = new Map<string, { row: SegmentRevenueRow; defined: number }>();
    for (const fact of facts) {
      const segment = segmentById.get(fact.subject_id)!;
      const key = `${segment.name}|${fact.fiscal_year}|${fact.fiscal_period}`;
      const defined = new Date(segment.definition_as_of).getTime();
      if ((byNameAndQuarter.get(key)?.defined ?? -Infinity) >= defined) continue;
      byNameAndQuarter.set(key, {
        defined,
        row: {
          fact_id: fact.fact_id,
          name: segment.name,
          value: fact.value_num! * fact.scale,
          currency: fact.currency,
          fiscal_year: fact.fiscal_year!,
          fiscal_period: fact.fiscal_period!,
          coverage_level: fact.coverage_level,
        },
      });
    }
    const rows = [...byNameAndQuarter.values()].map((entry) => entry.row);
    const breakdown = segmentRevenueItems(rows);
    if (!breakdown) return [];
    // Complete only if the segments add up to the company's reported revenue for
    // that quarter; a segment with no eligible fact would otherwise just vanish.
    if (!(await reconcilesToReportedRevenue(db, input, breakdown))) return [];
    const factIds = breakdown.items.map((item) => item.value_ref);
    const loadable = new Map(
      (await loadVerifierFactsForRefs(db, { fact_refs: factIds, cutoff: input.asOf, requireKnownByCutoff: true })).map((fact) => [fact.fact_id, fact]),
    );
    const cited = factIds.filter((id) => loadable.has(id)).map((id) => citedFact(loadable.get(id)!));
    if (cited.length !== factIds.length) return [];
    return [{
      ...blockBase("metric_row", input, cited, loadable, "segment_revenue"),
      title: `${SEGMENT_TITLE} (${breakdown.period})`,
      items: breakdown.items,
    }];
  } catch (reason) {
    console.warn("[chat] segment facts unavailable; answering without the breakdown", reason);
    return [];
  }
}

// ponytail: 0.1% covers reported segment figures rounded to millions; a
// disclosure with intersegment eliminations needs an explicit reconciling line.
const SEGMENT_RECONCILIATION_TOLERANCE = 0.001;

async function reconcilesToReportedRevenue(
  db: QueryExecutor,
  input: { issuer: IssuerSubjectRef; asOf: string },
  breakdown: { fiscal_year: number; fiscal_period: string; total: number; currency: string },
): Promise<boolean> {
  const reported = (await loadUsableFacts(db, {
    subjectKind: "issuer",
    subjectIds: [input.issuer.id],
    metricKeys: ["revenue"],
    periodKind: "fiscal_q",
    cutoff: input.asOf,
  })).find((fact) => fact.fiscal_year === breakdown.fiscal_year && fact.fiscal_period === breakdown.fiscal_period);
  if (reported === undefined) return false;
  const value = reported.value_num! * reported.scale;
  if (value <= 0) return false;
  // Same reporting currency, or the sum means nothing (loadUsableFacts already
  // requires a currency-denominated fact to state one).
  if (reported.currency !== breakdown.currency) return false;
  return Math.abs(breakdown.total - value) <= value * SEGMENT_RECONCILIATION_TOLERANCE;
}

type SegmentRevenueRow = {
  fact_id: string;
  name: string;
  value: number;
  currency: string | null;
  fiscal_year: number;
  fiscal_period: string;
  coverage_level: string;
};

// The latest quarter's segments, largest first, each item citing its fact. Null
// when any of them is not fully covered: a partial value would pass an
// incomplete breakdown off as whole, and dropping it would hide a segment.
export function segmentRevenueItems(
  rows: ReadonlyArray<SegmentRevenueRow>,
): {
  period: string;
  fiscal_year: number;
  fiscal_period: string;
  total: number;
  currency: string;
  items: Array<{ label: string; value_ref: string; format: string }>;
} | null {
  // Quarters only (own keys: "toString" is not a quarter).
  rows = rows.filter((row) => Object.hasOwn(QUARTER_ORDER, row.fiscal_period));
  const latest = [...rows].sort((a, b) =>
    (b.fiscal_year - a.fiscal_year) || ((QUARTER_ORDER[b.fiscal_period] ?? 0) - (QUARTER_ORDER[a.fiscal_period] ?? 0))
  )[0];
  if (!latest) return null;
  const quarter = rows.filter((row) => row.fiscal_year === latest.fiscal_year && row.fiscal_period === latest.fiscal_period);
  if (quarter.some((row) => row.coverage_level !== "full")) return null;
  // One known currency, or values cannot be ranked or summed (unknown is not USD).
  const currencies = new Set(quarter.map((row) => row.currency));
  if (currencies.size !== 1 || currencies.has(null)) return null;
  const items = quarter
    .sort((a, b) => b.value - a.value)
    .map((row) => ({ label: row.name, value_ref: row.fact_id, format: formatCompactCurrency(row.value, row.currency!) }));
  return {
    period: `${latest.fiscal_period} ${latest.fiscal_year}`,
    fiscal_year: latest.fiscal_year,
    fiscal_period: latest.fiscal_period,
    total: quarter.reduce((sum, row) => sum + row.value, 0),
    currency: [...currencies][0]!,
    items,
  };
}

export type CompanyListing = { listing_id: string | null; label: string };

// The listings to chart: every compared company's, or none if any has no
// listing, so the chart never covers fewer companies than the comparison.
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

// The listing to chart and label for each company: the one the user asked for
// when they named a listing (a specific share class or venue), otherwise the
// issuer's active listing (e.g. an auto-selected peer).
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

// Each company's active listing (for prices) and display label: its ticker,
// else its legal name.
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

// A derived figure cites the facts it was computed from too, so its block's sources
// include every input's filing (a margin's numerator may come from another source
// than revenue's) and the inspector can reach each one.
export function withInputs(
  cited: ReadonlyArray<CitedFact>,
  derived: ReadonlyArray<DerivedQuarterFact>,
  loadable: ReadonlyMap<string, VerifierFact>,
): CitedFact[] {
  const out = new Map(cited.map((fact) => [fact.fact_id, fact]));
  for (const id of derived.flatMap((fact) => fact.input_fact_ids)) {
    const input = loadable.get(id);
    if (input && !out.has(id)) out.set(id, citedFact(input));
  }
  return [...out.values()];
}

function citedFact(fact: VerifierFact): CitedFact {
  return { fact_id: fact.fact_id, source_id: fact.source_id ?? "" };
}

// Loads the issuer's quarterly facts through the shared eligibility rule and
// builds the blocks. Empty on failure: a chart must never cost the user the
// answer, so a failed read degrades to narrative only.
export async function loadIssuerFactBlocks(
  db: QueryExecutor,
  input: { issuer: IssuerSubjectRef | null; snapshotId: string; asOf: string; wantsMarginTrend?: boolean; quarter?: FiscalQuarter },
): Promise<ReadonlyArray<Block>> {
  if (input.issuer === null) return [];
  try {
    const facts = await loadRecentIssuerFundamentals(db, input.issuer, {
      channel: "app",
      periodKind: "fiscal_q",
      metricKeys: METRIC_KEYS,
      // Only what was known at the snapshot's moment (#159), only figures, and
      // only full quarters: an older full fact over a newer partial one (#239).
      cutoff: input.asOf,
      numericOnly: true,
      fullCoverageOnly: true,
    });
    const verifierFacts = await loadVerifierFactsForRefs(db, { fact_refs: facts.map((fact) => fact.fact_id), cutoff: input.asOf, requireKnownByCutoff: true });
    const derived = await loadDerivedQuarterMetrics(db, input.issuer, facts, verifierFacts, input.asOf, input.wantsMarginTrend ?? false, input.quarter);
    return buildIssuerFactBlocks({ facts, verifierFacts, derived, wantsMarginTrend: input.wantsMarginTrend ?? false, quarter: input.quarter, snapshotId: input.snapshotId, asOf: input.asOf });
  } catch (reason) {
    console.warn("[chat] fact blocks unavailable; answering with narrative only", reason);
    return [];
  }
}

// A derived metric minted as a fact, with the verifier's binding for it.
export type DerivedQuarterFact = QuarterMetric & { fact_id: string; binding: VerifierFact };

// A minted figure computed from two of a block's figures and carried in its
// data_ref.params.derived_figures; `of` is [current, prior].
export type DerivedFigureRecord = {
  fact_id: string;
  metric: string;
  period: string;
  period_end: string;
  value: string;
  of: readonly [string, string];
};

// Margins and growth (#178), minted as derived facts stamped at the cutoff (so
// known by it, like the comparison's) and loaded back for the seal. A failure only
// costs these figures: the reported ones still render.
async function loadDerivedQuarterMetrics(
  db: QueryExecutor,
  issuer: IssuerSubjectRef,
  facts: ReadonlyArray<IssuerFundamentalFact>,
  verifierFacts: ReadonlyArray<VerifierFact>,
  asOf: string,
  wantsMarginTrend: boolean,
  quarter?: FiscalQuarter,
): Promise<ReadonlyArray<DerivedQuarterFact>> {
  try {
    const loadable = new Map(verifierFacts.map((fact) => [fact.fact_id, fact]));
    const { byQuarter, revenue, shown } = selectQuarters(facts, loadable, quarter);
    if (shown === undefined) return [];
    const specs = deriveQuarterMetrics({
      // Only the latest quarter renders unless the margin trend was asked for, so
      // mint just what is shown: each derived fact is a lookup and maybe an insert.
      shownRevenue: wantsMarginTrend ? revenue : [shown],
      // Growth is the shown quarter's, a named one inside the window (#290).
      growthAt: shown,
      window: revenue,
      fact: (metricKey, fiscalYear, fiscalPeriod) => byQuarter.get(quarterKey(metricKey, fiscalYear, fiscalPeriod)),
      period: (factId) => loadable.get(factId),
    });
    if (specs.length === 0) return [];
    const ids = await materializeDerivedFacts(db, issuer.id, specs, { clock: () => new Date(asOf) });
    const bindings = new Map(
      (await loadVerifierFactsForRefs(db, { fact_refs: ids, cutoff: asOf, requireKnownByCutoff: true })).map((fact) => [fact.fact_id, fact]),
    );
    return specs.flatMap((spec, index) => {
      const binding = bindings.get(ids[index]!);
      return binding ? [{ ...spec, fact_id: ids[index]!, binding }] : [];
    });
  } catch (reason) {
    console.warn("[chat] margins and growth unavailable; showing reported figures only", reason);
    return [];
  }
}

// The facts the blocks may show: per metric and quarter, the first (newest) fully
// covered fact the seal can load; and QUARTERS_SHOWN quarters of revenue, oldest
// first: the latest, or, for a named quarter, the latest that contain it (#290). shown is the quarter the answer is about: the
// named one (undefined when it has no revenue fact) or the latest. A partial or sparse value would be shown, and given to the model,
// as if it covered the whole quarter, so it is left out, and margins and growth
// are only computed from full inputs (#239), as for segments.
function selectQuarters(
  facts: ReadonlyArray<IssuerFundamentalFact>,
  loadable: ReadonlyMap<string, VerifierFact>,
  quarter?: FiscalQuarter,
): { byQuarter: ReadonlyMap<string, IssuerFundamentalFact>; revenue: IssuerFundamentalFact[]; shown: IssuerFundamentalFact | undefined } {
  const byQuarter = new Map<string, IssuerFundamentalFact>();
  for (const fact of facts) {
    if (fact.value_num === null || fact.fiscal_year === null || !fact.fiscal_period) continue;
    if (!loadable.has(fact.fact_id) || fact.coverage_level !== "full") continue;
    const key = quarterKey(fact.metric_key, fact.fiscal_year, fact.fiscal_period);
    if (!byQuarter.has(key)) byQuarter.set(key, fact);
  }
  const all = [...byQuarter.values()].filter((fact) => fact.metric_key === "revenue").sort(byFiscalQuarter);
  if (quarter === undefined) {
    const revenue = all.slice(-QUARTERS_SHOWN);
    return { byQuarter, revenue, shown: revenue.at(-1) };
  }
  const at = all.findIndex((fact) => fact.fiscal_year === quarter.fiscal_year && fact.fiscal_period === quarter.fiscal_period);
  if (at === -1) return { byQuarter, revenue: [], shown: undefined };
  // The latest QUARTERS_SHOWN that still contain it, so what followed it shows too.
  const start = Math.max(0, Math.min(at, all.length - QUARTERS_SHOWN));
  return { byQuarter, revenue: all.slice(start, start + QUARTERS_SHOWN), shown: all[at] };
}

export function buildIssuerFactBlocks(input: {
  facts: ReadonlyArray<IssuerFundamentalFact>;
  verifierFacts: ReadonlyArray<VerifierFact>;
  // Margins and growth computed from these facts (#178); none, none shown.
  derived?: ReadonlyArray<DerivedQuarterFact>;
  // Per-quarter margin rows, for a question about margins.
  wantsMarginTrend?: boolean;
  // A named fiscal quarter, shown instead of the latest (#290).
  quarter?: FiscalQuarter;
  snapshotId: string;
  asOf: string;
}): ReadonlyArray<Block> {
  // Only facts the seal can load and bind may render.
  const loadable = new Map(input.verifierFacts.map((fact) => [fact.fact_id, fact]));
  const { byQuarter, revenue, shown: latest } = selectQuarters(input.facts, loadable, input.quarter);
  if (latest === undefined) return [];
  const derived = input.derived ?? [];
  for (const fact of derived) loadable.set(fact.fact_id, fact.binding);
  const derivedAt = (metric: string, at: IssuerFundamentalFact) =>
    derived.find((fact) => fact.metric === metric && fact.period.fiscal_year === at.fiscal_year && fact.period.fiscal_period === at.fiscal_period);

  const latestFacts = LATEST_QUARTER_METRICS.flatMap(([key, label]) => {
    const fact = byQuarter.get(quarterKey(key, latest.fiscal_year!, latest.fiscal_period!));
    return fact ? [{ fact, label }] : [];
  });
  // The latest quarter's margins, then its QoQ and YoY revenue growth.
  const latestDerived = [...MARGINS, ...GROWTH].flatMap(({ metric }) => {
    const fact = derivedAt(metric, latest);
    return fact ? [fact] : [];
  });
  const period = quarterLabel(latest);

  const metricRow: Block = {
    ...blockBase("metric_row", input, withInputs([...latestFacts.map(({ fact }) => fact), ...latestDerived], latestDerived, loadable), loadable),
    title: input.quarter ? `Fiscal ${period}` : `Latest quarter (${period})`,
    items: [
      ...latestFacts.map(({ fact, label }) => ({
        label,
        value_ref: fact.fact_id,
        format: formatCompactCurrency(nativeValue(fact), fact.currency ?? "USD"),
      })),
      ...latestDerived.map(percentItem),
    ],
  };

  // One row per margin across the quarters shown, so a trend (and a loss quarter)
  // is on screen to quote.
  const marginTrend: Block[] = input.wantsMarginTrend
    ? MARGINS.flatMap(({ metric, label }) => {
      const cells = revenue.flatMap((quarter) => {
        const fact = derivedAt(metric, quarter);
        return fact ? [{ ...percentItem(fact), label: quarterLabel(quarter) }] : [];
      });
      if (cells.length < 2) return [];
      const facts = derived.filter((fact) => cells.some((cell) => cell.value_ref === fact.fact_id));
      return [{
        ...blockBase("metric_row", input, withInputs(facts, facts, loadable), loadable, `margin_trend_${metric}`),
        title: `${label}${BY_QUARTER}`,
        items: cells,
      }];
    })
    : [];

  const bars = buildRevenueBarsBlock({
    facts: revenue.map((fact) => ({
      fact_id: fact.fact_id,
      fiscal_year: fact.fiscal_year,
      fiscal_period: fact.fiscal_period,
      value_num: fact.value_num!,
      scale: fact.scale,
      currency: fact.currency,
    })),
    base: {
      id: blockId("revenue_bars", input.snapshotId),
      snapshot_id: input.snapshotId,
      as_of: input.asOf,
      source_refs: [],
      title: "Quarterly revenue",
    },
  });
  // The latest quarter's QoQ is the metric row's: one figure per fact.
  const growthSeries = revenue.flatMap((quarter) => {
    const fact = quarter.fact_id === latest.fact_id ? undefined : derivedAt(GROWTH[0].metric, quarter);
    return fact ? [{ fact, quarter }] : [];
  });
  const barsBase = blockBase("revenue_bars", input, [...revenue, ...growthSeries.map(({ fact }) => fact)], loadable);
  const derivedFigures = growthSeries.map(({ fact, quarter }): DerivedFigureRecord => ({
    fact_id: fact.fact_id,
    metric: fact.label,
    period: quarterLabel(quarter),
    period_end: fact.period.period_end,
    value: formatPercent(fact.value_num),
    of: [fact.input_fact_ids[0]!, fact.input_fact_ids[1]!],
  }));
  const revenueBars: Block = derivedFigures.length === 0
    ? { ...bars, ...barsBase }
    : { ...bars, ...barsBase, data_ref: { ...barsBase.data_ref, params: { ...barsBase.data_ref.params, derived_figures: derivedFigures } } };

  return Object.freeze([metricRow, revenueBars, ...marginTrend]);
}

// A segment breakdown's title starts with this; its cells are labelled by segment.
const SEGMENT_TITLE = "Revenue by segment";

// A margin-trend row's title ends with this; its cells are labelled by quarter.
const BY_QUARTER = " by quarter";

function percentItem(fact: DerivedQuarterFact): { label: string; value_ref: string; format: string } {
  return { label: fact.label, value_ref: fact.fact_id, format: formatPercent(fact.value_num) };
}

export function blockBase(
  kind: string,
  input: { snapshotId: string; asOf: string },
  facts: ReadonlyArray<CitedFact>,
  loadable: ReadonlyMap<string, VerifierFact>,
  // Distinguishes two blocks of one kind in a snapshot (the segment metric_row).
  idKey: string = kind,
): Block & { data_ref: { kind: string; id: string; params: Record<string, unknown> } } {
  const id = blockId(idKey, input.snapshotId);
  return {
    id,
    kind,
    snapshot_id: input.snapshotId,
    data_ref: {
      kind,
      id,
      params: { fact_bindings: facts.map((fact) => bindingFor(loadable.get(fact.fact_id)!)) },
    },
    source_refs: [...new Set(facts.map((fact) => fact.source_id).filter((id) => id !== ""))],
    as_of: input.asOf,
    // Promoted to manifest.fact_refs when the answer is sealed.
    provenance_fact_refs: facts.map((fact) => fact.fact_id),
  };
}

// A reported fact derived across filings (a cash flow quarter from two years
// to date, a fourth quarter from the year less three quarters) names each
// filing in its lineage; its block cites them all, so the inspector reaches
// every filing the figure is computed from. Unchanged if the lineage cannot be
// read: the figures still cite their own filings.
export async function withDerivationSources(
  db: Pick<QueryExecutor, "query">,
  blocks: ReadonlyArray<Block>,
): Promise<ReadonlyArray<Block>> {
  const factIds = [...new Set(blocks.flatMap((block) => (block.provenance_fact_refs ?? []) as string[]))];
  if (factIds.length === 0) return blocks;
  try {
    const { rows } = await db.query<{ fact_id: string; quality_flags: unknown }>(
      `select fact_id::text as fact_id, quality_flags from facts where fact_id = any($1::uuid[])`,
      [factIds],
    );
    const sources = new Map(rows.map((row) => [row.fact_id, lineageSources(row.quality_flags)]));
    return blocks.map((block) => {
      const extra = ((block.provenance_fact_refs ?? []) as string[]).flatMap((id) => sources.get(id) ?? []);
      return extra.length === 0
        ? block
        : { ...block, source_refs: [...new Set([...((block.source_refs ?? []) as string[]), ...extra])] };
    });
  } catch (reason) {
    console.warn("[chat] derivation sources unavailable; figures cite their own filings", reason);
    return blocks;
  }
}

function lineageSources(flags: unknown): string[] {
  if (!Array.isArray(flags)) return [];
  return flags.flatMap((flag) =>
    flag !== null && typeof flag === "object" && (flag as { kind?: unknown }).kind === SEC_DERIVATION_KIND &&
      Array.isArray((flag as { input_source_ids?: unknown }).input_source_ids)
      ? ((flag as { input_source_ids: unknown[] }).input_source_ids.filter((id): id is string => typeof id === "string"))
      : []
  );
}

// The binding is the verifier's view of the fact minus its source, so it
// matches the row the seal re-loads by construction.
function bindingFor(fact: VerifierFact): Record<string, unknown> {
  const { source_id: _sourceId, ...binding } = fact;
  return binding;
}

// What a turn asked for and cannot show, each as a note (#206): a metric no
// reader serves, a segment breakdown with no segment facts, and a benchmark.
// Nothing else is shown in their place.
export function scopeGapBlocks(
  scope: ResearchScope,
  shown: ReadonlyArray<Block>,
  input: { snapshotId: string; asOf: string },
): ReadonlyArray<Block> {
  const names = scope.companies.flatMap((company) => company.label ?? []).join(", ") || "these companies";
  const notes: Array<readonly [string, string]> = unavailableMetrics(scope).map((metric) => [
    `gap:${metric.metric_key}`,
    `${metric.label} is not available for ${names} in this data, so no other figure is shown in its place.`,
  ] as const);
  // Cash flow, the balance sheet and EPS are shown for one company at a time;
  // one asked for and not shown has no facts in the data.
  const comparing = scope.companies.length > 1 || scope.peers;
  for (const metric of statementMetrics(scope)) {
    if (!comparing && showsStatementMetric(shown, metric.metric_key)) continue;
    notes.push([`gap:${metric.metric_key}`, comparing
      ? `${metric.label} is shown for one company at a time; ask about one company for it.`
      : `${metric.label} is not available for ${names} in this data, so no other figure is shown in its place.`]);
  }
  if (scope.reads === "financial_answer") {
    notes.push(["gap:financial_answer", "The previous answer's figures were calculated and verified by the financial engine; each one links to its sources in that answer, and no other figure is shown in their place."]);
  }
  if (scope.reads === "financial_gap") {
    notes.push(["gap:financial_gap", "The previous answer showed no figure, so there is no evidence to show; no other figure is shown in its place."]);
  }
  // Segments asked for now (or the segment route) and not shown: a single
  // company has none in the data; a comparison shows company totals only.
  const segmentsWanted = scope.reads === "segments" || (scope.segments && !scope.inherited.includes("segments"));
  if (segmentsWanted && !showsSegments(shown)) {
    notes.push(scope.reads === "segments"
      ? ["gap:segments", `Revenue by segment is not available for ${names} in this data.`]
      : ["gap:segments", "Revenue by segment is not shown when comparing companies; ask about one company for its breakdown."]);
  }
  // A named quarter (#290): one company's, shown or a gap; a comparison
  // compares fiscal years, so it says the quarter is not compared.
  if (scope.fiscal_quarter) {
    const quarter = `fiscal ${scope.fiscal_quarter.fiscal_period} ${scope.fiscal_quarter.fiscal_year}`;
    // A peers request counts as a comparison even when no peer was found (#292 review).
    if (scope.companies.length > 1 || scope.peers) {
      notes.push(["gap:quarter", `A single quarter is not compared across companies here; each company is shown for a fiscal year, not ${quarter}.`]);
    } else {
      if (readsNamedQuarter(scope) && !showsQuarter(shown)) {
        notes.push(["gap:quarter", `No figures for ${quarter} are on file for ${names}.`]);
      }
      // The segment and statement readers take the latest period, whatever the
      // route: each block shown beside a named quarter says so (#292 review);
      // with none shown, their own gap notes say what is missing.
      if (showsSegments(shown)) {
        notes.push(["gap:quarter-segments", `A named quarter is not read for this breakdown; the latest available period is shown, not ${quarter}.`]);
      }
      if (statementMetrics(scope).some((metric) => showsStatementMetric(shown, metric.metric_key))) {
        notes.push(["gap:quarter-statements", `A named quarter is not read for these statement figures; the latest available period is shown, not ${quarter}.`]);
      }
    }
  }
  if (scope.benchmark) {
    notes.push(["gap:benchmark", scope.companies.length > 1
      ? "A benchmark index is not in this data, so the companies are compared only with each other."
      : `A benchmark index is not in this data, so ${names} is not compared with one.`]);
  }
  return notes.map(([key, text]) => noteBlock(input, key, text));
}

export function noteBlock(input: { snapshotId: string; asOf: string }, key: string, text: string): Block {
  const id = stableUuid(`block:${input.snapshotId}:${key}`);
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

// Whether the answer model may see the turn's other facts (its packet figures, #302)
// when no figure is shown: not for a turn whose request is a named gap (only
// unavailable metrics, a financial-engine answer or gap re-read, or a segment
// breakdown with none to show), so nothing stands in for what it asked.
export function mayOfferOtherFacts(scope: ResearchScope, shown: ReadonlyArray<Block>): boolean {
  return !readsEngine(scope.reads) && !requestIsNamedGap(scope, shown);
}

// Whether what the turn asks for is not in the data, so its gap notes say what
// is missing. A financial-engine answer re-read is not: its note says where
// the figures are.
export function requestIsNamedGap(scope: ResearchScope, shown: ReadonlyArray<Block>): boolean {
  if (scope.reads === "unavailable_metric" || scope.reads === "financial_gap") return true;
  // A named quarter with no figures is a gap: no other quarter stands in (#290).
  if (readsNamedQuarter(scope) && !showsQuarter(shown)) return true;
  if (scope.reads === "statements") return !statementMetrics(scope).some((metric) => showsStatementMetric(shown, metric.metric_key));
  return scope.reads === "segments" && !showsSegments(shown);
}

// A single company's named quarter, on a route that reads the quarterly
// income figures (#290); segments and statements read their own periods.
export function readsNamedQuarter(scope: ResearchScope): boolean {
  return scope.fiscal_quarter !== null && scope.companies.length === 1 &&
    (scope.reads === "latest_quarter" || scope.reads === "trend" || scope.reads === "derived_margin" ||
      // A segment request that also asks for margins reads the income figures too (#292 review).
      (scope.reads === "segments" && scope.margins));
}

// Whether the blocks show a named fiscal quarter (buildIssuerFactBlocks).
function showsQuarter(blocks: ReadonlyArray<Block>): boolean {
  return blocks.some((block) => block.kind === "metric_row" && /^Fiscal Q[1-4] \d{4}$/.test(String(block.title)));
}

// Whether a metric_row shows any of the statement metric's items.
function showsStatementMetric(blocks: ReadonlyArray<Block>, metricKey: string): boolean {
  const labels = new Set(STATEMENT_METRIC_LABELS[metricKey] ?? []);
  return blocks.some((block) =>
    block.kind === "metric_row" &&
    ((block.items ?? []) as ReadonlyArray<{ label?: string }>).some((item) => item.label !== undefined && labels.has(item.label))
  );
}

// Whether the blocks include a segment breakdown.
export function showsSegments(blocks: ReadonlyArray<Block>): boolean {
  return blocks.some((block) => block.kind === "metric_row" && /by segment/.test(String(block.title)));
}

function blockId(kind: string, snapshotId: string): string {
  return stableUuid(`block:${snapshotId}:${kind}`);
}

function quarterKey(metricKey: string, fiscalYear: number, fiscalPeriod: string): string {
  return `${metricKey}|${fiscalYear}|${fiscalPeriod}`;
}

function quarterLabel(fact: IssuerFundamentalFact): string {
  return `${fact.fiscal_period} ${fact.fiscal_year}`;
}

function nativeValue(fact: IssuerFundamentalFact): number {
  return fact.value_num! * fact.scale;
}

function byFiscalQuarter(a: IssuerFundamentalFact, b: IssuerFundamentalFact): number {
  return (a.fiscal_year! - b.fiscal_year!) ||
    ((QUARTER_ORDER[a.fiscal_period!] ?? 0) - (QUARTER_ORDER[b.fiscal_period!] ?? 0));
}

// Each figure the fact blocks display, with what it belongs to: the company
// (comparison cells), the metric, and where it is shown. The model reads these
// to quote figures, so it knows whose value each one is.
export type DisplayedFigure = {
  company?: string;
  // A business segment's revenue: metric "Revenue", for the segment named here.
  segment?: string;
  metric: string;
  period?: string;
  period_end?: string;
  value: string;
  shown_in?: string;
  // The fact the value cites and the block showing it, for the evidence packet
  // (#207); never sent to the model.
  fact_id?: string;
  block_id?: string;
  // A price return's chart line, by its sealed series (#317); never sent to the model.
  series_ref?: string;
};

export function displayedFigures(blocks: ReadonlyArray<Block>): DisplayedFigure[] {
  return blocks.flatMap((block): DisplayedFigure[] => {
    const shownIn = {
      ...(typeof block.title === "string" ? { shown_in: block.title } : {}),
      ...(typeof block.id === "string" ? { block_id: block.id } : {}),
    };
    const cites = (ref: string | undefined) => (ref ? { fact_id: ref } : {});
    // Each value's period and end date, from the fact it cites (#180, #207).
    const bindings = ((block.data_ref as { params?: { fact_bindings?: unknown } } | undefined)?.params?.fact_bindings ?? []) as
      ReadonlyArray<Pick<VerifierFact, "fact_id" | "fiscal_year" | "fiscal_period" | "period_end" | "period_kind">>;
    const periodOf = (factId: string | undefined): { period?: string; period_end?: string } => {
      const binding = bindings.find((candidate) => candidate.fact_id === factId);
      // A balance is a point at its date; its "FY" label says nothing about which quarter.
      if (binding?.period_kind === "point" && binding.period_end) return { period: "balance at period end", period_end: binding.period_end };
      return binding?.period_end && typeof binding.fiscal_year === "number"
        ? { period: `${binding.fiscal_period ?? ""}${binding.fiscal_year}`, period_end: binding.period_end }
        : {};
    };
    // A quarter already labelled ("Q3 2026") keeps its label and gains the end date.
    const endOf = (factId: string | undefined) => {
      const { period_end } = periodOf(factId);
      return period_end ? { period_end } : {};
    };
    if (block.kind === "metrics_comparison") {
      const labels = (block.subject_labels ?? []) as ReadonlyArray<string>;
      const metrics = (block.metrics ?? []) as ReadonlyArray<string>;
      const cells = (block.cells ?? []) as ReadonlyArray<ReadonlyArray<{ value_ref?: string; format?: string } | null>>;
      return cells.flatMap((row, subjectIndex) =>
        row.flatMap((cell, metricIndex) =>
          cell?.format && labels[subjectIndex] && metrics[metricIndex]
            ? [{ company: labels[subjectIndex], metric: metrics[metricIndex], ...periodOf(cell.value_ref), value: cell.format, ...shownIn, ...cites(cell.value_ref) }]
            : []
        )
      );
    }
    if (block.kind === "metric_row") {
      const items = (block.items ?? []) as ReadonlyArray<{ label?: string; format?: string; value_ref?: string }>;
      // A margin-trend row: the metric is in the title and each cell is a quarter.
      const trendMetric = typeof block.title === "string" && block.title.endsWith(BY_QUARTER)
        ? block.title.slice(0, -BY_QUARTER.length)
        : undefined;
      // A segment breakdown: one metric (revenue) across the company's segments.
      const segments = typeof block.title === "string" && block.title.startsWith(SEGMENT_TITLE);
      return items.flatMap((item) => {
        if (!item.label || !item.format) return [];
        if (segments) return [{ segment: item.label, metric: "Revenue", ...periodOf(item.value_ref), value: item.format, ...shownIn, ...cites(item.value_ref) }];
        return [trendMetric
          ? { metric: trendMetric, period: item.label, ...endOf(item.value_ref), value: item.format, ...shownIn, ...cites(item.value_ref) }
          : { metric: item.label, ...periodOf(item.value_ref), value: item.format, ...shownIn, ...cites(item.value_ref) }];
      });
    }
    if (block.kind === "revenue_bars") {
      const bars = (block.bars ?? []) as ReadonlyArray<{ label?: string; format?: string; value_ref?: string }>;
      return bars.flatMap((bar) =>
        bar.label && bar.format
          ? [{ metric: "Revenue", period: bar.label, ...endOf(bar.value_ref), value: bar.format, ...shownIn, ...cites(bar.value_ref) }]
          : []
      );
    }
    if (block.kind === "perf_comparison") {
      // Each line's return over the window drawn (its last point), credited to
      // its company, so the answer can cite it as a figure of the chart.
      const series = (block.series ?? []) as ReadonlyArray<{ name?: string; points?: ReadonlyArray<{ y?: number }> }>;
      const seriesRefs = (block.data_ref as { params?: { series_refs?: unknown } } | undefined)?.params?.series_refs;
      const period = typeof block.default_range === "string" ? { period: block.default_range } : {};
      return series.flatMap((line, index) => {
        const last = line.points?.at(-1)?.y;
        // Line i is drawn from series_refs[i].
        const seriesRef = Array.isArray(seriesRefs) && typeof seriesRefs[index] === "string" ? { series_ref: seriesRefs[index] as string } : {};
        return line.name && typeof last === "number"
          ? [{ company: line.name, metric: "Price return", ...period, value: returnLabel(last), ...shownIn, ...seriesRef }]
          : [];
      });
    }
    return [];
  });
}
