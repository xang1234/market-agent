// View helpers for certified financial answers. Nothing here formats, rounds,
// or compares financial values: labels come from the server, table order comes
// from the server's exact-decimal `ascending` permutation, and chart geometry
// is a bounded display projection that never feeds a calculation.

import {
  FINANCIAL_PRESENTATION_V1,
  SUPPORTED_FINANCIAL_PRESENTATION_VERSION,
  type FinancialAnswerBlock,
  type FinancialAnswerContent,
  type FinancialPresentedResult,
  type FinancialSeriesPresentation,
  type FinancialTablePresentation,
  type FinancialUnit,
} from './types.ts'

export function supportedFinancialContent(block: FinancialAnswerBlock): FinancialAnswerContent | null {
  const version = block.financial.presentation_version
  return version === SUPPORTED_FINANCIAL_PRESENTATION_VERSION || version === FINANCIAL_PRESENTATION_V1
    ? (block.financial as FinancialAnswerContent)
    : null
}

export function resultsById(content: FinancialAnswerContent): ReadonlyMap<string, FinancialPresentedResult> {
  return new Map(content.results.map((result) => [result.result_id, result]))
}

export function labelText(content: FinancialAnswerContent, labelId: string): string {
  return content.labels[labelId]?.text ?? ''
}

/** "Subject, measure, period" for a result; the subject is omitted for cross-subject results. */
export function resultLabel(content: FinancialAnswerContent, result: FinancialPresentedResult): string {
  const ids = [result.subject_label_id, result.measure_label_id, result.period_label_id]
  return ids.flatMap((id) => (id === null ? [] : [labelText(content, id)])).join(', ')
}

export type SortDirection = 'ascending' | 'descending'

/**
 * Row indexes for a column sort. Descending reverses only the rows that hold a
 * value; rows without one (gaps, missing cells) stay last either way. An
 * invalid server permutation falls back to the server's row order.
 */
export function sortedRowIndexes(
  table: FinancialTablePresentation,
  results: ReadonlyMap<string, FinancialPresentedResult>,
  columnId: string,
  direction: SortDirection,
): ReadonlyArray<number> {
  const natural = table.rows.map((_, index) => index)
  const order = table.ascending[columnId]
  if (!order || order.length !== natural.length || [...order].sort((a, b) => a - b).some((value, index) => value !== index)) {
    return natural
  }
  if (direction === 'ascending') return order
  const columnIndex = table.columns.findIndex((column) => column.column_id === columnId)
  const hasValue = (rowIndex: number) => {
    const cell = table.rows[rowIndex]?.cells[columnIndex]
    return cell != null && results.get(cell)?.presented.kind === 'value'
  }
  return [...order.filter(hasValue).reverse(), ...order.filter((rowIndex) => !hasValue(rowIndex))]
}

/**
 * Bar sizes in [0, 1] for a series, relative to the largest magnitude, and
 * each value's sign. Display-only: the canonical decimal is converted with
 * Number() here and nowhere else, and non-finite or non-value points get no bar.
 */
export function seriesBars(
  points: ReadonlyArray<FinancialPresentedResult | undefined>,
): ReadonlyArray<{ size: number; negative: boolean } | null> {
  const values = points.map((point) => {
    if (point?.presented.kind !== 'value') return null
    const value = Number(point.presented.value)
    return Number.isFinite(value) ? value : null
  })
  const max = Math.max(0, ...values.map((value) => Math.abs(value ?? 0)))
  return values.map((value) =>
    value === null ? null : { size: max === 0 ? 0 : Math.min(1, Math.abs(value) / max), negative: value < 0 },
  )
}

export function coverageText(content: FinancialAnswerContent): string {
  const { verified, requested, state } = content.coverage
  return state === 'complete'
    ? `All ${requested} requested results verified`
    : `${verified} of ${requested} requested results verified`
}

function unitLabel(unit: FinancialUnit): string {
  switch (unit.kind) {
    case 'currency':
      return unit.currency
    case 'currency_per_share':
      return `${unit.currency}/share`
    case 'percent':
      return '%'
    case 'percentage_points':
      return 'pp'
    case 'basis_points':
      return 'bp'
    case 'ratio':
    case 'shares':
      return unit.kind
    case 'count':
      return ''
  }
}

// Raw values paste into a spreadsheet as numbers. A column whose values share
// one unit names it in the header; a column that mixes units (USD and EUR
// revenue, say) gets a unit column beside it instead.
function csvCell(result: FinancialPresentedResult | undefined): string {
  if (!result) return ''
  return result.presented.kind === 'value' ? result.presented.value : result.presented.text
}

type CsvColumn = { header: string; cell: (result: FinancialPresentedResult | undefined) => string }

function valueColumns(heading: string, results: ReadonlyArray<FinancialPresentedResult | undefined>): CsvColumn[] {
  const units = new Set(results.flatMap((result) => (result?.presented.kind === 'value' ? [unitLabel(result.presented.unit)] : [])))
  const value: CsvColumn = { header: heading, cell: csvCell }
  if (units.size > 1) {
    return [value, { header: `${heading} unit`, cell: (result) => (result?.presented.kind === 'value' ? unitLabel(result.presented.unit) : '') }]
  }
  const [unit] = units
  return [{ ...value, header: unit === undefined || unit === '' ? heading : `${heading} (${unit})` }]
}

export function tableCsv(
  content: FinancialAnswerContent,
  table: FinancialTablePresentation,
  results: ReadonlyMap<string, FinancialPresentedResult>,
): string[][] {
  const resultAt = (row: FinancialTablePresentation['rows'][number], columnIndex: number) => {
    const id = row.cells[columnIndex]
    return id == null ? undefined : results.get(id)
  }
  const columns = table.columns.map((column, index) => {
    const measure = labelText(content, column.measure_label_id)
    const heading = column.period_label_id === null ? measure : `${measure}, ${labelText(content, column.period_label_id)}`
    const csvColumns = valueColumns(heading, table.rows.map((row) => resultAt(row, index)))
    if (column.period_label_id === null) {
      csvColumns.push({ header: `${measure} period`, cell: (result) => (result ? labelText(content, result.period_label_id) : '') })
    }
    return csvColumns
  })
  return [
    ['Company', ...columns.flat().map((column) => column.header)],
    ...table.rows.map((row) => [
      labelText(content, row.subject_label_id),
      ...columns.flatMap((csvColumns, index) => csvColumns.map((column) => column.cell(resultAt(row, index)))),
    ]),
  ]
}

export function seriesCsv(
  content: FinancialAnswerContent,
  series: FinancialSeriesPresentation,
  results: ReadonlyMap<string, FinancialPresentedResult>,
): string[][] {
  const points = series.points.map((point) => results.get(point.result_id))
  const heading = `${labelText(content, series.subject_label_id)}: ${labelText(content, series.measure_label_id)}`
  const columns = valueColumns(heading, points)
  return [
    ['Period', ...columns.map((column) => column.header)],
    ...series.points.map((point, index) => [labelText(content, point.period_label_id), ...columns.map((column) => column.cell(points[index]))]),
  ]
}
