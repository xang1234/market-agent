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
//   fiscal year, built by analyze's peer-comparison pipeline.

import { formatCompactCurrency } from "../../analyze/src/block-format.ts";
import { buildMetricsComparisonBlock } from "../../analyze/src/metrics-comparison-block-builder.ts";
import { materializePeerMetricFacts } from "../../analyze/src/metrics-comparison-materializer.ts";
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
} from "../../fundamentals/src/sec-facts-repository.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";
import type { VerifierFact } from "../../snapshot/src/snapshot-verifier.ts";
import { stableUuid } from "./chat-ids.ts";
import { loadPerfComparisonBlocks } from "./perf-block.ts";

const QUARTERS_SHOWN = 8;
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
type Block = Record<string, unknown>;
type CitedFact = { fact_id: string; source_id: string };

// The fact blocks for a turn's companies (primary first).
export async function loadTurnFactBlocks(
  db: QueryExecutor,
  input: {
    issuers: ReadonlyArray<IssuerSubjectRef>;
    wantsPeers: boolean;
    // A single-company turn that asks about segments also gets the breakdown.
    wantsSegments?: boolean;
    snapshotId: string;
    asOf: string;
    // The listing the user asked for, per issuer (see listingsForComparison).
    requestedListings?: ReadonlyMap<string, CompanyListing>;
  },
): Promise<ReadonlyArray<Block>> {
  const [primary] = input.issuers;
  if (primary === undefined) return [];
  const companies = input.issuers.length === 1 && input.wantsPeers
    ? [primary, ...(await peersOf(db, primary))]
    : input.issuers;
  if (companies.length === 1) {
    const blocks = await loadIssuerFactBlocks(db, { issuer: primary, snapshotId: input.snapshotId, asOf: input.asOf });
    if (!input.wantsSegments) return blocks;
    return Object.freeze([...blocks, ...(await loadSegmentBlocks(db, { issuer: primary, snapshotId: input.snapshotId, asOf: input.asOf }))]);
  }
  return loadComparisonFactBlocks(db, {
    companies,
    snapshotId: input.snapshotId,
    asOf: input.asOf,
    requestedListings: input.requestedListings ?? new Map(),
  });
}

async function peersOf(db: QueryExecutor, issuer: IssuerSubjectRef): Promise<ReadonlyArray<IssuerSubjectRef>> {
  try {
    return await createSqlPeerSetResolver(db).resolvePeers(issuer.id, { limit: PEER_LIMIT });
  } catch (reason) {
    console.warn("[chat] peer set unavailable; answering about the company alone", reason);
    return [];
  }
}

// Side-by-side latest-fiscal-year metrics (revenue, margins, growth). Margins
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
    asOf: input.asOf,
  });
  return Object.freeze([...metrics, ...performance]);
}

