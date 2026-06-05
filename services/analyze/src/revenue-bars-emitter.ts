// The earnings_quality playbook's deterministic emitter for the revenue_trend
// section: loads the issuer's last N quarterly revenue facts (one SELECT — each
// bar reuses an existing reported fact, so no materializer), builds the bars,
// and assembles the seal input. Returns null when the issuer has no quarterly
// revenue facts, so the run simply omits the section. Like the peer emitter, it
// does NOT seal: the run path seals the returned input in its transaction.

import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { IssuerSubjectRef, UUID } from "../../fundamentals/src/subject-ref.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";
import { buildRevenueBarsBlock, type QuarterlyRevenueFact } from "./revenue-bars-block-builder.ts";
import { buildRevenueBarsSealInput, type RevenueBarsFactRow } from "./revenue-bars-snapshot.ts";

export type RevenueBarsEmitterDeps = {
  // Evidence DB executor — the run's transaction client when sealing.
  db: QueryExecutor;
};

export type RevenueBarsEmitInput = {
  primary: IssuerSubjectRef;
  snapshotId: UUID;
  blockId: string;
  asOf: string;
  quarters?: number;
  title?: string;
};

const DEFAULT_QUARTERS = 8;

export async function emitRevenueBarsBlock(
  deps: RevenueBarsEmitterDeps,
  input: RevenueBarsEmitInput,
): Promise<SnapshotSealInput | null> {
  const rows = await loadQuarterlyRevenueFacts(deps.db, input.primary.id, input.quarters ?? DEFAULT_QUARTERS);
  const usable = rows.filter((row) => row.value_num !== null);
  if (usable.length === 0) return null;

  const facts: QuarterlyRevenueFact[] = usable.map((row) => ({
    fact_id: row.fact_id,
    fiscal_year: row.fiscal_year,
    fiscal_period: row.fiscal_period,
    value_num: Number(row.value_num),
    scale: Number(row.scale),
    currency: row.currency,
  }));

  const sources = distinct(usable.map((row) => row.source_id));
  const block = buildRevenueBarsBlock({
    facts,
    base: {
      id: input.blockId,
      snapshot_id: input.snapshotId,
      as_of: input.asOf,
      source_refs: sources,
      ...(input.title === undefined ? {} : { title: input.title }),
    },
  });

  const factRows: RevenueBarsFactRow[] = usable.map((row) => ({
    fact_id: row.fact_id,
    source_id: row.source_id,
    unit: row.unit,
    period_kind: row.period_kind,
    period_start: dateString(row.period_start),
    period_end: dateString(row.period_end),
    fiscal_year: row.fiscal_year,
    fiscal_period: row.fiscal_period,
  }));

  return buildRevenueBarsSealInput({ block, facts: factRows, primary: input.primary });
}

type RevenueFactDbRow = {
  fact_id: string;
  source_id: string;
  unit: string;
  period_kind: string;
  period_start: Date | string | null;
  period_end: Date | string | null;
  fiscal_year: number | null;
  fiscal_period: string | null;
  value_num: string | number | null;
  scale: string | number; // facts.scale is NOT NULL DEFAULT 1
  currency: string | null;
};

// The last `limit` non-superseded quarterly revenue facts for the issuer,
// newest-first (the builder re-sorts ascending for display).
async function loadQuarterlyRevenueFacts(
  db: QueryExecutor,
  issuerId: UUID,
  limit: number,
): Promise<ReadonlyArray<RevenueFactDbRow>> {
  const { rows } = await db.query<RevenueFactDbRow>(
    `select f.fact_id::text as fact_id,
            f.source_id::text as source_id,
            f.unit,
            f.period_kind::text as period_kind,
            f.period_start,
            f.period_end,
            f.fiscal_year,
            f.fiscal_period,
            f.value_num,
            f.scale,
            f.currency
       from facts f
       join metrics m on m.metric_id = f.metric_id
      where f.subject_kind = 'issuer'
        and f.subject_id = $1::uuid
        and m.metric_key = 'revenue'
        and f.period_kind = 'fiscal_q'
        and f.fiscal_period in ('Q1', 'Q2', 'Q3', 'Q4')
        and f.method = 'reported'
        and f.invalidated_at is null
        and f.superseded_by is null
      order by f.fiscal_year desc,
               case f.fiscal_period
                 when 'Q4' then 4 when 'Q3' then 3
                 when 'Q2' then 2 when 'Q1' then 1 end desc
      limit $2`,
    [issuerId, limit],
  );
  return rows;
}

function dateString(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function distinct(values: ReadonlyArray<UUID>): UUID[] {
  return [...new Set(values)];
}
