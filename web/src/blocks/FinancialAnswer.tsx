import { useContext, useState, type ReactElement, type ReactNode } from 'react'
import { ChartCard } from './ChartCard.tsx'
import { CopyButton } from './CopyButton.tsx'
import { provenanceRow, toTsv } from './tableCopy.ts'
import { InspectableResult } from '../evidence/InspectableResult.tsx'
import { BlockProofContext } from './blockProof.ts'
import { VerificationLabel } from './VerificationLabel.tsx'
import {
  cellPeriod,
  columnNames,
  coverageText,
  gapReasons,
  groupStarts,
  labelText,
  leadParts,
  shortNames,
  resultLabel,
  resultsById,
  rowPeriod,
  seriesBars,
  shortPeriod,
  seriesCopyRows,
  tableCopyRows,
  sortedRowIndexes,
  supportedFinancialContent,
  type SortDirection,
} from './financialAnswer.ts'
import type {
  FinancialAnswerBlock,
  FinancialAnswerContent,
  FinancialPresentation,
  FinancialPresentedResult,
  FinancialScenariosPresentation,
  FinancialSeriesPresentation,
  FinancialTablePresentation,
} from './types.ts'

type FinancialAnswerProps = { block: FinancialAnswerBlock }

// Renders a certified financial answer by printing server-generated strings.
// A presentation version this client does not know renders a notice and no
// values, so an unrecognized payload is never shown as verified content.
export function FinancialAnswer({ block }: FinancialAnswerProps): ReactElement {
  const content = supportedFinancialContent(block)
  // Where the server assessed this block (chat), its certificate decides the
  // claims; a block without one is never shown as verified (#193).
  const proof = useContext(BlockProofContext)
  const certified = proof === null || proof.calculation === 'verified'
  if (content === null) {
    return (
      <ChartCard testId={`block-financial-answer-${block.id}`} blockKind="financial_answer" title={undefined} dataAttrs={{ 'data-certified': 'false' }}>
        {/* The values are not shown, but the server's claims about them still are. */}
        {proof === null ? <VerificationLabel kind="legacy" /> : <VerificationLabel kind={proof.calculation === 'verified' ? 'verified' : 'not_verified'} />}
        {proof?.public_by_cutoff === 'proven' ? <VerificationLabel kind="public_by_cutoff" /> : null}
        <p role="note" className="text-sm text-muted" data-testid={`block-financial-answer-${block.id}-unsupported`}>
          This financial answer uses a newer format than this app supports. Refresh or update to view it.
        </p>
      </ChartCard>
    )
  }
  const results = resultsById(content)
  const subjects = Object.values(content.labels).flatMap((label) => (label.kind === 'subject' ? [label.text] : []))
  const short = shortNames(subjects)
  const names = new Map(subjects.map((name, index) => [name, short[index]!]))
  return (
    <ChartCard testId={`block-financial-answer-${block.id}`} blockKind="financial_answer" title={undefined} dataAttrs={{ 'data-certified': String(certified) }}>
      <div className="flex flex-wrap items-center gap-2">
        <VerificationLabel kind={certified ? 'verified' : 'not_verified'} />
        {proof?.public_by_cutoff === 'proven' ? <VerificationLabel kind="public_by_cutoff" /> : null}
        {content.coverage.state === 'complete' ? null : <VerificationLabel kind="partial" />}
        <p className="text-xs text-muted" data-testid={`block-financial-answer-${block.id}-coverage`} data-coverage={content.coverage.state}>
          {coverageText(content)}
        </p>
      </div>
      {withLeadsTogether(content, results).map((part, index) =>
        Array.isArray(part) ? (
          <Leads key={`${block.id}-p${index}`} content={content} names={names} leads={part} />
        ) : (
          <PresentationView key={`${block.id}-p${index}`} blockId={block.id} provenance={provenanceRow(block)} content={content} results={results} names={names} presentation={part} />
        ),
      )}
    </ChartCard>
  )
}

type Results = ReadonlyMap<string, FinancialPresentedResult>
// Each company's full name to the short one the screen shows.
type Names = ReadonlyMap<string, string>

