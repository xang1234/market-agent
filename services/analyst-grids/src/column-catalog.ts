import { randomUUID } from "node:crypto";
import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";
import {
  buildFactBackedSealInput,
  toSealFactRow,
} from "../../analyze/src/block-seal-input.ts";
import { formatCompactCurrency } from "../../analyze/src/block-format.ts";
import type { CellDisplay, CellRef, CellResultStatus, QueryExecutor } from "./types.ts";
import type { JsonValue } from "../../observability/src/types.ts";

// A grid cell's period context. Plan 2 fills the fiscal period from the
// subject's latest fact; document_refs stays [] until Plan 3 wires
// document→issuer linkage. null means "no period resolved" (non-issuer rows).
export type ResolvedPeriod = {
  period_kind: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  period_start: string | null;
  period_end: string | null;
  document_refs: ReadonlyArray<{ kind: "document"; id: string; doc_kind: string }>;
};
export type PeriodContext = null | ResolvedPeriod;

export type GridColumnContext = {
  subject: SubjectRef;
  period: PeriodContext;
  snapshotId: string;
  asOf: string;
  params: JsonValue | null; // the column's ColumnSpec.params, verbatim
};

export type GridCellResult = {
  status: CellResultStatus;
  display: CellDisplay;
  primaryRef?: CellRef;
  seal?: SnapshotSealInput;
  coverageFlag?: string;
};

// The reader-side dependencies a reader-kind column needs. llm matches the
// services/llm router's complete() surface; loadDocumentText resolves a
// document's raw blob to utf-8 text (null when the blob is missing/ephemeral).
export type ReaderLlm = {
  complete(request: {
    messages: ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ text: string; deployment?: { channel: string; model: string } }>;
};

export type ReaderColumnDeps = {
  llm: ReaderLlm;
  loadDocumentText: (rawBlobId: string) => Promise<string | null>;
};

export type GridColumnDeps = { db: QueryExecutor; reader?: ReaderColumnDeps };

export type GridColumnProducer = (
  deps: GridColumnDeps,
  ctx: GridColumnContext,
) => Promise<GridCellResult>;

export type ColumnCatalogEntry = {
  column_key: string;
  label: string;
  kind: "deterministic" | "reader";
  producer: GridColumnProducer;
};

// The empty/placeholder cell display, shared with the cell runner's error path.
export const EMPTY_DISPLAY: CellDisplay = { value: "—", tone: null };

const MISSING: GridCellResult = { status: "missing_data", display: EMPTY_DISPLAY };

const latestMarketCapProducer: GridColumnProducer = async (deps, ctx) => {
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
      where m.metric_key = 'market_cap'
        and f.subject_kind = 'issuer'
        and f.subject_id = $1
        and f.value_num is not null
        and f.invalidated_at is null
        and f.superseded_by is null
        and f.entitlement_channels ? $2
      order by f.as_of desc
      limit 1`,
    [ctx.subject.id, "app"],
  );
  const row = rows[0];
  if (!row || row.value_num === null) return MISSING;

  const valueNum = Number(row.value_num);
  const factRow = toSealFactRow({
    fact_id: row.fact_id,
    source_id: row.source_id,
    unit: row.unit,
    period_kind: row.period_kind,
    period_start: row.period_start,
    period_end: row.period_end,
    fiscal_year: row.fiscal_year,
    fiscal_period: row.fiscal_period,
  });

  const block = {
    id: randomUUID(),
    kind: "metric_row" as const,
    snapshot_id: ctx.snapshotId,
    as_of: ctx.asOf,
    source_refs: [row.source_id],
    data_ref: { kind: "metric_row", id: row.fact_id, params: { column_key: "latest_market_cap" } },
    items: [{ value_ref: row.fact_id }],
  };

  const seal = buildFactBackedSealInput({
    block,
    factRefs: [row.fact_id],
    subjectRefs: [{ kind: ctx.subject.kind, id: ctx.subject.id }],
    facts: [factRow],
  });

  return {
    status: "ok",
    display: { value: formatCompactCurrency(valueNum, "USD"), tone: null },
    primaryRef: { kind: "fact", id: row.fact_id },
    seal,
  };
};

const CATALOG: ReadonlyMap<string, ColumnCatalogEntry> = new Map([
  [
    "latest_market_cap",
    {
      column_key: "latest_market_cap",
      label: "Market Cap (latest)",
      kind: "deterministic",
      producer: latestMarketCapProducer,
    },
  ],
]);

export function listColumns(): ReadonlyArray<Omit<ColumnCatalogEntry, "producer">> {
  return [...CATALOG.values()].map(({ column_key, label, kind }) => ({ column_key, label, kind }));
}

export function getColumn(columnKey: string): ColumnCatalogEntry | undefined {
  return CATALOG.get(columnKey);
}
