// The one definition of which facts may ground a user-facing, sealed answer
// (#159). Every reader that shows figures goes through here, so a new data
// path inherits the rules instead of re-deriving them:
// - eligibility: reported, active, entitled for the channel, display-verified;
// - numeric (by default): a text-only fact has no figure to show;
// - dated: a fiscal period needs its year and period (point facts need neither);
// - currency: a monetary fact (by its metric's unit_class, or a currency unit)
//   states its currency, never assumed;
// - canonical: one fact per subject, metric and period, the latest as_of winning
//   when sources overlap;
// - cutoff (when given): as_of, observed_at and reported_at all at or before it,
//   so a snapshot never uses what was not yet known (a backdated filing ingested
//   later included); and "active" is judged at the cutoff, so a fact replaced
//   or withdrawn afterwards is still the one that was known then.

import { factActiveSql } from "../../evidence/src/fact-activity.ts";
import { DISPLAYABLE_VERIFICATION_STATUSES } from "../../evidence/src/promotion-rules.ts";
import type { FactEntitlementChannel, FactSubjectKind } from "../../evidence/src/fact-repo.ts";
import type { PeriodKind } from "./statement.ts";

type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
};

export type UsableFactsQuery = {
  subjectKind: FactSubjectKind;
  subjectIds: ReadonlyArray<string>;
  // Egress channel the facts must be entitled to; chat answers render on "app".
  channel?: FactEntitlementChannel;
  // Snapshot cutoff; omit for "now".
  cutoff?: string;
  periodKind?: PeriodKind;
  metricKeys?: ReadonlyArray<string>;
  // Default true. False keeps text-only facts (e.g. for model context).
  numericOnly?: boolean;
  // Row cap after canonicalization; omit for all.
  limit?: number;
};

export type UsableFact = {
  fact_id: string;
  subject_id: string;
  metric_key: string;
  display_name: string | null;
  value_num: number | null;
  value_text: string | null;
  unit: string | null;
  currency: string | null;
  // Multiplier to native units (value_num * scale).
  scale: number;
  period_kind: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  as_of: string;
  source_id: string;
  coverage_level: string;
};

type Row = Omit<UsableFact, "value_num" | "scale" | "as_of"> & {
  value_num: number | string | null;
  scale: number | string | null;
  as_of: Date | string;
};

/** Canonical usable facts, newest fiscal period first. */
export async function loadUsableFacts(db: QueryExecutor, query: UsableFactsQuery): Promise<UsableFact[]> {
  if (query.subjectIds.length === 0) return [];
  const params: unknown[] = [
    query.subjectKind,
    [...query.subjectIds],
    query.channel ?? "app",
    [...DISPLAYABLE_VERIFICATION_STATUSES],
  ];
  let filters = "";
  // Active now, or (for a historical cutoff) active at the cutoff.
  let activity = factActiveSql("f");
  // A figure is a finite number: numeric columns can also hold NaN/Infinity.
  if (query.numericOnly ?? true) {
    filters += `\n        and f.value_num is not null and f.value_num not in ('NaN', 'Infinity', '-Infinity')`;
  }
  if (query.periodKind !== undefined) {
    params.push(query.periodKind);
    filters += `\n        and f.period_kind = $${params.length}`;
  }
  if (query.metricKeys !== undefined) {
    params.push([...query.metricKeys]);
    filters += `\n        and m.metric_key = any($${params.length}::text[])`;
  }
  if (query.cutoff !== undefined) {
    params.push(query.cutoff);
    const cutoff = `$${params.length}::timestamptz`;
    filters += `
        and f.as_of <= ${cutoff}
        and f.observed_at <= ${cutoff}
        and (f.reported_at is null or f.reported_at <= ${cutoff})`;
    activity = factActiveSql("f", cutoff);
  }

  let limitClause = "";
  if (query.limit !== undefined) {
    params.push(query.limit);
    limitClause = `\n      limit $${params.length}`;
  }

  const { rows } = await db.query<Row>(
    `with usable as (
       -- A fiscal fact is identified by its fiscal year and period (sources may
       -- draw the date boundaries differently); other kinds only by their dates
       -- (sources may label them with a fiscal period or not).
       select distinct on (f.subject_id, f.metric_id, f.period_kind,
                           case when f.period_kind in ('fiscal_q', 'fiscal_y') then f.fiscal_year end,
                           case when f.period_kind in ('fiscal_q', 'fiscal_y') then f.fiscal_period end,
                           case when f.period_kind in ('fiscal_q', 'fiscal_y') then null else f.period_start end,
                           case when f.period_kind in ('fiscal_q', 'fiscal_y') then null else f.period_end end)
              f.fact_id::text as fact_id,
              f.subject_id::text as subject_id,
              m.metric_key,
              m.display_name,
              f.value_num,
              f.value_text,
              f.unit,
              f.currency,
              f.scale,
              f.period_kind,
              f.fiscal_year,
              f.fiscal_period,
              f.as_of,
              f.source_id::text as source_id,
              f.coverage_level::text as coverage_level
         from facts f
         join metrics m on m.metric_id = f.metric_id
        where f.subject_kind = $1::subject_kind
          and f.subject_id = any($2::uuid[])
          and f.method = 'reported'
          and ${activity}
          and f.entitlement_channels ? $3
          and f.verification_status = any($4::verification_status[])
          and (f.period_kind not in ('fiscal_q', 'fiscal_y') or (f.fiscal_year is not null and f.fiscal_period is not null))
          -- A malformed multiplier makes the fact unusable, never a default.
          and f.scale not in ('NaN', 'Infinity', '-Infinity')
          -- A monetary fact states its currency: by the metric's unit_class (EPS
          -- included) or a currency unit, however the fact spells it ('USD').
          and ((m.unit_class <> 'currency' and f.unit not like 'currency%') or f.currency is not null)${filters}
        order by f.subject_id, f.metric_id, f.period_kind,
                 case when f.period_kind in ('fiscal_q', 'fiscal_y') then f.fiscal_year end,
                 case when f.period_kind in ('fiscal_q', 'fiscal_y') then f.fiscal_period end,
                 case when f.period_kind in ('fiscal_q', 'fiscal_y') then null else f.period_start end,
                 case when f.period_kind in ('fiscal_q', 'fiscal_y') then null else f.period_end end,
                 f.as_of desc, f.fact_id
     )
     select * from usable
      order by fiscal_year desc nulls last, as_of desc, metric_key${limitClause}`,
    params,
  );
  return rows.map((row) => Object.freeze({
    ...row,
    value_num: finiteOrNull(row.value_num),
    // Non-finite scales are excluded in SQL; scale is non-null in the schema.
    scale: finiteOrNull(row.scale) ?? 1,
    as_of: row.as_of instanceof Date ? row.as_of.toISOString() : new Date(row.as_of).toISOString(),
  }));
}

function finiteOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
