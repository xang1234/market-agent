import type { TableCellValue } from './types.ts'

// Tables ship with arbitrary string|number|object cells per the JSON
// schema. The renderer prints strings/numbers verbatim and JSON-stringifies
// objects so a misshapen object cell never crashes the surface and stays
// debuggable in dev.
export function formatTableCell(value: TableCellValue): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—'
  return JSON.stringify(value)
}
