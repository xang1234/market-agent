import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";
import type { CellDisplay, CellRef, CellResultStatus, QueryExecutor } from "./types.ts";
import { GridValidationError } from "./types.ts";
import type { JsonValue } from "../../observability/src/types.ts";
import { parseReaderQuestionParams, readerQuestionProducer } from "./reader-question-column.ts";
import { FINANCIAL_COLUMN_LABELS, parseFinancialColumnParams, validateFinancialPlanFit } from "./financial-column.ts";

export const READER_QUESTION_COLUMN_KEY = "reader_question";
export const MAX_READER_COLUMNS_PER_GRID = 3;

export type GridColumnContext = {
  subject: SubjectRef;
  snapshotId: string;
  asOf: string;
  userId: string;
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

export type ReaderColumn = { column_key: string; label: string; kind: "reader"; producer: GridColumnProducer };
export type ColumnCatalogEntry = { column_key: string; label: string; kind: "deterministic" } | ReaderColumn;

const CATALOG: ReadonlyMap<string, ColumnCatalogEntry> = new Map<string, ColumnCatalogEntry>([
  ...FINANCIAL_COLUMN_LABELS.map(([column_key, label]): [string, ColumnCatalogEntry] => [column_key, { column_key, label, kind: "deterministic" }]),
  [READER_QUESTION_COLUMN_KEY, { column_key: READER_QUESTION_COLUMN_KEY, label: "Question", kind: "reader", producer: readerQuestionProducer }],
]);

export function listColumns(): ReadonlyArray<Omit<ColumnCatalogEntry, "producer">> {
  return [...CATALOG.values()].map(({ column_key, label, kind }) => ({ column_key, label, kind }));
}

export function getColumn(columnKey: string): ColumnCatalogEntry | undefined {
  return CATALOG.get(columnKey);
}

// Create-time validation for a grid's column specs. Owns the narrowing from
// raw request JSON (unknown elements) so HTTP callers hand the parsed array
// straight in. Throws GridValidationError (surfaced as HTTP 400).
export function validateColumnSpecs(specs: ReadonlyArray<unknown>): void {
  let readerCount = 0;
  for (const value of specs) {
    const spec = (value ?? {}) as { column_key?: unknown; params?: unknown };
    if (typeof spec.column_key !== "string") {
      throw new GridValidationError("each column_spec needs a string 'column_key'");
    }
    const entry = CATALOG.get(spec.column_key);
    if (!entry) throw new GridValidationError(`unknown column_key: ${spec.column_key}`);
    if (entry.kind === "reader") readerCount += 1;
    if (spec.column_key === READER_QUESTION_COLUMN_KEY) {
      parseReaderQuestionParams(spec.params);
    }
    if (entry.kind === "deterministic") {
      parseFinancialColumnParams(spec.column_key, spec.params);
    }
  }
  if (readerCount > MAX_READER_COLUMNS_PER_GRID) {
    throw new GridValidationError(`at most ${MAX_READER_COLUMNS_PER_GRID} question columns per grid`);
  }
  validateFinancialPlanFit(specs as ReadonlyArray<{ column_key: string; params?: unknown }>);
}
