// View helpers for certified financial answers. Nothing here formats, rounds,
// or compares financial values: labels come from the server, table order comes
// from the server's exact-decimal `ascending` permutation, and chart geometry
// is a bounded display projection that never feeds a calculation.

import {
  FINANCIAL_PRESENTATION_V1,
  FINANCIAL_PRESENTATION_V3,
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
  return version === SUPPORTED_FINANCIAL_PRESENTATION_VERSION || version === FINANCIAL_PRESENTATION_V1 || version === FINANCIAL_PRESENTATION_V3
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

/** A lead's measure and its two companies ("Gross margin (gross profit / revenue)", ["NVIDIA Corp", "Apple Inc."]), or null for any other result. */
export function leadParts(content: FinancialAnswerContent, result: FinancialPresentedResult): { measure: string; sides: [string, string] } | null {
  const measure = labelText(content, result.measure_label_id)
  const names = Object.values(content.labels).flatMap((label) => (label.kind === 'subject' ? [label.text] : [])).sort((a, b) => b.length - a.length)
  const sides = labelText(content, result.period_label_id).split(' minus ').map((side) => names.find((name) => side.startsWith(`${name} `)))
  if (result.subject_label_id !== null || !measure.startsWith('Difference in ') || sides.length !== 2 || sides.includes(undefined)) return null
  return { measure: measure.slice('Difference in '.length), sides: sides as [string, string] }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "FY2026 (ended 2026-09-03)" reads "FY2026 · ended Sep 2026"; the full label stays in the title. */
export function shortPeriod(text: string): string {
  return text.replace(/ \((ended|as of) (\d{4})-(\d{2})-\d{2}\)/g, (_, word: string, year: string, month: string) => ` · ${word} ${MONTHS[Number(month) - 1]} ${year}`)
}

/** Each text through shorten, unless two different texts would then read alike, which keep their whole text. */
function distinct(texts: ReadonlyArray<string>, shorten: (text: string) => string): string[] {
  let shown = texts.map(shorten)
  for (;;) {
    // A text kept whole can read as another's short form ("Acme Inc" beside "Acme Inc Ltd"), so repeat until none collide.
    const next = shown.map((name, i) => (shown.some((other, j) => other === name && texts[j] !== texts[i]) ? texts[i]! : name))
    if (next.every((name, i) => name === shown[i])) return next
    shown = next
  }
}

const HORIZON: Readonly<Record<string, string>> = { 'Quarter-over-quarter': 'QoQ', 'Year-over-year': 'YoY' }

/** A measure as a column heading: no formula ("Gross margin"), a quarter or year change by its abbreviation ("QoQ revenue", "YoY revenue change"). */
function columnName(measure: string): string {
  const name = measure.replace(/ \([^()]*\)$/, '')
  const change = /^(Quarter-over-quarter|Year-over-year) (percent change|change) in (.+)$/.exec(name)
  if (!change) return name
  const [, horizon, kind, of] = change as unknown as [string, string, string, string]
  const subject = /^[A-Z][a-z]/.test(of) ? `${of[0]!.toLowerCase()}${of.slice(1)}` : of
  return `${HORIZON[horizon]} ${subject}${kind === 'change' ? ' change' : ''}`
}

/** Each measure's column heading, unless two columns would then read alike. */
export function columnNames(measures: ReadonlyArray<string>): string[] {
  return distinct(measures, columnName)
}

/** Each company without its legal suffix ("Apple Inc." reads "Apple"), unless two would then read alike. */
export function shortNames(names: ReadonlyArray<string>): string[] {
  return distinct(names, (name) => name.replace(/,?(?: &)? (?:Inc|Incorporated|Corp|Corporation|Co|Company|Ltd|Limited|plc|PLC|LLC|N\.V|S\.A|SE|AG)\.?$/, ''))
}

/** Whether each column starts a new kind of figure (amounts, ratios, changes), so the table can set kinds apart. */
export function groupStarts(
  content: FinancialAnswerContent,
  table: FinancialTablePresentation,
  results: ReadonlyMap<string, FinancialPresentedResult>,
): boolean[] {
  const kinds = table.columns.map((column, index) => {
    if (/change in /i.test(labelText(content, column.measure_label_id))) return 'change'
    const value = table.rows.map((row) => results.get(row.cells[index] ?? '')?.presented).find((presented) => presented?.kind === 'value')
    return value?.kind === 'value' ? value.unit.kind : 'none'
  })
  return kinds.map((kind, index) => index > 0 && kind !== kinds[index - 1])
}

/** A period label read back where the engine joins a change's two: its own period and the one it is compared with ("Q4 FY2026 vs Q3 FY2026"). */
export function periodParts(text: string): { current: string; compared?: string } {
  const [current, compared, ...more] = text.split(' vs ')
  return compared === undefined || more.length > 0 ? { current: text } : { current: current!, compared }
}

/**
 * The one period every value in a row's undated columns reads, a change's
 * being the period it changed to, or null when they read several. A row with
 * no value reads its gaps' period.
 */
export function rowPeriod(
  content: FinancialAnswerContent,
  table: FinancialTablePresentation,
  row: FinancialTablePresentation['rows'][number],
  results: ReadonlyMap<string, FinancialPresentedResult>,
): string | null {
  const read = (kind: 'value' | 'gap') => new Set(row.cells.flatMap((cell, index) => {
    const result = cell == null || table.columns[index]?.period_label_id !== null ? undefined : results.get(cell)
    return result?.presented.kind === kind ? [periodParts(labelText(content, result.period_label_id)).current] : []
  }))
  const values = read('value')
  const periods = values.size > 0 ? values : read('gap')
  return periods.size === 1 ? [...periods][0]! : null
}

/** The distinct reasons of a row whose every cell is a gap, or null when one is not. */
export function gapReasons(row: FinancialTablePresentation['rows'][number], results: ReadonlyMap<string, FinancialPresentedResult>): string[] | null {
  const reasons = row.cells.map((cell) => {
    const presented = cell == null ? undefined : results.get(cell)?.presented
    return presented?.kind === 'gap' ? presented.text : null
  })
  return reasons.length > 0 && !reasons.includes(null) ? [...new Set(reasons as string[])] : null
}

/** What a cell shows of its period under its row's: nothing for the row's period, a change of it only its base ("vs Q3 FY2026"), any other period whole. */
export function cellPeriod(label: string, row: string | null): string | undefined {
  const { current, compared } = periodParts(label)
  if (current !== row) return shortPeriod(label)
  return compared === undefined ? undefined : `vs ${compared.replace(/ \((?:ended|as of) [^()]*\)$/, '')}`
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

export function tableCopyRows(
  content: FinancialAnswerContent,
  table: FinancialTablePresentation,
  results: ReadonlyMap<string, FinancialPresentedResult>,
  // The row order on screen, so a sorted table copies as it is shown.
  order: ReadonlyArray<number> = table.rows.map((_, index) => index),
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
    ...order.map((index) => table.rows[index]!).map((row) => [
      labelText(content, row.subject_label_id),
      ...columns.flatMap((csvColumns, index) => csvColumns.map((column) => column.cell(resultAt(row, index)))),
    ]),
  ]
}

export function seriesCopyRows(
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
