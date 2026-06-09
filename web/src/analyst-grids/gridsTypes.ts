export type CellTone = "best" | "worst" | null;
export type CellDisplay = { value: string; tone: CellTone };
export type CellRef = { kind: "fact" | "claim"; id: string };

export type GridColumn = { column_key: string; label: string; kind: "deterministic" | "reader" };

export type GridRunStatus = "pending" | "running" | "partial" | "completed" | "failed";

export type GridRunSummary = {
  grid_run_id: string;
  status: GridRunStatus;
  cell_total: number;
  cell_done: number;
  dropped_row_count: number;
};

export type GridRowDetail = {
  grid_row_id: string;
  row_number: number;
  subject_ref: { kind: string; id: string };
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
};

export type GridRunDetail = { run: GridRunSummary; rows: GridRowDetail[]; cells: GridCellDetail[] };
