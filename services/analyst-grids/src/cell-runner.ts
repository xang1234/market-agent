import { randomUUID } from "node:crypto";
import {
  sealSnapshotWithPool,
  type SnapshotClientPool,
} from "../../snapshot/src/snapshot-sealer.ts";
import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import { updateCellResult } from "./queries.ts";
import { EMPTY_DISPLAY, type ColumnCatalogEntry, type GridCellResult, type PeriodContext } from "./column-catalog.ts";
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
  const persist = (fields: {
    status: "ok" | "missing_data" | "no_coverage" | "error";
    display: { value: string; tone: "best" | "worst" | null };
    snapshotId: string | null;
    primaryRef: { kind: "fact" | "claim"; id: string } | null;
    coverageFlag: string | null;
  }) =>
    updateCellResult(deps.db, {
      gridRowId: input.gridRowId,
      columnKey: input.column.column_key,
      ...fields,
    });
  const persistError = () =>
    persist({ status: "error", display: EMPTY_DISPLAY, snapshotId: null, primaryRef: null, coverageFlag: null });

  const snapshotId = randomUUID();
  let result: GridCellResult;
  try {
    result = await input.column.producer(
      { db: deps.db },
      { subject: input.subject, period: input.period, snapshotId, asOf: input.asOf },
    );
  } catch {
    await persistError();
    return;
  }

  let sealedSnapshotId: string | null = null;
  if (result.seal) {
    const sealResult = await sealSnapshotWithPool(deps.pool, result.seal);
    if (!sealResult.ok) {
      await persistError();
      return;
    }
    sealedSnapshotId = sealResult.snapshot.snapshot_id;
  }

  await persist({
    status: result.status,
    display: result.display,
    snapshotId: sealedSnapshotId,
    primaryRef: result.primaryRef ?? null,
    coverageFlag: result.coverageFlag ?? null,
  });
}
