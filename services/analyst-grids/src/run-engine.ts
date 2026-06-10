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
} from "./queries.ts";
import { withTransaction } from "../../evidence/src/transaction.ts";
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
// tasks in flight, preserving result order by index. On the first task error
// it stops pulling new items, lets in-flight tasks drain, then rejects with
// that error — so a caller that finalizes on rejection never races workers
// that are still writing.
export async function runWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let aborted = false;
  let firstError: unknown = null;
  async function worker(): Promise<void> {
    while (true) {
      if (aborted) return;
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        if (!aborted) {
          aborted = true;
          firstError = err;
        }
        return;
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  if (aborted) throw firstError;
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

  // Materialize the run, its rows, and its pending cells atomically: a partial
  // failure here must not leave a run whose cell_total never reconciles. The
  // inserts run sequentially because a transaction is a single connection.
  const { runId, rows } = await withTransaction(deps.db, async (tx) => {
    const runId = await createRun(tx.db, {
      gridId: grid.grid_id,
      userId: input.userId,
      asOf: input.asOf,
      cellTotal,
      droppedRowCount,
    });
    const rows: Array<{ gridRowId: string; subject: SubjectRef }> = [];
    for (const [rowNumber, subject] of capped.entries()) {
      const gridRowId = await insertRow(tx.db, { gridRunId: runId, rowNumber, subjectRef: subject });
      for (const column of columns) {
        await insertPendingCell(tx.db, { gridRowId, gridRunId: runId, columnKey: column.column_key });
      }
      rows.push({ gridRowId, subject });
    }
    return { runId, rows };
  });

  if (droppedRowCount > 0) {
    console.log(`analyst-grids run ${runId}: universe of ${resolved.length} capped to ${MAX_GRID_ROWS} (dropped ${droppedRowCount})`);
  }

  // Detached: the caller already has its run id. runWorker records run-level
  // failure on error, but its recovery write can itself reject (e.g. DB
  // outage), so we attach a catch here to keep that from becoming an unhandled
  // rejection that crashes the host process.
  void runWorker(deps, { runId, rows, columns, asOf: input.asOf }).catch((err) => {
    console.error(`analyst-grids run ${runId}: worker crashed`, err);
  });

  return { runId, status: "pending" };
}

async function runWorker(
  deps: RunEngineDeps,
  ctx: { runId: string; rows: Array<{ gridRowId: string; subject: SubjectRef }>; columns: ColumnCatalogEntry[]; asOf: string },
): Promise<void> {
  try {
    await setRunStatus(deps.db, ctx.runId, "running");
    // Each row reports whether any of its cells errored; the worker finalizes
    // from these outcomes rather than re-reading every cell back.
    const rowHadError = await runWithConcurrency(ctx.rows, ROW_CONCURRENCY, async ({ gridRowId, subject }) => {
      let period: PeriodContext = null;
      try {
        period = await resolvePeriodContext(deps.db, subject);
        await markRowResolved(deps.db, gridRowId, period);
      } catch {
        await markRowFailed(deps.db, gridRowId);
        period = null;
      }
      let errored = false;
      for (const column of ctx.columns) {
        const status = await computeAndPersistCell(
          { db: deps.db, pool: deps.pool },
          { column, gridRowId, subject, period, asOf: ctx.asOf },
        );
        if (status === "error") errored = true;
        await bumpCellDone(deps.db, ctx.runId);
      }
      return errored;
    });

    // partial when any cell errored, else completed.
    const anyError = rowHadError.some(Boolean);
    await setRunStatus(deps.db, ctx.runId, anyError ? "partial" : "completed", { completedAt: true });
  } catch (error) {
    try {
      await setRunStatus(deps.db, ctx.runId, "failed", {
        completedAt: true,
        errorMessage: error instanceof Error ? error.message : "run failed",
      });
    } catch (finalizeError) {
      console.error(`analyst-grids run ${ctx.runId}: failed to record run failure`, finalizeError);
    }
  }
}
