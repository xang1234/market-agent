import type { ReactElement } from "react";
import { useEvidenceInspector } from "../evidence/useEvidenceInspector.ts";
import type { EvidenceInspectionRef } from "../evidence/inspectionTypes.ts";
import type { GridColumn, GridCellDetail, GridRunDetail } from "./gridsTypes.ts";

function cellKey(rowId: string, columnKey: string): string {
  return `${rowId}::${columnKey}`;
}

function cellText(cell: GridCellDetail | undefined): string {
  if (!cell || cell.status === "pending") return "…";
  if (cell.status === "error") return "error";
  return cell.display?.value ?? "—";
}

// Per-tone classes: the value's text colour and the cell's background tint.
// Shading the cell turns the matrix into a scannable heatmap (a row of green vs
// a row of red reads in one pass); the text colour keeps the value legible on
// the tint. One map so the two never drift. Leading spaces let callers
// concatenate into a className template.
const TONE_CLASS: Readonly<Record<"best" | "worst", { text: string; bg: string }>> = {
  best: { text: " text-positive", bg: " bg-positive-soft" },
  worst: { text: " text-negative", bg: " bg-negative-soft" },
};

function toneClasses(cell: GridCellDetail | undefined): { text: string; bg: string } {
  const tone = cell?.display?.tone;
  return tone ? TONE_CLASS[tone] : { text: "", bg: "" };
}

type GridTableProps = { columns: ReadonlyArray<GridColumn>; detail: GridRunDetail };

export function GridTable({ columns, detail }: GridTableProps): ReactElement {
  const inspector = useEvidenceInspector();
  const byKey = new Map<string, GridCellDetail>();
  for (const c of detail.cells) byKey.set(cellKey(c.grid_row_id, c.column_key), c);

  return (
    <div data-testid="analyst-grid-table" className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-surface-2">
          <tr>
            <th scope="col" className="border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">Subject</th>
            {columns.map((col) => (
              <th key={col.column_key} scope="col" className="border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {detail.rows.map((row) => (
            <tr key={row.grid_row_id} className="border-t border-line">
              <td className="px-3 py-2 text-fg">{row.subject_label ?? row.subject_ref.id}</td>
              {columns.map((col) => {
                const cell = byKey.get(cellKey(row.grid_row_id, col.column_key));
                const inspectable = Boolean(cell && cell.snapshot_id && cell.primary_ref);
                const tone = toneClasses(cell);
                return (
                  <td
                    key={col.column_key}
                    className={`px-3 py-2${tone.bg}`}
                    data-cell-status={cell?.status ?? "pending"}
                    data-cell-inspectable={inspectable ? "true" : "false"}
                    data-snapshot-id={cell?.snapshot_id ?? undefined}
                  >
                    {inspectable && cell?.snapshot_id && cell.primary_ref ? (
                      // A real button so the cell is keyboard-operable (Enter/
                      // Space) and reachable by tab — a clickable <td> is not.
                      <button
                        type="button"
                        className={`num text-left text-fg underline decoration-dotted${tone.text}`}
                        onClick={() =>
                          inspector?.openInspection({
                            snapshotId: cell.snapshot_id as string,
                            ref: cell.primary_ref as EvidenceInspectionRef,
                          })
                        }
                      >
                        {cellText(cell)}
                      </button>
                    ) : (
                      <span className={`num text-fg${tone.text}`}>{cellText(cell)}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
