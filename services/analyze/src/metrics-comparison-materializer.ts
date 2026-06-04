// Turns the peer-comparison metric values (from the fundamentals fetcher) into
// the fact references a metrics_comparison block's cells point at.
//
// Two cases, per the emitter design:
//   - A metric that IS already a stored fact (revenue, a reported statement
//     line) reuses that fact — the cell points straight at it, no duplicate.
//   - A computed metric (margins, growth, P/E) gets a fresh method='derived'
//     fact via the canonical createFact path, with lineage to its input facts
//     recorded in quality_flags (no schema migration — see the emitter design
//     doc, fra-36y8 spike).
//
// Output is the per-(subject, metric) value_ref the block builder (fra-ipv4)
// needs, plus the value/format it carries through for tone + display.

import { createFact, type FactInput } from "../../evidence/src/fact-repo.ts";
import { resolveMetricIds } from "../../evidence/src/metric-repo.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";
import type {
  DerivedPeerMetric,
  PeerMetricFormat,
  PeerMetricKey,
  PeerMetricValue,
  PeerMetrics,
} from "../../fundamentals/src/peer-metrics.ts";
import type { IssuerSubjectRef, UUID } from "../../fundamentals/src/subject-ref.ts";

export type MaterializedMetric = {
  metric: PeerMetricKey;
  // The fact this cell's value_ref points at — an existing fact (reuse) or a
  // freshly minted derived fact.
  value_ref: UUID;
  value_num: number;
  format: PeerMetricFormat;
  // Reporting currency for currency-format metrics (fra-q840); undefined for
  // dimensionless ratios.
  currency?: string;
};

export type MaterializedPeer = {
  subject: IssuerSubjectRef;
  metrics: ReadonlyArray<MaterializedMetric>;
};

export type MaterializeOptions = {
  // Computation time stamped as the derived fact's observed_at. Injected for
  // deterministic tests.
  clock?: () => Date;
};

// Derived facts are deterministic computations over authoritative, filing-time
// fundamentals — so they inherit that standing rather than re-entering review.
// (P/E blends a market price; it is unavailable in v1, so filing_time holds for
// every metric that actually materializes today — revisit when price-backed
// P/E lands.)
const DERIVED_VERIFICATION_STATUS = "authoritative" as const;
const DERIVED_FRESHNESS_CLASS = "filing_time" as const;
const DERIVED_CONFIDENCE = 1;

export async function materializePeerMetricFacts(
  db: QueryExecutor,
  peers: ReadonlyArray<PeerMetrics>,
  options: MaterializeOptions = {},
): Promise<ReadonlyArray<MaterializedPeer>> {
  const clock = options.clock ?? (() => new Date());
  const metricIds = await resolveDerivedMetricIds(db, peers);

  // Inserts share the caller's executor (which may be a single pinned
  // transaction client), so they run sequentially; the caller owns the
  // transaction + snapshot-seal boundary around this batch.
  const out: MaterializedPeer[] = [];
  for (const peer of peers) {
    const metrics: MaterializedMetric[] = [];
    for (const value of peer.metrics) {
      const valueRef = await materializeCell(db, peer.subject.id, value, metricIds, clock);
      metrics.push({
        metric: value.metric,
        value_ref: valueRef,
        value_num: value.value_num,
        format: value.format,
        ...(value.currency === undefined ? {} : { currency: value.currency }),
      });
    }
    out.push({ subject: peer.subject, metrics });
  }
  return out;
}

async function materializeCell(
  db: QueryExecutor,
  subjectId: UUID,
  value: PeerMetricValue,
  metricIds: ReadonlyMap<string, string>,
  clock: () => Date,
): Promise<UUID> {
  // A reused metric already IS a fact; point the cell straight at it.
  if (value.kind === "reused") return value.fact_id;

  const metricId = metricIds.get(value.metric);
  if (metricId === undefined) {
    throw new Error(
      `metrics-comparison-materializer: no metric_id registered for derived metric "${value.metric}"`,
    );
  }

  const fact = await createFact(db, derivedFactInput(subjectId, value, metricId, clock));
  return fact.fact_id;
}

function derivedFactInput(
  subjectId: UUID,
  value: DerivedPeerMetric,
  metricId: UUID,
  clock: () => Date,
): FactInput {
  return {
    subject_kind: "issuer",
    subject_id: subjectId,
    metric_id: metricId,
    period_kind: value.period.period_kind,
    period_start: value.period.period_start,
    period_end: value.period.period_end,
    fiscal_year: value.period.fiscal_year,
    fiscal_period: value.period.fiscal_period,
    value_num: value.value_num,
    unit: value.unit,
    as_of: value.as_of,
    observed_at: clock().toISOString(),
    source_id: value.source_id,
    method: "derived",
    verification_status: DERIVED_VERIFICATION_STATUS,
    freshness_class: DERIVED_FRESHNESS_CLASS,
    coverage_level: value.coverage_level,
    confidence: DERIVED_CONFIDENCE,
    quality_flags: [derivationLineage(value)],
  };
}

// Lineage stamped on the derived fact: which metric, and the input facts it was
// computed from. Stored in quality_flags (no first-class lineage column — see
// the fra-36y8 spike). A cell can trace back to its components without a schema
// change; the snapshot seal does not enforce these (soft lineage).
function derivationLineage(value: DerivedPeerMetric): Readonly<Record<string, unknown>> {
  return Object.freeze({
    kind: "derivation",
    metric: value.metric,
    input_fact_ids: [...value.input_fact_ids],
  });
}

// One lookup for every distinct computed metric_key in the batch. The four v1
// computed metrics (gross_margin, net_margin, revenue_growth_yoy, pe_ratio) are
// seeded in the metrics table with the same key.
async function resolveDerivedMetricIds(
  db: QueryExecutor,
  peers: ReadonlyArray<PeerMetrics>,
): Promise<ReadonlyMap<string, string>> {
  const keys = new Set<PeerMetricKey>();
  for (const peer of peers) {
    for (const value of peer.metrics) {
      if (value.kind === "derived") keys.add(value.metric);
    }
  }
  return resolveMetricIds(db, [...keys]);
}
