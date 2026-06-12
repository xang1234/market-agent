import { useEffect, useState, type ReactElement } from "react";
import { useAuth } from "../shell/useAuth.ts";
import { fetchColumns, createGrid, createRun } from "./gridsClient.ts";
import { resolveUniverseSpecInput } from "./resolveUniverseInput.ts";
import { EMPTY_UNIVERSE_OPTIONS, fetchUniverseOptions, type UniverseOptions } from "./universeOptions.ts";
import { gridsPageMemory } from "./gridsPageState.ts";
import { useGridRun } from "./useGridRun.ts";
import { GridBuilder, type GridBuilderSubmit } from "./GridBuilder.tsx";
import { GridTable } from "./GridTable.tsx";
import type { GridColumn } from "./gridsTypes.ts";

export function GridsPage(): ReactElement {
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const [columns, setColumns] = useState<GridColumn[]>([]);
  const [universeOptions, setUniverseOptions] = useState<UniverseOptions>(EMPTY_UNIVERSE_OPTIONS);
  // Seeded from module memory so the last run + table survive navigation.
  const [runId, setRunId] = useState<string | null>(gridsPageMemory.runId);
  const [activeColumns, setActiveColumns] = useState<GridColumn[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    fetchColumns({ userId })
      .then((cols) => {
        setColumns(cols);
        if (gridsPageMemory.activeColumnKeys.length > 0) {
          setActiveColumns(cols.filter((c) => gridsPageMemory.activeColumnKeys.includes(c.column_key)));
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "failed to load columns"));
    // Per-source failures already degrade to empty lists inside the fetch.
    fetchUniverseOptions({ userId }).then(setUniverseOptions);
  }, [userId]);

  const { detail } = useGridRun({ userId: userId ?? "", runId });

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
      gridsPageMemory.runId = run.runId;
      gridsPageMemory.activeColumnKeys = spec.column_specs.map((s) => s.column_key);
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
        defaults={gridsPageMemory.builder}
        onFieldsCapture={(fields) => {
          gridsPageMemory.builder = fields;
        }}
      />
      {error ? <div className="text-sm text-negative">{error}</div> : null}
      {detail ? (
        <div className="space-y-2">
          <div className="text-xs text-muted">
            {detail.run.status} · {detail.run.cell_done}/{detail.run.cell_total} cells
            {detail.run.dropped_row_count > 0 ? ` · ${detail.run.dropped_row_count} rows dropped (cap 25)` : ""}
          </div>
          <GridTable columns={activeColumns} detail={detail} />
        </div>
      ) : runId ? (
        <div className="text-sm text-muted">Running…</div>
      ) : null}
    </div>
  );
}
