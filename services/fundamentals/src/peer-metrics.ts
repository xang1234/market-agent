// Per-issuer fetch of the v1 peer-comparison metric set, flattened from the
// key-stats envelope into a shape the metrics_comparison emitter can hand to
// the fact materializer. Each value carries the lineage (input fact_ids), the
// representative source_id, and the as_of the materializer needs to mint a
// derived fact.
//
// Loading is delegated to StatsRepository.find (the canonical per-issuer
// key-stats orchestrator) so this layer never re-implements statement/price
// loading — it only selects, reshapes, and exposes lineage.

import type {
  KeyStat,
  KeyStatInputRef,
  KeyStatsEnvelope,
  StatementLineInputRef,
} from "./key-stats.ts";
import { REVENUE_KEYS } from "./key-stats.ts";
import type { StatsRepository } from "./stats-repository.ts";
import type { CoverageLevel, FiscalPeriod, PeriodKind } from "./statement.ts";
import { freezeIssuerRef, type IssuerSubjectRef, type UUID } from "./subject-ref.ts";

// The v1 metric columns (design: Revenue TTM, gross/net margin, rev growth YoY,
// P/E). Operating margin is intentionally excluded from v1.
export type PeerMetricKey =
  | "revenue"
  | "gross_margin"
  | "net_margin"
  | "revenue_growth_yoy"
  | "pe_ratio";

export type PeerMetricFormat = "currency" | "percent" | "multiple";

// The reporting period a value belongs to — needed to mint a fact (facts carry
// a non-null period) and to align cells across peers.
export type PeerMetricPeriod = {
  period_kind: PeriodKind;
  period_start: string | null;
  period_end: string;
  fiscal_year: number;
  fiscal_period: FiscalPeriod;
};

// A metric value for one issuer, tagged by how the materializer turns it into a
// cell's fact reference:
//   - `reused`  — the value already IS a stored fact (revenue, a reported
//     statement line); the cell points straight at `fact_id`.
//   - `derived` — a computed quantity (margins, growth, P/E) the materializer
//     mints as a method='derived' fact, carrying the fields a fact needs.
// Encoding the two cases in the type keeps the reuse/derive branch (and the
// fields each case actually uses) out of ad-hoc conditionals downstream.
type PeerMetricBase = {
  metric: PeerMetricKey;
  value_num: number;
  format: PeerMetricFormat;
  // Reporting currency for currency-format metrics (fra-q840); undefined for
  // dimensionless ratios.
  currency?: string;
};

export type ReusedPeerMetric = PeerMetricBase & {
  kind: "reused";
  fact_id: UUID;
};

export type DerivedPeerMetric = PeerMetricBase & {
  kind: "derived";
  unit: string;
  as_of: string;
  // Source of record for the derived fact: the source backing the metric's
  // statement input (eps/revenue/…), falling back to the first input. A
  // blended metric like P/E still records every component in input_fact_ids.
  source_id: UUID;
  period: PeerMetricPeriod;
  coverage_level: CoverageLevel;
  // Lineage: the persisted facts this value was computed from. May be empty
  // when the envelope came from a not-yet-persisted statement (fact_id absent).
  input_fact_ids: ReadonlyArray<UUID>;
};

export type PeerMetricValue = ReusedPeerMetric | DerivedPeerMetric;

export type PeerMetrics = {
  subject: IssuerSubjectRef;
  // Present metrics only; the block builder renders absent metrics as "—".
  metrics: ReadonlyArray<PeerMetricValue>;
};

// Key-stat stat_keys that map 1:1 onto a peer-metric column, with their display
// format. Revenue is handled separately (it is a raw statement fact, not a
// computed stat).
const STAT_COLUMNS: ReadonlyArray<{ stat_key: KeyStat["stat_key"]; metric: PeerMetricKey; format: PeerMetricFormat }> = [
  { stat_key: "gross_margin", metric: "gross_margin", format: "percent" },
  { stat_key: "net_margin", metric: "net_margin", format: "percent" },
  { stat_key: "revenue_growth_yoy", metric: "revenue_growth_yoy", format: "percent" },
  { stat_key: "pe_ratio", metric: "pe_ratio", format: "multiple" },
];

