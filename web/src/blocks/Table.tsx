import type { ReactElement } from 'react'
import type { TableBlock } from './types.ts'
import { formatTableCell } from './table.ts'

type TableProps = { block: TableBlock }

export function Table({ block }: TableProps): ReactElement {
  return (
    <div
      data-testid={`block-table-${block.id}`}
      data-block-kind="table"
      className="overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800"
    >
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-neutral-50 dark:bg-neutral-900">
          <tr>
            {block.columns.map((column, index) => (
              <th
                key={`${block.id}-col-${index}`}
                scope="col"
                className="border-b border-neutral-200 px-3 py-2 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400"
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
              className="border-t border-neutral-100 dark:border-neutral-800"
            >
              {row.map((cell, cellIndex) => (
                <td
                  key={`${block.id}-row-${rowIndex}-cell-${cellIndex}`}
                  className="px-3 py-2 text-neutral-800 dark:text-neutral-200"
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
