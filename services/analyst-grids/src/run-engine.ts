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
  settleRunIfDone,
} from "./queries.ts";
import { isFinancialColumn, publishGridFinancialCells, type GridFinancialDeps, type GridFinancialMode } from "./financial-column.ts";
import { withTransaction } from "../../evidence/src/transaction.ts";
import { resolveUniverse, type UniverseResolverDeps } from "./universe.ts";
import { normalizeUniverseToIssuers } from "./subject-normalization.ts";
import { resolvePeriodContext } from "./period-context.ts";
import { getColumn, type ColumnCatalogEntry, type PeriodContext, type ReaderColumnDeps } from "./column-catalog.ts";
import { computeAndPersistCell } from "./cell-runner.ts";
import { GridValidationError, type ColumnInstance, type QueryExecutor } from "./types.ts";
import type { JsonValue } from "../../observability/src/types.ts";

export const MAX_GRID_ROWS = 25;
const ROW_CONCURRENCY = 4;

export type RunEngineDeps = {
  db: QueryExecutor;
  pool: SnapshotClientPool;
  universe: UniverseResolverDeps;
  reader?: ReaderColumnDeps;
  // Verified numerical columns (financial-column.ts). Absent or off: every column uses its legacy producer.
  financial?: GridFinancialDeps;
};

type RunColumn = { entry: ColumnCatalogEntry; params: JsonValue | null; instance: ColumnInstance };

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
  // Freeze the columns now: an edit to the grid while this run executes cannot change what it computes.
  const columns: RunColumn[] = grid.column_specs.map((spec, position) => {
    const entry = getColumn(spec.column_key);
    if (!entry) throw new GridValidationError(`unknown column_key: ${spec.column_key}`);
    const params = spec.params ?? null;
    return { entry, params, instance: { column_instance_id: `c${position}`, column_key: spec.column_key, params, position } };
  });

  const resolved = await resolveUniverse(deps.universe, input.userId, grid.universe_spec);
  // Watchlist/portfolio/screen universes carry listing refs; columns are
  // issuer-scoped, so normalize before capping (mapping can also dedupe).
  const normalized = await normalizeUniverseToIssuers(deps.db, resolved);
  const { capped, droppedRowCount } = capUniverse(normalized);
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
      columnInstances: columns.map((column) => column.instance),
      financialMode: deps.financial && deps.financial.mode !== "off" ? deps.financial.mode : null,
    });
    const rows: Array<{ gridRowId: string; rowNumber: number; subject: SubjectRef }> = [];
    for (const [rowNumber, subject] of capped.entries()) {
      const gridRowId = await insertRow(tx.db, { gridRunId: runId, rowNumber, subjectRef: subject });
      for (const column of columns) {
        await insertPendingCell(tx.db, {
          gridRowId,
          gridRunId: runId,
          columnKey: column.entry.column_key,
          columnInstanceId: column.instance.column_instance_id,
        });
      }
      rows.push({ gridRowId, rowNumber, subject });
    }
    return { runId, rows };
  });

  if (droppedRowCount > 0) {
    console.log(`analyst-grids run ${runId}: universe of ${normalized.length} capped to ${MAX_GRID_ROWS} (dropped ${droppedRowCount})`);
  }

  // Detached: the caller already has its run id. runWorker records run-level
  // failure on error, but its recovery write can itself reject (e.g. DB
  // outage), so we attach a catch here to keep that from becoming an unhandled
  // rejection that crashes the host process.
  void runWorker(deps, { runId, rows, columns, asOf: input.asOf, userId: input.userId }).catch((err) => {
    console.error(`analyst-grids run ${runId}: worker crashed`, err);
  });

  return { runId, status: "pending" };
}

/**
 * Which columns the run's producers compute and which the engine does, decided
 * once when the run starts. Enforced: numerical columns are the engine's alone.
 * Shadow: producers compute everything and the engine only plans the numerical
 * columns. Off: producers compute everything.
 */
function routeColumns(columns: ReadonlyArray<RunColumn>, mode: GridFinancialMode): { producer: RunColumn[]; engine: ColumnInstance[] } {
  const numerical = columns.filter((column) => isFinancialColumn(column.entry.column_key));
  return {
    producer: mode === "enforce" ? columns.filter((column) => !numerical.includes(column)) : [...columns],
    engine: mode === "off" ? [] : numerical.map((column) => column.instance),
  };
}

async function runWorker(
  deps: RunEngineDeps,
  ctx: { runId: string; rows: Array<{ gridRowId: string; rowNumber: number; subject: SubjectRef }>; columns: RunColumn[]; asOf: string; userId: string },
): Promise<void> {
  const route = routeColumns(ctx.columns, deps.financial?.mode ?? "off");
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
      for (const column of route.producer) {
        await computeAndPersistCell(
          { db: deps.db, pool: deps.pool, reader: deps.reader },
          {
            column: column.entry,
            columnInstanceId: column.instance.column_instance_id,
            params: column.params,
            gridRowId,
            subject,
            period,
            asOf: ctx.asOf,
            userId: ctx.userId,
          },
        );
        await bumpCellDone(deps.db, ctx.runId);
      }
    });
    if (route.engine.length > 0 && deps.financial && deps.financial.mode !== "off") {
      await publishGridFinancialCells(deps.financial, {
        user_id: ctx.userId,
        grid_run_id: ctx.runId,
        knowledge_cutoff: ctx.asOf,
        mode: deps.financial.mode,
        rows: ctx.rows.map(({ rowNumber, subject }) => ({ rowNumber, subject })),
        instances: route.engine,
      });
    }
    // One completion rule for every run: completed only when every cell is a value; any gap,
    // unsupported, or error cell makes it partial. A cell still owed by another worker or by
    // recovery keeps the run open until the write that finishes it settles the run.
    await settleRunIfDone(deps.db, ctx.runId);
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
