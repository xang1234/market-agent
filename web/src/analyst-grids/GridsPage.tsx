import { useEffect, useState, type ReactElement } from "react";
import { useAuth } from "../shell/useAuth.ts";
import { fetchColumns, createGrid, createRun } from "./gridsClient.ts";
import { resolveUniverseSpecInput } from "./resolveUniverseInput.ts";
import { EMPTY_UNIVERSE_OPTIONS, fetchUniverseOptions, type UniverseOptions } from "./universeOptions.ts";
import { gridsPageMemoryFor } from "./gridsPageState.ts";
import { useGridRun } from "./useGridRun.ts";
import { GridBuilder, type GridBuilderSubmit } from "./GridBuilder.tsx";
import { GridTable } from "./GridTable.tsx";
import type { GridColumn, GridRunSummary } from "./gridsTypes.ts";

export function GridsPage(): ReactElement {
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const [columns, setColumns] = useState<GridColumn[]>([]);
  const [universeOptions, setUniverseOptions] = useState<UniverseOptions>(EMPTY_UNIVERSE_OPTIONS);
  // Seeded from the current user's module memory so the last run + table
  // survive navigation (without bleeding across accounts).
  const [runId, setRunId] = useState<string | null>(userId ? gridsPageMemoryFor(userId).runId : null);
  const [activeColumns, setActiveColumns] = useState<GridColumn[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    const memory = gridsPageMemoryFor(userId);
    fetchColumns({ userId })
      .then((cols) => {
        setColumns(cols);
        if (memory.activeColumnKeys.length > 0) {
          setActiveColumns(cols.filter((c) => memory.activeColumnKeys.includes(c.column_key)));
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "failed to load columns"));
    // Per-source failures already degrade to empty lists inside the fetch.
    fetchUniverseOptions({ userId }).then(setUniverseOptions);
  }, [userId]);

  // Poll only when authenticated — a remembered runId must not poll with "".
  const { detail } = useGridRun({ userId: userId ?? "", runId: userId ? runId : null });

  async function onSubmit(spec: GridBuilderSubmit) {
    if (!userId) return;
    setError(null);
    try {
      // Typed tickers (manual entries, peers issuer) become issuer uuids here;
      // UnresolvedTickersError lands in the error banner naming the inputs.
      const universe_spec = await resolveUniverseSpecInput(spec.universe_spec);
      const grid = await createGrid({ userId, body: { name: "Untitled grid", universe_spec, column_specs: spec.column_specs } });
      const run = await createRun({ userId, gridId: grid.grid_id });
      setActiveColumns(columns.filter((c) => spec.column_specs.some((s) => s.column_key === c.column_key)));
      setRunId(run.runId);
      const memory = gridsPageMemoryFor(userId);
      memory.runId = run.runId;
      memory.activeColumnKeys = spec.column_specs.map((s) => s.column_key);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to start run");
    }
  }

  if (!userId) return <div className="p-4 text-sm text-muted">Sign in to build research grids.</div>;

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-lg font-semibold">Analyst Grid</h1>
      <GridBuilder
        columns={columns}
        universeOptions={universeOptions}
        onSubmit={onSubmit}
        defaults={gridsPageMemoryFor(userId).builder}
        onFieldsCapture={(fields) => {
          gridsPageMemoryFor(userId).builder = fields;
        }}
      />
      {error ? <div className="text-sm text-negative">{error}</div> : null}
      {detail ? (
        <div className="space-y-2">
          <GridRunProgress run={detail.run} />
          <GridTable columns={activeColumns} detail={detail} />
        </div>
      ) : runId ? (
        <div className="text-sm text-muted">Running…</div>
      ) : null}
    </div>
  );
}

// Run status + a fill bar over cell completion. The grid already fills in
// cell-by-cell; the bar gives the at-a-glance "how far along" the text line
// alone couldn't.
function GridRunProgress({ run }: { run: GridRunSummary }): ReactElement {
  const pct = run.cell_total > 0 ? run.cell_done / run.cell_total : 0;
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted">
        {run.status} · <span className="num text-fg">{run.cell_done}/{run.cell_total}</span> cells ·{" "}
        <span className="num">{Math.round(pct * 100)}%</span>
        {run.dropped_row_count > 0 ? ` · ${run.dropped_row_count} rows dropped (cap 25)` : ""}
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-sm bg-surface-2"
        role="img"
        aria-label={`${run.cell_done} of ${run.cell_total} cells complete`}
      >
        <div
          className="h-full rounded-sm bg-accent transition-[width] duration-300"
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}
