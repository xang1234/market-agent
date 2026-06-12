import { randomUUID } from "node:crypto";
import { buildFactBackedSealInput, toSealFactRow } from "../../snapshot/src/seal-input.ts";
import { formatCompactCurrency, formatCurrency } from "../../analyze/src/block-format.ts";
import type { GridColumnProducer, GridCellResult } from "./column-catalog.ts";
import { EMPTY_DISPLAY } from "./types.ts";

const MISSING: GridCellResult = { status: "missing_data", display: EMPTY_DISPLAY };

// "Q2 2025" / "FY 2024" / "TTM" — cells across a grid can show different
// reporting periods, so each cell names the one it carries.
function fiscalLabel(row: {
  period_kind: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
}): string {
  if (row.fiscal_period !== null && row.fiscal_year !== null) {
    return `${row.fiscal_period} ${row.fiscal_year}`;
  }
  return row.period_kind === "ttm" ? "TTM" : "";
}

// Producer for "latest reported fiscal fact of metric X" columns (revenue,
// EPS, ...). Picks the issuer's most recently reported fiscal-period fact
// using the repo's canonical live-fact ordering (see period-context.ts) and
// seals it fact-backed, exactly like latest_market_cap.
export function fiscalFactProducer(
  metricKey: string,
  columnKey: string,
  format: (valueNum: number) => string,
): GridColumnProducer {
  return async (deps, ctx) => {
    if (ctx.subject.kind !== "issuer") return MISSING;
    const { rows } = await deps.db.query<{
      fact_id: string;
      value_num: string | number | null;
      source_id: string;
      unit: string;
      period_kind: string;
      period_start: string | null;
      period_end: string | null;
      fiscal_year: number | null;
      fiscal_period: string | null;
    }>(
      `select f.fact_id::text as fact_id, f.value_num, f.source_id::text as source_id,
              f.unit, f.period_kind,
              f.period_start::text as period_start, f.period_end::text as period_end,
              f.fiscal_year, f.fiscal_period
         from facts f
         join metrics m on m.metric_id = f.metric_id
        where m.metric_key = $2
          and f.subject_kind = 'issuer'
          and f.subject_id = $1
          and f.value_num is not null
          and f.invalidated_at is null
          and f.superseded_by is null
          and f.entitlement_channels ? $3
          and f.period_kind in ('fiscal_q','fiscal_y','ttm')
        order by f.as_of desc, f.period_end desc nulls last, f.created_at desc, f.fact_id desc
        limit 1`,
      [ctx.subject.id, metricKey, "app"],
    );
    const row = rows[0];
    if (!row || row.value_num === null) return MISSING;

    const factRow = toSealFactRow(row);
    const block = {
      id: randomUUID(),
      kind: "metric_row" as const,
      snapshot_id: ctx.snapshotId,
      as_of: ctx.asOf,
      source_refs: [row.source_id],
      data_ref: { kind: "metric_row", id: row.fact_id, params: { column_key: columnKey } },
      items: [{ value_ref: row.fact_id }],
    };
    const seal = buildFactBackedSealInput({
      block,
      factRefs: [row.fact_id],
      subjectRefs: [{ kind: ctx.subject.kind, id: ctx.subject.id }],
      facts: [factRow],
    });

    const period = fiscalLabel(row);
    const formatted = format(Number(row.value_num));
    return {
      status: "ok",
      display: { value: period ? `${formatted} · ${period}` : formatted, tone: null },
      primaryRef: { kind: "fact", id: row.fact_id },
      seal,
    };
  };
}

export const latestRevenueProducer = fiscalFactProducer("revenue", "latest_revenue", (v) =>
  formatCompactCurrency(v, "USD"),
);

export const latestEpsDilutedProducer = fiscalFactProducer("eps_diluted", "latest_eps_diluted", (v) =>
  formatCurrency(v, "USD"),
);