async function loadMetricsComparisonBlocks(
  db: QueryExecutor,
  input: { companies: ReadonlyArray<IssuerSubjectRef>; snapshotId: string; asOf: string },
  labelOf: (issuerId: string) => string,
): Promise<ReadonlyArray<Block>> {
  try {
    const statements = createSecBackedStatementRepository(db, { fetcher: null, sourceId: SEC_EDGAR_FILING_SOURCE_ID });
    const stats = createSecBackedStatsRepository(db, { statements, fetcher: null });
    const materialized = await materializePeerMetricFacts(
      db,
      await fetchPeerMetrics(stats, input.companies.map((company) => company.id)),
    );
    const factIds = [...new Set(materialized.flatMap((peer) => peer.metrics.map((metric) => metric.value_ref)))];
    const loadable = new Map(
      (await loadVerifierFactsForRefs(db, { fact_refs: factIds })).map((fact) => [fact.fact_id, fact]),
    );
    // Only cells the seal can load and bind render; the rest show as gaps.
    const peers = materialized.map((peer) => ({
      ...peer,
      metrics: peer.metrics.filter((metric) => loadable.has(metric.value_ref)),
    }));
    const cited = peers.flatMap((peer) => peer.metrics.map((metric) => loadable.get(metric.value_ref)!));
    if (cited.length === 0) return [];
    const block = buildMetricsComparisonBlock({
      peers,
      primary: input.companies[0],
      base: {
        id: blockId("metrics_comparison", input.snapshotId),
        snapshot_id: input.snapshotId,
        as_of: input.asOf,
        source_refs: [],
        title: "Side by side (latest fiscal year)",
      },
    });
    return [
      {
        ...block,
        // Rows are shown by ticker (or name), not by reference id.
        subject_labels: block.subjects.map((subject) => labelOf(subject.id)),
        ...blockBase("metrics_comparison", input, cited.map(citedFact), loadable),
      },
    ];
  } catch (reason) {
    console.warn("[chat] metrics comparison unavailable", reason);
    return [];
  }
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
    const { rows } = await db.query<SegmentRevenueRow>(
      `select f.fact_id::text as fact_id,
              s.name,
              (f.value_num * f.scale)::float8 as value,
              f.currency,
              f.fiscal_year,
              f.fiscal_period
         from segments s
         join facts f on f.subject_kind = 'segment' and f.subject_id = s.segment_id
         join metrics m on m.metric_id = f.metric_id
        where s.issuer_id = $1::uuid
          and s.axis = 'business'
          and m.metric_key = 'revenue'
          and f.period_kind = 'fiscal_q'
          and f.superseded_by is null
          and f.invalidated_at is null`,
      [input.issuer.id],
    );
    const breakdown = segmentRevenueItems(rows);
    if (!breakdown) return [];
    const factIds = breakdown.items.map((item) => item.value_ref);
    const loadable = new Map(
      (await loadVerifierFactsForRefs(db, { fact_refs: factIds })).map((fact) => [fact.fact_id, fact]),
    );
    const cited = factIds.filter((id) => loadable.has(id)).map((id) => citedFact(loadable.get(id)!));
    if (cited.length !== factIds.length) return [];
    return [{
      ...blockBase("metric_row", input, cited, loadable, "segment_revenue"),
      title: `Revenue by segment (${breakdown.period})`,
      items: breakdown.items,
    }];
  } catch (reason) {
    console.warn("[chat] segment facts unavailable; answering without the breakdown", reason);
    return [];
  }
}

type SegmentRevenueRow = {
  fact_id: string;
  name: string;
  value: number;
  currency: string | null;
  fiscal_year: number;
  fiscal_period: string;
};