// Consecutive leads between two companies render as one block; every other presentation as itself.
function withLeadsTogether(content: FinancialAnswerContent, results: Results): Array<FinancialPresentation | FinancialPresentedResult[]> {
  const parts: Array<FinancialPresentation | FinancialPresentedResult[]> = []
  for (const presentation of content.presentations) {
    const result = presentation.kind === 'scalar' ? results.get(presentation.result_id) : undefined
    const last = parts.at(-1)
    if (result === undefined || leadParts(content, result) === null) parts.push(presentation)
    else if (Array.isArray(last)) last.push(result)
    else parts.push([result])
  }
  return parts
}

type PresentationViewProps = {
  blockId: string
  // Ends a copied table, so pasted figures keep their as-of date and snapshot.
  provenance: ReadonlyArray<string>
  content: FinancialAnswerContent
  results: Results
  names: Names
  presentation: FinancialPresentation
}

function PresentationView({ blockId, provenance, content, results, names, presentation }: PresentationViewProps): ReactElement | null {
  if (presentation.kind === 'table') return <CertifiedTable blockId={blockId} provenance={provenance} content={content} results={results} names={names} table={presentation} />
  if (presentation.kind === 'series') return <CertifiedSeries provenance={provenance} content={content} results={results} series={presentation} />
  if (presentation.kind === 'scenarios') return <CertifiedScenarios blockId={blockId} content={content} results={results} scenarios={presentation} />
  const result = results.get(presentation.result_id)
  if (!result) return null
  return <ResultLine content={content} result={result} />
}

const RESULT_ROW_CLASS = 'flex items-baseline justify-between gap-4 border-t border-line py-1.5 text-sm'

function ResultLine({ content, result, badge }: { content: FinancialAnswerContent; result: FinancialPresentedResult; badge?: ReactNode }): ReactElement {
  const { presented } = result
  const label = resultLabel(content, result)
  if (presented.kind === 'value') {
    return (
      <p className={`${RESULT_ROW_CLASS} text-fg`} data-result-id={result.result_id}>
        <span className="text-muted">{label}: {badge}</span>
        <InspectableResult resultId={result.result_id} label={`${label}: ${presented.full_text}`} className={VALUE_BUTTON}>
          <span className="whitespace-nowrap tabular-nums" title={presented.full_text} aria-label={`${label}: ${presented.full_text}`}>
            {presented.text}
          </span>
        </InspectableResult>
      </p>
    )
  }
  if (presented.kind === 'gap') {
    return (
      <p className={`${RESULT_ROW_CLASS} text-muted`} data-result-id={result.result_id} data-result-kind="gap">
        <span>{label}: {badge}</span>
        <span className="italic">{presented.text}</span>
      </p>
    )
  }
  return (
    <p className="text-sm text-fg" data-result-id={result.result_id} data-result-kind={presented.kind}>
      {presented.text}
    </p>
  )
}

function LeadValue({ content, result }: { content: FinancialAnswerContent; result: FinancialPresentedResult }): ReactElement {
  const { presented } = result
  const label = resultLabel(content, result)
  // A gap opens no inspector, so it names its own periods.
  if (presented.kind !== 'value') {
    const period = shortPeriod(labelText(content, result.period_label_id))
    return <Cell result={result} period={period} shown={period} />
  }
  // The whole label names each company's period, which the matrix headings leave out.
  return (
    <InspectableResult resultId={result.result_id} label={`${label}: ${presented.full_text}`} className={VALUE_BUTTON}>
      <span title={`${label}: ${presented.full_text}`} aria-label={`${label}: ${presented.full_text}`}>{presented.text}</span>
    </InspectableResult>
  )
}