export async function fetchPeerMetrics(
  stats: StatsRepository,
  issuerIds: ReadonlyArray<UUID>,
): Promise<ReadonlyArray<PeerMetrics>> {
  // Independent per-issuer loads — run them concurrently.
  return Promise.all(issuerIds.map((issuerId) => fetchOne(stats, issuerId)));
}

async function fetchOne(stats: StatsRepository, issuerId: UUID): Promise<PeerMetrics> {
  const envelope = await stats.find(issuerId);
  if (envelope === null) {
    // Keep the peer in the comparison (renders all "—"); never drop it.
    return Object.freeze({
      subject: freezeIssuerRef({ kind: "issuer", id: issuerId }, "peerMetrics.subject"),
      metrics: Object.freeze([]),
    });
  }
  return Object.freeze({
    subject: envelope.subject,
    metrics: Object.freeze(metricsFromEnvelope(envelope)),
  });
}

function metricsFromEnvelope(envelope: KeyStatsEnvelope): PeerMetricValue[] {
  const out: PeerMetricValue[] = [];
  const revenue = revenueValue(envelope);
  if (revenue) out.push(revenue);

  const byKey = new Map(envelope.stats.map((stat) => [stat.stat_key, stat]));
  for (const column of STAT_COLUMNS) {
    const stat = byKey.get(column.stat_key);
    if (!stat || stat.value_num === null) continue;
    out.push(
      Object.freeze({
        kind: "derived",
        metric: column.metric,
        value_num: stat.value_num,
        unit: stat.unit,
        format: column.format,
        as_of: stat.as_of,
        source_id: representativeSourceId(stat.inputs),
        period: periodOf(stat),
        coverage_level: stat.coverage_level,
        input_fact_ids: inputFactIds(stat.inputs),
      }),
    );
  }
  return out;
}

// Revenue is not a computed stat; it is the revenue statement line that already
// participates as a margin denominator / growth numerator. Reusing that line's
// fact keeps the revenue cell identical to the one the margins divide by,
// instead of re-loading or re-deriving the statement.
//
// Requires a persisted fact_id: a `reused` metric is, by definition, a pointer
// to an existing fact, so a revenue line without one (not-yet-persisted
// statement) yields no cell rather than a value with nothing to point at.
//
// Only the current-period revenue qualifies. The growth stat also carries a
// `role: "prior"` revenue input (last year's); excluding it prevents surfacing
// stale prior-year revenue when the current statement happens to lack its own
// revenue line — independent of the order stats appear in the envelope.
function revenueValue(envelope: KeyStatsEnvelope): ReusedPeerMetric | null {
  for (const stat of envelope.stats) {
    for (const input of stat.inputs) {
      if (
        input.kind === "statement_line" &&
        input.role !== "prior" &&
        REVENUE_KEYS.includes(input.metric_key) &&
        input.value_num !== null &&
        input.fact_id !== undefined
      ) {
        return Object.freeze({
          kind: "reused",
          metric: "revenue",
          value_num: input.value_num,
          format: "currency",
          currency: input.currency ?? envelope.reporting_currency,
          fact_id: input.fact_id,
        });
      }
    }
  }
  return null;
}

// KeyStat and StatementLineInputRef both carry the same period fields; project
// just those into the period the materializer needs.
function periodOf(src: PeerMetricPeriod): PeerMetricPeriod {
  return {
    period_kind: src.period_kind,
    period_start: src.period_start,
    period_end: src.period_end,
    fiscal_year: src.fiscal_year,
    fiscal_period: src.fiscal_period,
  };
}

function inputFactIds(inputs: ReadonlyArray<KeyStatInputRef>): ReadonlyArray<UUID> {
  const ids: UUID[] = [];
  for (const input of inputs) {
    // fact_id is required on market_fact inputs, optional on statement_line.
    if (input.fact_id !== undefined) ids.push(input.fact_id);
  }
  return Object.freeze(ids);
}

// The derived fact's source_id: prefer a statement-line input's source (the
// fundamentals definition the metric is anchored to), else the first input.
function representativeSourceId(inputs: ReadonlyArray<KeyStatInputRef>): UUID {
  const statementInput = inputs.find(
    (input): input is StatementLineInputRef => input.kind === "statement_line",
  );
  const chosen = statementInput ?? inputs[0];
  if (chosen === undefined) {
    throw new Error("peer-metrics: stat has no inputs to source a derived fact from");
  }
  return chosen.source_id;
}