// The latest quarter's segments, largest first, each item citing its fact.
export function segmentRevenueItems(
  rows: ReadonlyArray<SegmentRevenueRow>,
): { period: string; items: Array<{ label: string; value_ref: string; format: string }> } | null {
  const latest = [...rows].sort((a, b) =>
    (b.fiscal_year - a.fiscal_year) || ((QUARTER_ORDER[b.fiscal_period] ?? 0) - (QUARTER_ORDER[a.fiscal_period] ?? 0))
  )[0];
  if (!latest) return null;
  const items = rows
    .filter((row) => row.fiscal_year === latest.fiscal_year && row.fiscal_period === latest.fiscal_period)
    .sort((a, b) => b.value - a.value)
    .map((row) => ({ label: row.name, value_ref: row.fact_id, format: formatCompactCurrency(row.value, row.currency ?? "USD") }));
  return { period: `${latest.fiscal_period} ${latest.fiscal_year}`, items };
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

function citedFact(fact: VerifierFact): CitedFact {
  return { fact_id: fact.fact_id, source_id: fact.source_id ?? "" };
}

// Loads the issuer's quarterly facts through the shared eligibility rule and
// builds the blocks. Empty on failure: a chart must never cost the user the
// answer, so a failed read degrades to narrative only.
export async function loadIssuerFactBlocks(
  db: QueryExecutor,
  input: { issuer: IssuerSubjectRef | null; snapshotId: string; asOf: string },
): Promise<ReadonlyArray<Block>> {
  if (input.issuer === null) return [];
  try {
    const facts = await loadRecentIssuerFundamentals(db, input.issuer, {
      channel: "app",
      periodKind: "fiscal_q",
      metricKeys: METRIC_KEYS,
    });
    const verifierFacts = await loadVerifierFactsForRefs(db, { fact_refs: facts.map((fact) => fact.fact_id) });
    return buildIssuerFactBlocks({ facts, verifierFacts, snapshotId: input.snapshotId, asOf: input.asOf });
  } catch (reason) {
    console.warn("[chat] fact blocks unavailable; answering with narrative only", reason);
    return [];
  }
}

export function buildIssuerFactBlocks(input: {
  facts: ReadonlyArray<IssuerFundamentalFact>;
  verifierFacts: ReadonlyArray<VerifierFact>;
  snapshotId: string;
  asOf: string;
}): ReadonlyArray<Block> {
  // Only facts the seal can load and bind may render.
  const loadable = new Map(input.verifierFacts.map((fact) => [fact.fact_id, fact]));
  // The reader returns newest first, so the first fact per metric and quarter wins.
  const byQuarter = new Map<string, IssuerFundamentalFact>();
  for (const fact of input.facts) {
    if (fact.value_num === null || fact.fiscal_year === null || !fact.fiscal_period) continue;
    if (!loadable.has(fact.fact_id)) continue;
    const key = quarterKey(fact.metric_key, fact.fiscal_year, fact.fiscal_period);
    if (!byQuarter.has(key)) byQuarter.set(key, fact);
  }

  const revenue = [...byQuarter.values()]
    .filter((fact) => fact.metric_key === "revenue")
    .sort(byFiscalQuarter)
    .slice(-QUARTERS_SHOWN);
  const latest = revenue.at(-1);
  if (latest === undefined) return [];

  const latestFacts = LATEST_QUARTER_METRICS.flatMap(([key, label]) => {
    const fact = byQuarter.get(quarterKey(key, latest.fiscal_year!, latest.fiscal_period!));
    return fact ? [{ fact, label }] : [];
  });
  const period = quarterLabel(latest);

  const metricRow: Block = {
    ...blockBase("metric_row", input, latestFacts.map(({ fact }) => fact), loadable),
    title: `Latest quarter (${period})`,
    items: latestFacts.map(({ fact, label }) => ({
      label,
      value_ref: fact.fact_id,
      format: formatCompactCurrency(nativeValue(fact), fact.currency ?? "USD"),
    })),
  };

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
  const revenueBars: Block = { ...bars, ...blockBase("revenue_bars", input, revenue, loadable) };

  return Object.freeze([metricRow, revenueBars]);
}

function blockBase(
  kind: string,
  input: { snapshotId: string; asOf: string },
  facts: ReadonlyArray<CitedFact>,
  loadable: ReadonlyMap<string, VerifierFact>,
  // Distinguishes two blocks of one kind in a snapshot (the segment metric_row).
  idKey: string = kind,
): Block {
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

// The binding is the verifier's view of the fact minus its source, so it
// matches the row the seal re-loads by construction.
function bindingFor(fact: VerifierFact): Record<string, unknown> {
  const { source_id: _sourceId, ...binding } = fact;
  return binding;
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
export type DisplayedFigure = { company?: string; metric: string; period?: string; value: string; shown_in?: string };

export function displayedFigures(blocks: ReadonlyArray<Block>): DisplayedFigure[] {
  return blocks.flatMap((block): DisplayedFigure[] => {
    const shownIn = typeof block.title === "string" ? { shown_in: block.title } : {};
    if (block.kind === "metrics_comparison") {
      const labels = (block.subject_labels ?? []) as ReadonlyArray<string>;
      const metrics = (block.metrics ?? []) as ReadonlyArray<string>;
      const cells = (block.cells ?? []) as ReadonlyArray<ReadonlyArray<{ format?: string } | null>>;
      return cells.flatMap((row, subjectIndex) =>
        row.flatMap((cell, metricIndex) =>
          cell?.format && labels[subjectIndex] && metrics[metricIndex]
            ? [{ company: labels[subjectIndex], metric: metrics[metricIndex], value: cell.format, ...shownIn }]
            : []
        )
      );
    }
    if (block.kind === "metric_row") {
      const items = (block.items ?? []) as ReadonlyArray<{ label?: string; format?: string }>;
      return items.flatMap((item) => item.label && item.format ? [{ metric: item.label, value: item.format, ...shownIn }] : []);
    }
    if (block.kind === "revenue_bars") {
      const bars = (block.bars ?? []) as ReadonlyArray<{ label?: string; format?: string }>;
      return bars.flatMap((bar) => bar.label && bar.format ? [{ metric: "Revenue", period: bar.label, value: bar.format }] : []);
    }
    return [];
  });
}

// The human-readable text of fact blocks (titles, labels, formatted values):
// what the user sees, and so what the narrative may quote without naming a
// company. Comparison cells are left out: each belongs to one company, and the
// guard checks those through displayedFigures instead.
export function displayTextsForBlocks(blocks: ReadonlyArray<Block>): string[] {
  const texts: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (DISPLAY_KEYS.has(key) && typeof child === "string") texts.push(child);
        else if (key !== "data_ref") visit(child);
      }
    }
  };
  blocks.forEach((block) => visit(block.kind === "metrics_comparison" ? { ...block, cells: undefined } : block));
  return texts;
}

const DISPLAY_KEYS = new Set(["title", "label", "format", "default_range"]);
