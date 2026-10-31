import { useContext, useState, type ReactElement } from 'react'
import { ChartCard } from './ChartCard.tsx'
import { CopyTableButton } from './CopyTableButton.tsx'
import { provenanceRow } from './tableCopy.ts'
import { InspectableResult } from '../evidence/InspectableResult.tsx'
import { BlockProofContext } from './blockProof.ts'
import { VerificationLabel } from './VerificationLabel.tsx'
import {
  coverageText,
  labelText,
  resultLabel,
  resultsById,
  seriesBars,
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
  const result = results.get(presentation.result_id)
  if (!result) return null
  return <ResultLine content={content} result={result} />
}

const RESULT_ROW_CLASS = 'flex items-baseline justify-between gap-4 border-t border-line py-1.5 text-sm'

function ResultLine({ content, result }: { content: FinancialAnswerContent; result: FinancialPresentedResult }): ReactElement {
  const { presented } = result
  if (presented.kind === 'value') {
    const label = resultLabel(content, result)
    return (
      <p className={`${RESULT_ROW_CLASS} text-fg`} data-result-id={result.result_id}>
        <span className="text-muted">{label}: </span>
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
        <span>{resultLabel(content, result)}: </span>
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

function Cell({ result, ownPeriod }: { result: FinancialPresentedResult | undefined; ownPeriod?: string }): ReactElement {
  if (!result) return <span className="text-muted">Not requested</span>
  const { presented } = result
  const period = ownPeriod === undefined ? null : <span className="block text-xs text-muted">{ownPeriod}</span>
  if (presented.kind === 'value') {
    return (
      <>
        <InspectableResult resultId={result.result_id} label={ownPeriod === undefined ? presented.full_text : `${presented.full_text}, ${ownPeriod}`}>
          <span title={presented.full_text} aria-label={presented.full_text}>
            {presented.text}
          </span>
        </InspectableResult>
        {period}
      </>
    )
  }
  return (
    <>
      <span className="text-muted italic">{presented.text}</span>
      {period}
    </>
  )
}

type TableProps = { blockId: string; provenance: ReadonlyArray<string>; content: FinancialAnswerContent; results: Results; table: FinancialTablePresentation }

function CertifiedTable({ blockId, provenance, content, results, table }: TableProps): ReactElement {
  const [sort, setSort] = useState<{ columnId: string; direction: SortDirection } | null>(null)
  const order = sort ? sortedRowIndexes(table, results, sort.columnId, sort.direction) : table.rows.map((_, index) => index)
  const toggle = (columnId: string) =>
    setSort((current) =>
      current?.columnId === columnId && current.direction === 'ascending' ? { columnId, direction: 'descending' } : { columnId, direction: 'ascending' },
    )
  return (
    <div className="relative overflow-x-auto rounded-lg border border-line" data-testid={`block-financial-answer-${blockId}-table`}>
      <div className="absolute right-1.5 top-1.5">
        <CopyTableButton what={table.caption || 'this table'} rows={() => [...tableCopyRows(content, table, results, order), provenance]} />
      </div>
      <table className="w-full border-collapse text-left text-sm">
        <caption className="py-2 pl-3 pr-28 text-left text-xs text-muted">{table.caption}</caption>
        <thead className="bg-surface-2">
          <tr>
            <th scope="col" className="border-b border-line px-3 py-2 text-xs font-medium text-muted">
              Company
            </th>
            {table.columns.map((column) => {
              const measure = labelText(content, column.measure_label_id)
              const heading = column.period_label_id === null ? measure : `${measure}, ${labelText(content, column.period_label_id)}`
              const active = sort?.columnId === column.column_id
              return (
                <th
                  key={column.column_id}
                  scope="col"
                  aria-sort={active ? sort.direction : 'none'}
                  className="border-b border-line px-3 py-2 text-right text-xs font-medium text-muted"
                >
                  <button type="button" className="text-right hover:text-fg" onClick={() => toggle(column.column_id)}>
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
            return (
              <tr key={row.subject_label_id} className="border-t border-line" data-row-label={row.subject_label_id}>
                <th scope="row" className="px-3 py-2 font-normal text-fg">
                  {labelText(content, row.subject_label_id)}
                </th>
                {row.cells.map((cell, cellIndex) => {
                  const result = cell === null ? undefined : results.get(cell)
                  const ownPeriod = table.columns[cellIndex]?.period_label_id === null && result ? labelText(content, result.period_label_id) : undefined
                  return (
                    <td key={`${row.subject_label_id}-${cellIndex}`} className="num px-3 py-2 text-right text-fg">
                      <Cell result={result} ownPeriod={ownPeriod} />
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
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
        <CopyTableButton what={heading} rows={() => [...seriesCopyRows(content, series, results), provenance]} />
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
