import type { ReactElement } from "react";
import { useEvidenceInspector } from "../evidence/useEvidenceInspector.ts";
import type { EvidenceInspectionRef } from "../evidence/inspectionTypes.ts";
import type { GridColumn, GridCellDetail, GridRunDetail } from "./gridsTypes.ts";
import { VerificationLabel } from "../blocks/VerificationLabel.tsx";
import type { FinancialAnswerContent } from "../blocks/types.ts";

/** A column as the table shows it: the run's frozen instance, labelled from the catalog. */
type TableColumn = { id: string; label: string };

/**
 * The run's own columns, in order. A run records its column instances when it
 * starts, so an edited grid or a repeated column still lines up with its cells;
 * older runs fall back to the grid's catalog columns keyed by column key.
 */
function tableColumns(columns: ReadonlyArray<GridColumn>, detail: GridRunDetail): TableColumn[] {
  const labels = new Map(columns.map((column) => [column.column_key, column.label]));
  const instances = detail.run.column_instances;
  if (!instances || instances.length === 0) return columns.map((column) => ({ id: column.column_key, label: column.label }));
  return [...instances]
    .sort((left, right) => left.position - right.position)
    .map((instance) => ({ id: instance.column_instance_id, label: labels.get(instance.column_key) ?? instance.column_key }));
}

function cellKey(rowId: string, columnId: string): string {
  return `${rowId}::${columnId}`;
}

type GridTableProps = { columns: ReadonlyArray<GridColumn>; detail: GridRunDetail };

export function GridTable({ columns, detail }: GridTableProps): ReactElement {
  const shown = tableColumns(columns, detail);
  const byKey = new Map<string, GridCellDetail>();
  for (const c of detail.cells) byKey.set(cellKey(c.grid_row_id, c.column_instance_id ?? c.column_key), c);

  return (
    <div data-testid="analyst-grid-table" className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-surface-2">
          <tr>
            <th scope="col" className="border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">Subject</th>
            {shown.map((col) => (
              <th key={col.id} scope="col" className="border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {detail.rows.map((row) => (
            <tr key={row.grid_row_id} className="border-t border-line">
              <td className="px-3 py-2 text-fg">{row.subject_label ?? row.subject_ref.id}</td>
              {shown.map((col) => (
                <GridCell key={col.id} cell={byKey.get(cellKey(row.grid_row_id, col.id))} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

function cellText(cell: GridCellDetail | undefined): string {
  if (!cell || cell.status === "pending") return "…";
  if (cell.status === "error") return "error";
  return cell.display?.value ?? "—";
}

/** The certified result a numerical cell shows, when its block is in a format this client knows. */
function certifiedResultId(cell: GridCellDetail | undefined): string | null {
  const content = cell?.financial_block?.financial as Partial<FinancialAnswerContent> | undefined;
  return content?.results?.[0]?.result_id ?? null;
}

/** Why a cell has no value, in words, for assistive technology; the row itself never disappears. */
function gapText(cell: GridCellDetail | undefined): string | null {
  if (!cell || cell.status === "ok" || cell.status === "pending") return null;
  return cell.coverage_flag ? `Not available: ${cell.coverage_flag.replaceAll("_", " ")}` : "Not available";
}

/**
 * One cell. A certified value opens the shared calculation inspector and is
 * labelled verified; an evidence-backed value opens the evidence inspector;
 * anything else is text. Real buttons, so cells are reachable by keyboard.
 */
function GridCell({ cell }: { cell: GridCellDetail | undefined }): ReactElement {
  const inspector = useEvidenceInspector();
  const tone = cell?.display?.tone ? TONE_CLASS[cell.display.tone] : { text: "", bg: "" };
  const certified = certifiedResultId(cell);
  const evidence = cell?.snapshot_id && cell.primary_ref ? { snapshotId: cell.snapshot_id, ref: cell.primary_ref as EvidenceInspectionRef } : null;
  const gap = gapText(cell);
  const buttonClass = `num text-left text-fg underline decoration-dotted${tone.text}`;
  const open = certified !== null && inspector?.openFinancialResult
    ? () => inspector.openFinancialResult?.(certified)
    : evidence
      ? () => inspector?.openInspection(evidence)
      : null;

  return (
    <td
      className={`px-3 py-2${tone.bg}`}
      data-cell-status={cell?.status ?? "pending"}
      data-cell-inspectable={evidence ? "true" : "false"}
      data-snapshot-id={cell?.snapshot_id ?? undefined}
      data-certified={cell?.financial_block ? "true" : "false"}
    >
      {open ? (
        <button
          type="button"
          className={buttonClass}
          aria-label={certified !== null ? `Inspect the verified calculation: ${cellText(cell)}` : undefined}
          onClick={open}
        >
          {cellText(cell)}
        </button>
      ) : (
        <span className={`num text-fg${tone.text}`}>{cellText(cell)}</span>
      )}
      {cell?.financial_block && cell.status === "ok" ? (
        <span className="ml-2 align-middle">
          <VerificationLabel kind="verified" />
        </span>
      ) : null}
      {gap ? <span className="sr-only">{gap}</span> : null}
    </td>
  );
}
