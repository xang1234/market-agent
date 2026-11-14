// View helpers for certified financial answers. Nothing here formats, rounds,
// or compares financial values: labels come from the server, and chart
// geometry is a bounded display projection that never feeds a calculation.

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
import type { FinancialResultShown } from './financialInspection.ts'

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

/** What a value says it is, for the inspector's heading: its company, its measure without the formula (a lead's measure and two companies when it has no company), its short period, and its printed text. */
export function resultShown(content: FinancialAnswerContent, result: FinancialPresentedResult): FinancialResultShown | undefined {
  if (result.presented.kind !== 'value') return undefined
  const subject = result.subject_label_id === null ? null : labelText(content, result.subject_label_id)
  const lead = subject === null ? leadParts(content, result) : null
  const measure = lead !== null
    ? `${columnNames([lead.measure])[0]}, ${lead.sides.join(' minus ')}`
    : subject === null ? resultLabel(content, result) : columnNames([labelText(content, result.measure_label_id)])[0]!
  return { subject, measure, period: shortPeriod(labelText(content, result.period_label_id)) || null, value: result.presented.text }
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

const DATE = / \((ended|as of) (\d{4})-(\d{2})-\d{2}\)/g
const dateText = (word: string, year: string, month: string) => `${word} ${MONTHS[Number(month) - 1]} ${year}`

/** "FY2026 (ended 2026-09-03)" reads "FY2026 · ended Sep 2026"; the full label stays in the title. */
export function shortPeriod(text: string): string {
  return text.replace(DATE, (_, word: string, year: string, month: string) => ` · ${dateText(word, year, month)}`)
}

/**
 * A period without its end date ("Q2 FY2027"), and that date ("ended Jul 2026") when it names exactly one.
 * A trailing sum reads its quarters newest first, so it is named and dated by the newest ("4 quarters to Q4 FY2026").
 */
function datedPeriod(text: string): { fiscal: string; date: string | null } {
  const reads = text.split(' vs ')
  if (reads.length > 2) {
    const newest = datedPeriod(reads[0]!)
    const unit = reads.every((read) => /^Q[1-4] /.test(read)) ? 'quarters' : 'periods'
    return { fiscal: `${reads.length} ${unit} to ${newest.fiscal}`, date: newest.date }
  }
  const dates = [...text.matchAll(DATE)].map(([, word, year, month]) => dateText(word!, year!, month!))
  return { fiscal: text.replace(DATE, ''), date: dates.length === 1 ? dates[0]! : null }
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

/** Each company's full name to the short one the screen shows. */
export function companyNames(content: FinancialAnswerContent): ReadonlyMap<string, string> {
  const subjects = Object.values(content.labels).flatMap((label) => (label.kind === 'subject' ? [label.text] : []))
  const short = shortNames(subjects)
  return new Map(subjects.map((name, index) => [name, short[index]!]))
}

/** A period label read back where the engine joins a change's two: its own period and the one it is compared with ("Q4 FY2026 vs Q3 FY2026"). */
export function periodParts(text: string): { current: string; compared?: string } {
  const [current, compared, ...more] = text.split(' vs ')
  return compared === undefined || more.length > 0 ? { current: text } : { current: current!, compared }
}

/** What a change compares with: "the prior quarter", "the same quarter a year earlier", "the prior year", or else the base period itself. */
function baseOf(current: string, compared: string): string {
  const base = datedPeriod(compared).fiscal
  const [now, then] = [current, compared].map((text) => /^(?:Q([1-4]) )?(?:FY)?(\d{4})$/.exec(datedPeriod(text).fiscal))
  if (!now || !then || (now[1] === undefined) !== (then[1] === undefined)) return base
  const quarterly = now[1] !== undefined
  const index = (match: RegExpExecArray) => Number(match[2]) * 4 + Number(match[1] ?? 0)
  const step = index(now) - index(then)
  if (quarterly && step === 1) return 'the prior quarter'
  if (step === 4) return quarterly ? 'the same quarter a year earlier' : 'the prior year'
  return base
}

export type StatementCell = {
  result: FinancialPresentedResult | undefined
  // The cell's fiscal period, only where it differs from its company's.
  period: string | null
}

export type StatementRow = { key: string; label: string; measure: string; cells: ReadonlyArray<StatementCell>; difference?: FinancialPresentedResult }

/** A table pivoted to read like a financial statement: companies across, measures down in sections, every date in the footnotes. */
export type Statement = {
  companies: ReadonlyArray<{ subjectId: string; name: string; short: string; period: string | null }>
  // The one fiscal period every company reads, said once above the table instead of under each company.
  sharedPeriod: string | null
  sections: ReadonlyArray<{ title: string | null; rows: ReadonlyArray<StatementRow> }>
  // The short names a Difference column subtracts, in order, when the answer's leads fold into one.
  differenceSides: readonly [string, string] | null
  footnotes: ReadonlyArray<string>
  foldedLeads: ReadonlySet<string>
}

type FigureKind = 'amount' | 'ratio' | 'change'

const RATIO_UNITS: ReadonlySet<FinancialUnit['kind']> = new Set(['percent', 'ratio', 'percentage_points', 'basis_points'])

function figureKind(row: StatementRow): FigureKind {
  if (/change in /i.test(row.measure)) return 'change'
  const value = row.cells.map((cell) => cell.result?.presented).find((presented) => presented?.kind === 'value')
  if (value?.kind === 'value') return RATIO_UNITS.has(value.unit.kind) ? 'ratio' : 'amount'
  return /margin|ratio/i.test(row.measure) ? 'ratio' : 'amount'
}

function sectionTitle(kind: FigureKind, rows: ReadonlyArray<StatementRow>): string {
  if (kind === 'change') return 'Growth'
  if (kind === 'amount') return 'Amounts'
  return rows.every((row) => /\bmargin\b/i.test(row.measure)) ? 'Margins' : 'Ratios'
}

export function statementOf(
  content: FinancialAnswerContent,
  table: FinancialTablePresentation,
  results: ReadonlyMap<string, FinancialPresentedResult>,
  // The answer's leads between two companies, which fold into a Difference column when they all fit this table.
  leads: ReadonlyArray<FinancialPresentedResult>,
): Statement {
  const shortOf = companyNames(content)
  const periodOf = (result: FinancialPresentedResult) => labelText(content, result.period_label_id)
  const resultAt = (cell: string | null | undefined) => (cell == null ? undefined : results.get(cell))
  // Each company's one period across its undated values (its gaps' when it has none), or null when they read several.
  const own = table.rows.map((row) => {
    const read = (kind: 'value' | 'gap') => new Set(row.cells.flatMap((cell, index) => {
      const result = table.columns[index]?.period_label_id === null ? resultAt(cell) : undefined
      return result?.presented.kind === kind ? [periodParts(periodOf(result)).current] : []
    }))
    const values = read('value')
    const periods = values.size > 0 ? values : read('gap')
    return periods.size === 1 ? [...periods][0]! : null
  })
  const companies = table.rows.map((row, index) => {
    const name = labelText(content, row.subject_label_id)
    const period = own[index]
    return { subjectId: row.subject_label_id, name, short: shortOf.get(name) ?? name, period: period === null ? null : datedPeriod(period).fiscal }
  })
  const periods = new Set(companies.map((company) => company.period))
  const sharedPeriod = periods.size === 1 ? [...periods][0]! : null

  const measures = table.columns.map((column) => labelText(content, column.measure_label_id))
  const names = columnNames(measures)
  const rows: StatementRow[] = table.columns.map((column, index) => ({
    key: column.column_id,
    label: column.period_label_id === null ? names[index]! : `${names[index]}, ${datedPeriod(labelText(content, column.period_label_id)).fiscal}`,
    measure: measures[index]!,
    cells: table.rows.map((row, company) => {
      const result = resultAt(row.cells[index])
      const current = result === undefined || column.period_label_id !== null ? null : periodParts(periodOf(result)).current
      return { result, period: current === null || current === own[company] ? null : datedPeriod(current).fiscal }
    }),
  }))

  // Leads fold only all together, each beside the two values it subtracts.
  const sides = leads[0] === undefined ? undefined : leadParts(content, leads[0])?.sides
  const fullNames = companies.map((company) => company.name)
  const spots = companies.length === 2 && sides !== undefined && new Set(sides).size === 2 && sides.every((side) => fullNames.includes(side))
    ? leads.map((lead) => {
      const parts = leadParts(content, lead)
      if (parts === null || parts.sides.join('\n') !== sides.join('\n')) return -1
      const sideTexts = periodOf(lead).split(' minus ')
      return rows.findIndex((row) => row.measure === parts.measure && parts.sides.every((side, at) => {
        const result = row.cells[fullNames.indexOf(side)]?.result
        return result !== undefined && sideTexts[at] === `${side} ${periodOf(result)}`
      }))
    })
    : []
  const folds = spots.length > 0 && !spots.includes(-1) && new Set(spots).size === spots.length
  if (folds) spots.forEach((spot, index) => { rows[spot]!.difference = leads[index] })

  const kinds = new Map<FigureKind, StatementRow[]>()
  for (const row of rows) {
    const kind = figureKind(row)
    kinds.set(kind, [...(kinds.get(kind) ?? []), row])
  }
  const sections = [...kinds].map(([kind, members]) => ({ title: kinds.size === 1 ? null : sectionTitle(kind, members), rows: members }))

  return {
    companies,
    sharedPeriod,
    sections,
    differenceSides: folds ? [shortOf.get(sides![0]) ?? sides![0], shortOf.get(sides![1]) ?? sides![1]] : null,
    footnotes: footnotesOf(companies, rows, own, periodOf),
    foldedLeads: new Set(folds ? leads.map((lead) => lead.result_id) : []),
  }
}

/** Each company's end dates, what its changes compare with, and each distinct gap reason, each said once. */
function footnotesOf(
  companies: Statement['companies'],
  rows: ReadonlyArray<StatementRow>,
  own: ReadonlyArray<string | null>,
  periodOf: (result: FinancialPresentedResult) => string,
): string[] {
  const dates = companies.flatMap((company, index) => {
    const periods = [own[index], ...rows.map((row) => row.cells[index]?.result).map((result) => result && periodParts(periodOf(result)).current)]
    const dated = new Set(periods.flatMap((period) => {
      const { fiscal, date } = period ? datedPeriod(period) : { fiscal: '', date: null }
      return date === null ? [] : [`${fiscal} ${date}`]
    }))
    return dated.size === 0 ? [] : [`${company.short} ${[...dated].join(', ')}`]
  })
  const bases = new Map<string, Set<string>>()
  for (const row of rows) {
    const horizon = /^(Quarter-over-quarter|Year-over-year) /.exec(row.measure)?.[1]
    const subject = horizon === undefined ? row.label : HORIZON[horizon]!
    // A gap may name an unbound base ("fiscal quarter 1 before latest"), so only values say what a change compares with.
    for (const { result } of row.cells) {
      const { current, compared } = result?.presented.kind === 'value' ? periodParts(periodOf(result)) : { current: '' }
      if (compared !== undefined) bases.set(subject, (bases.get(subject) ?? new Set()).add(baseOf(current, compared)))
    }
  }
  const compares = [...bases].flatMap(([subject, phrases]) => (phrases.size === 1 ? [[subject, [...phrases][0]!] as const] : []))
    .map(([subject, phrase], index) => `${subject} ${index === 0 ? 'compares ' : ''}with ${phrase}`)
  const reasons = new Set(rows.flatMap((row) => [...row.cells.map((cell) => cell.result), row.difference])
    .flatMap((result) => (result?.presented.kind === 'gap' ? [result.presented.text] : [])))
  return [
    [dates.length === 0 ? '' : `${dates.join('; ')}.`, compares.length === 0 ? '' : `${compares.join(', ')}.`].filter(Boolean).join(' '),
    ...[...reasons].map((reason) => `— ${reason}`),
  ].filter(Boolean)
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
  // The leads shown in the table's Difference column, by column, copied as one more row.
  differences: ReadonlyMap<string, FinancialPresentedResult> = new Map(),
): string[][] {
  const resultAt = (row: FinancialTablePresentation['rows'][number], columnIndex: number) => {
    const id = row.cells[columnIndex]
    return id == null ? undefined : results.get(id)
  }
  const columns = table.columns.map((column, index) => {
    const measure = labelText(content, column.measure_label_id)
    const heading = column.period_label_id === null ? measure : `${measure}, ${labelText(content, column.period_label_id)}`
    const csvColumns = valueColumns(heading, [...table.rows.map((row) => resultAt(row, index)), differences.get(column.column_id)])
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
    ...differenceRow(),
  ]

  function differenceRow(): string[][] {
    const [first] = differences.values()
    const sides = first === undefined ? null : leadParts(content, first)?.sides
    if (!sides) return []
    return [[
      `Difference (${sides.join(' minus ')})`,
      ...columns.flatMap((csvColumns, index) => csvColumns.map((column) => column.cell(differences.get(table.columns[index]!.column_id)))),
    ]]
  }
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
