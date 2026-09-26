import type { FinancialAnswerBlock } from "../blocks/types.ts";
export type CellTone = "best" | "worst" | null;
export type CellDisplay = { value: string; tone: CellTone };
export type CellRef = { kind: "fact" | "claim"; id: string };

export type GridColumn = { column_key: string; label: string; kind: "deterministic" | "reader" };

export type ColumnSpecInput = { column_key: string; params?: { prompt: string } };

export type GridRunStatus = "pending" | "running" | "partial" | "completed" | "failed";

/** A run's column, frozen when it started; two instances of one column are different cells. */
export type GridColumnInstance = { column_instance_id: string; column_key: string; params: unknown; position: number };

export type GridRunSummary = {
  grid_run_id: string;
  status: GridRunStatus;
  cell_total: number;
  cell_done: number;
  dropped_row_count: number;
  /** Absent for runs recorded before column instances existed. */
  column_instances?: ReadonlyArray<GridColumnInstance> | null;
};

export type GridRowDetail = {
  grid_row_id: string;
  row_number: number;
  subject_ref: { kind: string; id: string };
  subject_label?: string | null;
  status: "pending" | "resolved" | "failed";
};

export type GridCellDetail = {
  grid_row_id: string;
  column_key: string;
  status: "pending" | "ok" | "missing_data" | "no_coverage" | "error";
  display: CellDisplay | null;
  snapshot_id: string | null;
  primary_ref: CellRef | null;
  coverage_flag: string | null;
  /** The run's frozen column instance; two instances of one column are different cells. */
  column_instance_id?: string;
  /** The sealed financial_answer block of a certified numerical cell; null otherwise. */
  financial_block?: FinancialAnswerBlock | null;
};

export type GridRunDetail = { run: GridRunSummary; rows: GridRowDetail[]; cells: GridCellDetail[] };
