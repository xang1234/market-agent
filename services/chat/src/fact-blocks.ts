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
  input: { issuers: ReadonlyArray<IssuerSubjectRef>; wantsPeers: boolean; snapshotId: string; asOf: string },
): Promise<ReadonlyArray<Block>> {
  const [primary] = input.issuers;
  if (primary === undefined) return [];
  const companies = input.issuers.length === 1 && input.wantsPeers
    ? [primary, ...(await peersOf(db, primary))]
    : input.issuers;
  if (companies.length === 1) return loadIssuerFactBlocks(db, { issuer: primary, snapshotId: input.snapshotId, asOf: input.asOf });
  return loadComparisonFactBlocks(db, { companies, snapshotId: input.snapshotId, asOf: input.asOf });
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
  input: { companies: ReadonlyArray<IssuerSubjectRef>; snapshotId: string; asOf: string },
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
    return Object.freeze([{
      ...block,
      ...blockBase("metrics_comparison", input, cited.map(citedFact), loadable),
    }]);
  } catch (reason) {
    console.warn("[chat] comparison unavailable; answering with narrative only", reason);
    return [];
  }
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
): Block {
  const id = blockId(kind, input.snapshotId);
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

// The human-readable text of fact blocks (titles, labels, formatted values):
// what the user sees, and so what the narrative may quote.
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
  blocks.forEach(visit);
  return texts;
}

const DISPLAY_KEYS = new Set(["title", "label", "format"]);
