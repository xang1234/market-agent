import type { QueryResult } from "pg";
import type { JsonValue } from "../../observability/src/types.ts";
import type { SubjectRef } from "../../shared/src/subject-ref.ts";

// Local minimal queryable surface (pg.Pool / pg.Client both satisfy it), per the
// convention in services/watchlists/src/queries.ts.
export type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

export const UNIVERSE_SOURCES = ["manual", "screen", "watchlist", "portfolio", "peers"] as const;
export type UniverseSource = (typeof UNIVERSE_SOURCES)[number];

// A grid's universe definition. `manual` carries pre-resolved subject_refs;
// the other sources carry the id of the referenced object.
export type UniverseSpec =
  | { source: "manual"; subject_refs: ReadonlyArray<SubjectRef> }
  | { source: "screen"; screen_id: string }
  | { source: "watchlist"; watchlist_id: string }
  | { source: "portfolio"; portfolio_id: string }
  | { source: "peers"; issuer_id: string; limit?: number };

export type ColumnSpec = { column_key: string; params?: JsonValue };

export type ResearchGridRow = {
  grid_id: string;
  user_id: string;
  name: string;
  description: string | null;
  universe_spec: UniverseSpec;
  column_specs: ReadonlyArray<ColumnSpec>;
  created_at: string;
  updated_at: string;
};

export type CreateGridInput = {
  name: string;
  description?: string | null;
  universe_spec: UniverseSpec;
  column_specs: ReadonlyArray<ColumnSpec>;
};

export type CellStatus = "pending" | "ok" | "missing_data" | "no_coverage" | "error";
// The status a computed cell can carry; `pending` is the insert-time default only.
export type CellResultStatus = Exclude<CellStatus, "pending">;

// Shared cell-value shapes, reused across the producer result, the persistence
// helper, and the cell runner so the contract is declared once.
export type Tone = "best" | "worst" | null;
export type CellDisplay = { value: string; tone: Tone };
export type CellRef = { kind: "fact" | "claim"; id: string };

// The fields written when a cell's result is persisted — declared once and
// reused by updateCellResult (queries) and the cell runner's persist closure.
export type CellWrite = {
  status: CellResultStatus;
  display: CellDisplay;
  snapshotId: string | null;
  primaryRef: CellRef | null;
  coverageFlag: string | null;
};

export class GridNotFoundError extends Error {
  constructor(message = "grid not found") {
    super(message);
    this.name = "GridNotFoundError";
  }
}

export class GridValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GridValidationError";
  }
}
