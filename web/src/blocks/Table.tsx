import type { ReactElement } from 'react'
import type { TableBlock } from './types.ts'
import { formatTableCell } from './table.ts'

type TableProps = { block: TableBlock }

export function Table({ block }: TableProps): ReactElement {
  return (
    <div
      data-testid={`block-table-${block.id}`}
      data-block-kind="table"
      className="overflow-x-auto rounded-lg border border-line"
    >
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-surface-2">
          <tr>
            {block.columns.map((column, index) => (
              <th
                key={`${block.id}-col-${index}`}
                scope="col"
                className="border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr
              key={`${block.id}-row-${rowIndex}`}
              data-testid={`block-table-${block.id}-row-${rowIndex}`}
              className="border-t border-line"
            >
              {row.map((cell, cellIndex) => (
                <td
                  key={`${block.id}-row-${rowIndex}-cell-${cellIndex}`}
                  className="num px-3 py-2 text-fg"
                >
                  {formatTableCell(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
