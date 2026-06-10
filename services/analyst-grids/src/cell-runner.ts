import { randomUUID } from "node:crypto";
import {
  sealSnapshotWithPool,
  type SnapshotClientPool,
} from "../../snapshot/src/snapshot-sealer.ts";
import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import { updateCellResult } from "./queries.ts";
import { EMPTY_DISPLAY, type ColumnCatalogEntry, type GridCellResult, type PeriodContext } from "./column-catalog.ts";
import type { CellResultStatus, CellWrite, QueryExecutor } from "./types.ts";

export type CellRunnerDeps = { db: QueryExecutor; pool: SnapshotClientPool };

export type ComputeCellInput = {
  column: ColumnCatalogEntry;
  gridRowId: string;
  subject: SubjectRef;
  period: PeriodContext;
  asOf: string;
};

// Computes one cell, seals its snapshot, and persists the result. Returns the
// terminal status it wrote so the run worker can finalize the run without
// re-reading every cell back from the database.
export async function computeAndPersistCell(
  deps: CellRunnerDeps,
  input: ComputeCellInput,
): Promise<CellResultStatus> {
  const persist = (fields: CellWrite) =>
    updateCellResult(deps.db, {
      gridRowId: input.gridRowId,
      columnKey: input.column.column_key,
      ...fields,
    });
  const persistError = async (): Promise<CellResultStatus> => {
    await persist({ status: "error", display: EMPTY_DISPLAY, snapshotId: null, primaryRef: null, coverageFlag: null });
    return "error";
  };

  const snapshotId = randomUUID();
  let result: GridCellResult;
  try {
    result = await input.column.producer(
      { db: deps.db },
      { subject: input.subject, period: input.period, snapshotId, asOf: input.asOf },
    );
  } catch {
    return persistError();
  }

  let sealedSnapshotId: string | null = null;
  if (result.seal) {
    try {
      const sealResult = await sealSnapshotWithPool(deps.pool, result.seal);
      if (!sealResult.ok) return persistError();
      sealedSnapshotId = sealResult.snapshot.snapshot_id;
    } catch {
      return persistError();
    }
  }

  await persist({
    status: result.status,
    display: result.display,
    snapshotId: sealedSnapshotId,
    primaryRef: result.primaryRef ?? null,
    coverageFlag: result.coverageFlag ?? null,
  });
  return result.status;
}
