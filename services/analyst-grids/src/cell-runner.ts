import { randomUUID } from "node:crypto";
import {
  sealSnapshotWithPool,
  type SnapshotClientPool,
} from "../../snapshot/src/snapshot-sealer.ts";
import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import { updateCellResult } from "./queries.ts";
import type { ColumnCatalogEntry, PeriodContext } from "./column-catalog.ts";
import type { QueryExecutor } from "./types.ts";

export type CellRunnerDeps = { db: QueryExecutor; pool: SnapshotClientPool };

export type ComputeCellInput = {
  column: ColumnCatalogEntry;
  gridRowId: string;
  subject: SubjectRef;
  period: PeriodContext;
  asOf: string;
};

export async function computeAndPersistCell(
  deps: CellRunnerDeps,
  input: ComputeCellInput,
): Promise<void> {
  const snapshotId = randomUUID();
  let result;
  try {
    result = await input.column.producer(
      { db: deps.db },
      { subject: input.subject, period: input.period, snapshotId, asOf: input.asOf },
    );
  } catch {
    await updateCellResult(deps.db, {
      gridRowId: input.gridRowId,
      columnKey: input.column.column_key,
      status: "error",
      display: { value: "—", tone: null },
      snapshotId: null,
      primaryRef: null,
      coverageFlag: null,
    });
    return;
  }

  let sealedSnapshotId: string | null = null;
  if (result.seal) {
    const sealResult = await sealSnapshotWithPool(deps.pool, result.seal);
    if (!sealResult.ok) {
      await updateCellResult(deps.db, {
        gridRowId: input.gridRowId,
        columnKey: input.column.column_key,
        status: "error",
        display: { value: "—", tone: null },
        snapshotId: null,
        primaryRef: null,
        coverageFlag: null,
      });
      return;
    }
    sealedSnapshotId = sealResult.snapshot.snapshot_id;
  }

  await updateCellResult(deps.db, {
    gridRowId: input.gridRowId,
    columnKey: input.column.column_key,
    status: result.status,
    display: result.display,
    snapshotId: sealedSnapshotId,
    primaryRef: result.primaryRef ?? null,
    coverageFlag: result.coverageFlag ?? null,
  });
}