// Leads between two companies, laid out as measures against pairs ("Gross margin" by "Micron Technology − NVIDIA").
// When they do not fill such a grid once each, every lead takes a row naming its own periods.
function Leads({ content, names, leads }: { content: FinancialAnswerContent; names: Names; leads: ReadonlyArray<FinancialPresentedResult> }): ReactElement {
  const parts = leads.map((result) => leadParts(content, result)!)
  const pairOf = (index: number) => parts[index]!.sides.join(' minus ')
  const measureIds = [...new Set(leads.map((result) => result.measure_label_id))]
  const headings = columnNames(measureIds.map((id) => parts[leads.findIndex((result) => result.measure_label_id === id)]!.measure))
  const heading = (result: FinancialPresentedResult) => headings[measureIds.indexOf(result.measure_label_id)]
  const count = (keys: ReadonlyArray<string>) => new Set(keys).size
  // A period label names its pair, so a pair reads one period exactly when the two counts match.
  const grid = count(leads.map((result) => `${result.measure_label_id} ${result.period_label_id}`)) === leads.length
    && count(leads.map((result) => result.period_label_id)) === count(leads.map((_, index) => pairOf(index)))
  const pairs = [...new Map(leads.map((_, index) => [pairOf(index), parts[index]!.sides])).entries()]
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="border-separate border-spacing-0 text-left text-sm tabular-nums">
        <caption className="sr-only">Differences between companies</caption>
        <thead>
          <tr>
            <th scope="col" className={`${HEAD} pr-8`}>Difference</th>
            {grid ? pairs.map(([pair, sides]) => (
              <th key={pair} scope="col" className={`${HEAD} pl-8 text-right`} title={pair}>
                {sides.map((side) => names.get(side) ?? side).join(' − ')}
              </th>
            )) : (
              <>
                <th scope="col" className={`${HEAD} pl-8`}>Between</th>
                <th scope="col" className={`${HEAD} pl-8 text-right`}>Value</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {grid ? measureIds.map((id, row) => (
            <tr key={id} className="group/row">
              <th scope="row" className={`${CELL} pr-8 font-medium text-fg`}>{headings[row]}</th>
              {pairs.map(([pair]) => {
                const result = leads.find((lead, index) => lead.measure_label_id === id && pairOf(index) === pair)
                return (
                  <td key={pair} className={`${CELL} whitespace-nowrap pl-8 text-right text-fg`} data-result-id={result?.result_id}>
                    {result ? <LeadValue content={content} result={result} /> : null}
                  </td>
                )
              })}
            </tr>
          )) : leads.map((result) => (
            <tr key={result.result_id} className="group/row">
              <th scope="row" className={`${CELL} pr-8 font-medium text-fg`}>{heading(result)}</th>
              <td className={`${CELL} pl-8 text-muted`}>{shortPeriod(labelText(content, result.period_label_id))}</td>
              <td className={`${CELL} whitespace-nowrap pl-8 text-right text-fg`} data-result-id={result.result_id}>
                <LeadValue content={content} result={result} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// period names the cell to the inspector; shown is what the cell prints of it (cellPeriod), the whole period its title. A gap's reason is its title and its screen-reader text.
function Cell({ result, period, shown }: { result: FinancialPresentedResult | undefined; period?: string; shown?: string }): ReactElement {
  if (!result) return <span className="text-muted">Not requested</span>
  const { presented } = result
  const note = shown === undefined ? null : <span className="block text-xs text-muted" title={shown === period ? undefined : period}>{shown}</span>
  if (presented.kind === 'value') {
    return (
      <>
        <InspectableResult resultId={result.result_id} label={period === undefined ? presented.full_text : `${presented.full_text}, ${period}`} className={VALUE_BUTTON}>
          <span title={presented.full_text} aria-label={presented.full_text}>
            {presented.text}
          </span>
        </InspectableResult>
        {note}
      </>
    )
  }
  return (
    <>
      <span className="text-muted" title={presented.text}>
        <span aria-hidden="true">n/a</span>
        <span className="sr-only">{presented.text}</span>
      </span>
      {note}
    </>
  )
}

// The fiscal period, then its end date on a line of its own, so the company column stays narrow.
function RowPeriod({ label }: { label: string }): ReactElement {
  const short = shortPeriod(label)
  const [period, ...rest] = short.split(' · ')
  return (
    <span className="block text-xs font-normal text-muted" title={short === label ? undefined : label}>
      {period}
      {rest.length === 0 ? null : <><span className="sr-only"> · </span><span className="block">{rest.join(' · ')}</span></>}
    </span>
  )
}

// A certified value opens the inspector; it reads as a plain figure until hovered or focused.
const VALUE_BUTTON = '-mx-1 cursor-pointer rounded px-1 transition-colors hover:bg-accent-soft hover:text-accent-strong'

const HEAD = 'border-b border-line-strong px-1.5 pb-2 align-bottom text-xs font-medium text-muted first:pl-0'
const CELL = 'border-b border-line px-1.5 py-2.5 align-top first:pl-0 group-last/row:border-b-0 group-hover/row:bg-surface-hover'
// A column that starts a new kind of figure (amounts, ratios, changes) is set off by a rule.
const GROUP = 'border-l border-line'

type TableProps = { blockId: string; provenance: ReadonlyArray<string>; content: FinancialAnswerContent; results: Results; names: Names; table: FinancialTablePresentation }

function CertifiedTable({ blockId, provenance, content, results, names: companies, table }: TableProps): ReactElement {
  const [sort, setSort] = useState<{ columnId: string; direction: SortDirection } | null>(null)
  const order = sort ? sortedRowIndexes(table, results, sort.columnId, sort.direction) : table.rows.map((_, index) => index)
  const toggle = (columnId: string) =>
    setSort((current) =>
      current?.columnId === columnId && current.direction === 'ascending' ? { columnId, direction: 'descending' } : { columnId, direction: 'ascending' },
    )
  const measures = table.columns.map((column) => labelText(content, column.measure_label_id))
  const names = columnNames(measures)
  const starts = groupStarts(content, table, results)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-end">
        <CopyButton label="Copy table" what={table.caption || 'this table'} purpose="for a spreadsheet" text={() => toTsv([...tableCopyRows(content, table, results, order), provenance])} />
      </div>
      <div className="scroll-edge overflow-x-auto" data-testid={`block-financial-answer-${blockId}-table`}>
        <table className="w-full border-separate border-spacing-0 text-left text-sm tabular-nums">
          <caption className="sr-only">{table.caption}</caption>
          <thead>
            <tr>
              <th scope="col" className={`${HEAD} sticky left-0 z-10 bg-surface`}>
                Company
              </th>
              {table.columns.map((column, index) => {
                const name = names[index]!
                const heading = column.period_label_id === null ? name : `${name}, ${shortPeriod(labelText(content, column.period_label_id))}`
                const active = sort?.columnId === column.column_id
                return (
                  <th
                    key={column.column_id}
                    scope="col"
                    aria-sort={active ? sort.direction : 'none'}
                    className={`${HEAD} text-right${starts[index] ? ` ${GROUP}` : ''}`}
                  >
                    <button type="button" className={active ? 'text-right text-fg' : 'text-right hover:text-fg'} title={name === measures[index] ? undefined : measures[index]} onClick={() => toggle(column.column_id)}>
                      {heading}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {order.map((rowIndex) => {
              const row = table.rows[rowIndex]!
              const shared = rowPeriod(content, table, row, results)
              // A row of gaps reads n/a once, unless a gap names a period beyond the row's (another period, or a change's base) and so needs its own cell.
              const reasons = gapReasons(row, results)
              const gapped = reasons !== null && row.cells.every((cell, index) =>
                table.columns[index]?.period_label_id !== null || cellPeriod(labelText(content, results.get(cell!)!.period_label_id), shared) === undefined)
              const company = labelText(content, row.subject_label_id)
              const shown = companies.get(company) ?? company
              return (
                <tr key={row.subject_label_id} className="group/row" data-row-label={row.subject_label_id}>
                  <th scope="row" className={`${CELL} sticky left-0 z-10 whitespace-nowrap bg-surface font-medium text-fg`}>
                    <span title={shown === company ? undefined : company}>{shown}</span>
                    {shared === null ? null : <RowPeriod label={shared} />}
                  </th>
                  {gapped ? (
                    <td colSpan={row.cells.length} className={`${CELL} text-muted`}>
                      <span aria-hidden="true">n/a</span>
                      <span className="sr-only">Not available.</span>
                      <span className="block text-xs">{reasons.join(' ')}</span>
                    </td>
                  ) : row.cells.map((cell, cellIndex) => {
                    const result = cell === null ? undefined : results.get(cell)
                    const label = table.columns[cellIndex]?.period_label_id === null && result ? labelText(content, result.period_label_id) : undefined
                    return (
                      <td key={`${row.subject_label_id}-${cellIndex}`} className={`${CELL} whitespace-nowrap text-right text-fg${starts[cellIndex] ? ` ${GROUP}` : ''}`}>
                        <Cell result={result} period={label === undefined ? undefined : shortPeriod(label)} shown={label === undefined ? undefined : cellPeriod(label, shared)} />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type SeriesProps = { provenance: ReadonlyArray<string>; content: FinancialAnswerContent; results: Results; series: FinancialSeriesPresentation }

function CertifiedSeries({ provenance, content, results, series }: SeriesProps): ReactElement {
  const points = series.points.map((point) => results.get(point.result_id))
  const bars = seriesBars(points)
  const heading = `${labelText(content, series.subject_label_id)}: ${labelText(content, series.measure_label_id)}`
  return (
    <figure className="relative mt-2">
      <div className="absolute right-0 top-0">
        <CopyButton label="Copy table" what={heading} purpose="for a spreadsheet" text={() => toTsv([...seriesCopyRows(content, series, results), provenance])} />
      </div>
      <table className="w-full border-collapse text-sm">
        <caption className="pb-2 pr-28 text-left text-xs font-medium text-muted">{heading}</caption>
        <tbody>
          {series.points.map((point, index) => {
            const bar = bars[index]
            return (
              <tr key={point.result_id} className="border-t border-line">
                <th scope="row" className="whitespace-nowrap py-1.5 pr-4 text-left font-normal text-muted">
                  {labelText(content, point.period_label_id)}
                </th>
                <td className="whitespace-nowrap py-1.5 pr-4 text-right tabular-nums text-fg">
                  <Cell result={points[index]} />
                </td>
                <td aria-hidden="true" className="w-1/2 py-1.5">
                  <div
                    className={`h-2 rounded-sm ${bar?.negative ? 'bg-negative/70' : 'bg-accent/70'}`}
                    style={{ width: `${Math.round((bar?.size ?? 0) * 100)}%` }}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </figure>
  )
}

type ScenariosProps = { blockId: string; content: FinancialAnswerContent; results: Results; scenarios: FinancialScenariosPresentation }

const SCENARIO_NAME: Readonly<Record<FinancialScenariosPresentation['rows'][number]['scenario'], string>> = { bear: 'Bear', base: 'Base', bull: 'Bull' }

// The EPS is reported data and each P/E is the user's, so each carries its own
// label; the values are the block's verified arithmetic, under its one badge.
// The EPS is source-linked only as a value whose block proof links its
// evidence, as proofLabels decides for a block.
function CertifiedScenarios({ blockId, content, results, scenarios }: ScenariosProps): ReactElement {
  const proof = useContext(BlockProofContext)
  const earnings = scenarios.earnings_result_id === null ? undefined : results.get(scenarios.earnings_result_id)
  const linked = earnings?.presented.kind === 'value' && (proof === null || proof.evidence === 'linked')
  return (
    <figure className="mt-2 flex flex-col gap-2" data-testid={`block-financial-answer-${blockId}-scenarios`}>
      {earnings ? <ResultLine content={content} result={earnings} badge={linked ? <VerificationLabel kind="source_linked" /> : null} /> : null}
      <table className="w-full border-separate border-spacing-0 text-left text-sm tabular-nums">
        <thead>
          <tr>
            <th scope="col" className={HEAD}>Scenario</th>
            <th scope="col" className={HEAD}>
              P/E <VerificationLabel kind="user_supplied" />
            </th>
            <th scope="col" className={`${HEAD} text-right`}>Value per share</th>
          </tr>
        </thead>
        <tbody>
          {scenarios.rows.map((row) => (
            <tr key={row.assumption_id} className="group/row" data-scenario={row.scenario}>
              <th scope="row" className={`${CELL} font-medium text-fg`}>{SCENARIO_NAME[row.scenario]}</th>
              <td className={`${CELL} text-fg`}>
                {row.multiple_text}
                <span className="block text-xs text-muted">{row.attribution_text}</span>
              </td>
              <td className={`${CELL} text-right text-fg`}>
                <Cell result={results.get(row.result_id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p role="note" className="text-xs text-muted">{scenarios.disclosure}</p>
    </figure>
  )
}
