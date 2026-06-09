import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import type { SnapshotClientPool } from "../../snapshot/src/snapshot-sealer.ts";
import {
  getGrid,
  createRun,
  insertRow,
  insertPendingCell,
  setRunStatus,
  markRowResolved,
  markRowFailed,
  bumpCellDone,
  getRunDetail,
} from "./queries.ts";
import { resolveUniverse, type UniverseResolverDeps } from "./universe.ts";
import { resolvePeriodContext } from "./period-context.ts";
import { getColumn, type ColumnCatalogEntry, type PeriodContext } from "./column-catalog.ts";
import { computeAndPersistCell } from "./cell-runner.ts";
import { GridValidationError, type QueryExecutor } from "./types.ts";

export const MAX_GRID_ROWS = 25;
const ROW_CONCURRENCY = 4;

export type RunEngineDeps = {
  db: QueryExecutor;
  pool: SnapshotClientPool;
  universe: UniverseResolverDeps;
};

export function capUniverse(refs: ReadonlyArray<SubjectRef>): { capped: ReadonlyArray<SubjectRef>; droppedRowCount: number } {
  if (refs.length <= MAX_GRID_ROWS) return { capped: refs, droppedRowCount: 0 };
  return { capped: refs.slice(0, MAX_GRID_ROWS), droppedRowCount: refs.length - MAX_GRID_ROWS };
}

// Minimal bounded-concurrency map (no p-limit dependency): at most `limit`
// tasks in flight, preserving result order by index.
export async function runWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export type StartRunResult = { runId: string; status: "pending" };

// Synchronous setup + detached worker. Resolves and caps the universe, inserts
// the run/rows/cells, returns immediately, then runs the worker in the
// background. Universe-resolution failures throw here (surfaced as 400) and no
// run is created.
export async function startGridRun(
  deps: RunEngineDeps,
  input: { gridId: string; userId: string; asOf: string },
): Promise<StartRunResult> {
  const grid = await getGrid(deps.db, input.userId, input.gridId);
  const columns: ColumnCatalogEntry[] = grid.column_specs.map((spec) => {
    const column = getColumn(spec.column_key);
    if (!column) throw new GridValidationError(`unknown column_key: ${spec.column_key}`);
    return column;
  });

  const resolved = await resolveUniverse(deps.universe, input.userId, grid.universe_spec);
  const { capped, droppedRowCount } = capUniverse(resolved);
  const cellTotal = capped.length * columns.length;

  const runId = await createRun(deps.db, {
    gridId: grid.grid_id,
    userId: input.userId,
    asOf: input.asOf,
    cellTotal,
    droppedRowCount,
  });

  const rows = await Promise.all(
    capped.map(async (subject, rowNumber) => {
      const gridRowId = await insertRow(deps.db, { gridRunId: runId, rowNumber, subjectRef: subject });
      for (const column of columns) {
        await insertPendingCell(deps.db, { gridRowId, gridRunId: runId, columnKey: column.column_key });
      }
      return { gridRowId, subject };
    }),
  );

  if (droppedRowCount > 0) {
    console.log(`analyst-grids run ${runId}: universe of ${resolved.length} capped to ${MAX_GRID_ROWS} (dropped ${droppedRowCount})`);
  }

  // Detached: the caller already has its run id. runWorker catches everything
  // and records run-level failure, so this never rejects unhandled.
  void runWorker(deps, { runId, rows, columns, asOf: input.asOf });

  return { runId, status: "pending" };
}

async function runWorker(
  deps: RunEngineDeps,
  ctx: { runId: string; rows: Array<{ gridRowId: string; subject: SubjectRef }>; columns: ColumnCatalogEntry[]; asOf: string },
): Promise<void> {
  try {
    await setRunStatus(deps.db, ctx.runId, "running");
    await runWithConcurrency(ctx.rows, ROW_CONCURRENCY, async ({ gridRowId, subject }) => {
      let period: PeriodContext = null;
      try {
        period = await resolvePeriodContext(deps.db, subject);
        await markRowResolved(deps.db, gridRowId, period);
      } catch {
        await markRowFailed(deps.db, gridRowId);
        period = null;
      }
      for (const column of ctx.columns) {
        await computeAndPersistCell(
          { db: deps.db, pool: deps.pool },
          { column, gridRowId, subject, period, asOf: ctx.asOf },
        );
        await bumpCellDone(deps.db, ctx.runId);
      }
    });

    // partial when any cell errored, else completed.
    const detail = await getRunDetail(deps.db, ctx.runId);
    const anyError = detail.cells.some((c) => c.status === "error");
    await setRunStatus(deps.db, ctx.runId, anyError ? "partial" : "completed", { completedAt: true });
  } catch (error) {
    await setRunStatus(deps.db, ctx.runId, "failed", {
      completedAt: true,
      errorMessage: error instanceof Error ? error.message : "run failed",
    });
  }
}
