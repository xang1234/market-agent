// Assembles a metrics_comparison block from the materialized peer facts: one
// row per subject, one column per v1 metric, each cell a { value_ref, format,
// tone } pointing at the fact the materializer produced. Tone comes from the
// metric-direction registry (best/worst per column); the displayed value is
// pre-rendered here (the block contract carries the display string, like
// metric_row's cell.format).
//
// Columns a no subject has are dropped (e.g. P/E is unavailable until price is
// wired), so a column always has at least one value; a subject missing a
// present column is a `null` gap cell (renders "—") — the peer is never
// dropped.

import { columnTones, type MetricTone } from "./metric-direction.ts";
import { formatCompactCurrency } from "./block-format.ts";
import type {
  MaterializedMetric,
  MaterializedPeer,
} from "./metrics-comparison-materializer.ts";
import type { PeerMetricFormat, PeerMetricKey } from "../../fundamentals/src/peer-metrics.ts";
import type { IssuerSubjectRef, UUID } from "../../fundamentals/src/subject-ref.ts";

// v1 columns in display order, with headers mirroring the metrics table's
// display_name. Revenue leads; P/E trails (and drops out until price lands).
const COLUMNS: ReadonlyArray<{ metric: PeerMetricKey; label: string }> = [
  { metric: "revenue", label: "Revenue" },
  { metric: "gross_margin", label: "Gross Margin" },
  { metric: "net_margin", label: "Net Margin" },
  { metric: "revenue_growth_yoy", label: "Revenue Growth (YoY)" },
  { metric: "pe_ratio", label: "P/E" },
];

// The v1 peer set is same-industry S&P-100 issuers, which report in USD. Real
// currency is not threaded to the block builder yet — see fra-q840.
const V1_DISPLAY_CURRENCY = "USD";

export type MetricsComparisonCell = {
  value_ref: UUID;
  format: string;
  tone?: MetricTone;
};

export type MetricsComparisonBlockBase = {
  id: string;
  snapshot_id: UUID;
  as_of: string;
  source_refs: ReadonlyArray<UUID>;
  title?: string;
};

export type MetricsComparisonBlock = {
  id: string;
  kind: "metrics_comparison";
  snapshot_id: UUID;
  // params is added at seal time (fact_bindings need the loaded facts' unit /
  // period metadata — see metrics-comparison-snapshot.ts).
  data_ref: { kind: string; id: string; params?: Readonly<Record<string, unknown>> };
  source_refs: ReadonlyArray<UUID>;
  as_of: string;
  title?: string;
  subjects: ReadonlyArray<IssuerSubjectRef>;
  metrics: ReadonlyArray<string>;
  cells: ReadonlyArray<ReadonlyArray<MetricsComparisonCell | null>>;
  primary_subject_ref: IssuerSubjectRef;
};

export function buildMetricsComparisonBlock(input: {
  peers: ReadonlyArray<MaterializedPeer>;
  primary: IssuerSubjectRef;
  base: MetricsComparisonBlockBase;
}): MetricsComparisonBlock {
  const { peers, primary, base } = input;

  // Keep only columns some subject can fill.
  const columns = COLUMNS.filter((col) => peers.some((peer) => metricOf(peer, col.metric) !== undefined));

  // Tone is a per-column judgment (best/worst across the present values), so
  // resolve it once per column into a subject-index → tone lookup.
  const tonesByColumn = new Map<PeerMetricKey, ReadonlyMap<number, MetricTone>>();
  for (const col of columns) {
    tonesByColumn.set(col.metric, columnToneBySubject(peers, col.metric));
  }

  const cells = peers.map((peer, subjectIndex) =>
    columns.map((col): MetricsComparisonCell | null => {
      const metric = metricOf(peer, col.metric);
      if (metric === undefined) return null;
      const tone = tonesByColumn.get(col.metric)?.get(subjectIndex);
      const cell: MetricsComparisonCell = {
        value_ref: metric.value_ref,
        format: formatValue(metric.value_num, metric.format),
      };
      if (tone !== undefined) cell.tone = tone;
      return cell;
    }),
  );

  return {
    id: base.id,
    kind: "metrics_comparison",
    snapshot_id: base.snapshot_id,
    data_ref: { kind: "metrics_comparison", id: base.id },
    source_refs: base.source_refs,
    as_of: base.as_of,
    ...(base.title === undefined ? {} : { title: base.title }),
    subjects: peers.map((peer) => peer.subject),
    metrics: columns.map((col) => col.label),
    cells,
    primary_subject_ref: primary,
  };
}

function metricOf(peer: MaterializedPeer, metric: PeerMetricKey): MaterializedMetric | undefined {
  return peer.metrics.find((m) => m.metric === metric);
}

// Map each subject that has the column to its tone, in subject order, via the
// metric-direction registry.
function columnToneBySubject(
  peers: ReadonlyArray<MaterializedPeer>,
  metric: PeerMetricKey,
): ReadonlyMap<number, MetricTone> {
  const present: Array<{ subjectIndex: number; value: number }> = [];
  peers.forEach((peer, subjectIndex) => {
    const m = metricOf(peer, metric);
    if (m !== undefined) present.push({ subjectIndex, value: m.value_num });
  });

  const tones = columnTones(metric, present.map((p) => p.value));
  const byIndex = new Map<number, MetricTone>();
  present.forEach((p, i) => {
    const tone = tones[i];
    if (tone !== undefined) byIndex.set(p.subjectIndex, tone);
  });
  return byIndex;
}

function formatValue(value: number, format: PeerMetricFormat): string {
  switch (format) {
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    case "multiple":
      return `${value.toFixed(1)}×`;
    case "currency":
      return formatCompactCurrency(value, V1_DISPLAY_CURRENCY);
  }
}
