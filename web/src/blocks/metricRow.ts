import type { MetricCell } from './types.ts'

// Em-dash fallback keeps chip widths measuring before a value resolver
// fills in real numbers.
export function metricCellDisplayValue(cell: MetricCell): string {
  if (cell.format && cell.format.length > 0) return cell.format
  return '—'
}

export function metricCellHasDelta(cell: MetricCell): boolean {
  return (cell.delta_ref?.length ?? 0) > 0
}
