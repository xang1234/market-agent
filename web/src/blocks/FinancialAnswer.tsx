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
  labelText,
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
      {content.presentations.map((presentation, index) => (
        <PresentationView key={`${block.id}-p${index}`} blockId={block.id} provenance={provenanceRow(block)} content={content} results={results} presentation={presentation} />
      ))}
    </ChartCard>
  )
}

type Results = ReadonlyMap<string, FinancialPresentedResult>

type PresentationViewProps = {
  blockId: string
  // Ends a copied table, so pasted figures keep their as-of date and snapshot.
  provenance: ReadonlyArray<string>
  content: FinancialAnswerContent
  results: Results
  presentation: FinancialPresentation
}

function PresentationView({ blockId, provenance, content, results, presentation }: PresentationViewProps): ReactElement | null {
  if (presentation.kind === 'table') return <CertifiedTable blockId={blockId} provenance={provenance} content={content} results={results} table={presentation} />
  if (presentation.kind === 'series') return <CertifiedSeries provenance={provenance} content={content} results={results} series={presentation} />
  if (presentation.kind === 'scenarios') return <CertifiedScenarios blockId={blockId} content={content} results={results} scenarios={presentation} />
  const result = results.get(presentation.result_id)
  if (!result) return null
  return <ResultLine content={content} result={result} />
}

const RESULT_ROW_CLASS = 'flex items-baseline justify-between gap-4 border-t border-line py-1.5 text-sm'

function ResultLine({ content, result, badge }: { content: FinancialAnswerContent; result: FinancialPresentedResult; badge?: ReactNode }): ReactElement {
  const { presented } = result
  if (presented.kind === 'value') {
    const label = resultLabel(content, result)
    return (
      <p className={`${RESULT_ROW_CLASS} text-fg`} data-result-id={result.result_id}>
        <span className="text-muted">{label}: {badge}</span>
        <InspectableResult resultId={result.result_id} label={`${label}: ${presented.full_text}`}>
          <span className="num whitespace-nowrap" title={presented.full_text} aria-label={`${label}: ${presented.full_text}`}>
            {presented.text}
          </span>
        </InspectableResult>
      </p>
    )
  }
  if (presented.kind === 'gap') {
    return (
      <p className={`${RESULT_ROW_CLASS} text-muted`} data-result-id={result.result_id} data-result-kind="gap">
        <span>{resultLabel(content, result)}: {badge}</span>
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

// period names the cell to the inspector; shown is what the cell prints of it (cellPeriod), the whole period its title. A gap's reason is its title and its screen-reader text.
function Cell({ result, period, shown }: { result: FinancialPresentedResult | undefined; period?: string; shown?: string }): ReactElement {
  if (!result) return <span className="text-muted">Not requested</span>
  const { presented } = result
  const note = shown === undefined ? null : <span className="block text-xs text-muted" title={shown === period ? undefined : period}>{shown}</span>
  if (presented.kind === 'value') {
    return (
      <>
        <InspectableResult resultId={result.result_id} label={period === undefined ? presented.full_text : `${presented.full_text}, ${period}`}>
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

function RowPeriod({ label }: { label: string }): ReactElement {
  const short = shortPeriod(label)
  return <span className="block text-xs text-muted" title={short === label ? undefined : label}>{short}</span>
}

type TableProps = { blockId: string; provenance: ReadonlyArray<string>; content: FinancialAnswerContent; results: Results; table: FinancialTablePresentation }

function CertifiedTable({ blockId, provenance, content, results, table }: TableProps): ReactElement {
  const [sort, setSort] = useState<{ columnId: string; direction: SortDirection } | null>(null)
  const order = sort ? sortedRowIndexes(table, results, sort.columnId, sort.direction) : table.rows.map((_, index) => index)
  const toggle = (columnId: string) =>
    setSort((current) =>
      current?.columnId === columnId && current.direction === 'ascending' ? { columnId, direction: 'descending' } : { columnId, direction: 'ascending' },
    )
  const measures = table.columns.map((column) => labelText(content, column.measure_label_id))
  const names = columnNames(measures)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-end">
        <CopyButton label="Copy table" what={table.caption || 'this table'} purpose="for a spreadsheet" text={() => toTsv([...tableCopyRows(content, table, results, order), provenance])} />
      </div>
      <div className="overflow-x-auto rounded-lg border border-line" data-testid={`block-financial-answer-${blockId}-table`}>
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{table.caption}</caption>
          <thead className="bg-surface-2">
            <tr>
              <th scope="col" className="border-b border-line px-3 py-2 text-xs font-medium text-muted">
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
                    className="border-b border-line px-3 py-2 text-right text-xs font-medium text-muted"
                  >
                    <button type="button" className="text-right hover:text-fg" title={name === measures[index] ? undefined : measures[index]} onClick={() => toggle(column.column_id)}>
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
              return (
                <tr key={row.subject_label_id} className="border-t border-line" data-row-label={row.subject_label_id}>
                  <th scope="row" className="px-3 py-2 font-normal text-fg">
                    {labelText(content, row.subject_label_id)}
                    {shared === null ? null : <RowPeriod label={shared} />}
                  </th>
                  {row.cells.map((cell, cellIndex) => {
                    const result = cell === null ? undefined : results.get(cell)
                    const label = table.columns[cellIndex]?.period_label_id === null && result ? labelText(content, result.period_label_id) : undefined
                    return (
                      <td key={`${row.subject_label_id}-${cellIndex}`} className="num px-3 py-2 text-right text-fg">
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
                <td className="num whitespace-nowrap py-1.5 pr-4 text-right text-fg">
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
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-surface-2">
          <tr>
            <th scope="col" className="border-b border-line px-3 py-2 text-xs font-medium text-muted">Scenario</th>
            <th scope="col" className="border-b border-line px-3 py-2 text-xs font-medium text-muted">
              P/E <VerificationLabel kind="user_supplied" />
            </th>
            <th scope="col" className="border-b border-line px-3 py-2 text-right text-xs font-medium text-muted">Value per share</th>
          </tr>
        </thead>
        <tbody>
          {scenarios.rows.map((row) => (
            <tr key={row.assumption_id} className="border-t border-line" data-scenario={row.scenario}>
              <th scope="row" className="px-3 py-2 font-normal text-fg">{SCENARIO_NAME[row.scenario]}</th>
              <td className="num px-3 py-2 text-fg">
                {row.multiple_text}
                <span className="block text-xs text-muted">{row.attribution_text}</span>
              </td>
              <td className="num px-3 py-2 text-right text-fg">
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
