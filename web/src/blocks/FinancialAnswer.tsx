import { useState, type ReactElement, type ReactNode } from 'react'
import { ChartCard } from './ChartCard.tsx'
import { useEvidenceInspector } from '../evidence/useEvidenceInspector.ts'
import { VerificationLabel } from './VerificationLabel.tsx'
import {
  coverageText,
  labelText,
  resultLabel,
  resultsById,
  seriesBarHeights,
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
  if (content === null) {
    return (
      <ChartCard testId={`block-financial-answer-${block.id}`} blockKind="financial_answer" title={undefined} dataAttrs={{ 'data-certified': 'false' }}>
        <VerificationLabel kind="legacy" />
        <p role="note" className="text-sm text-muted" data-testid={`block-financial-answer-${block.id}-unsupported`}>
          This verified financial answer uses a newer format than this app supports. Refresh or update to view it.
        </p>
      </ChartCard>
    )
  }
  const results = resultsById(content)
  return (
    <ChartCard testId={`block-financial-answer-${block.id}`} blockKind="financial_answer" title={undefined} dataAttrs={{ 'data-certified': 'true' }}>
      <div className="flex flex-wrap items-center gap-2">
        <VerificationLabel kind="verified" />
        {content.coverage.state === 'complete' ? null : <VerificationLabel kind="partial" />}
        <p className="text-xs text-muted" data-testid={`block-financial-answer-${block.id}-coverage`} data-coverage={content.coverage.state}>
          {coverageText(content)}
        </p>
      </div>
      {content.presentations.map((presentation, index) => (
        <PresentationView key={`${block.id}-p${index}`} blockId={block.id} content={content} results={results} presentation={presentation} />
      ))}
    </ChartCard>
  )
}

type Results = ReadonlyMap<string, FinancialPresentedResult>

type PresentationViewProps = {
  blockId: string
  content: FinancialAnswerContent
  results: Results
  presentation: FinancialPresentation
}

function PresentationView({ blockId, content, results, presentation }: PresentationViewProps): ReactElement | null {
  if (presentation.kind === 'table') return <CertifiedTable blockId={blockId} content={content} results={results} table={presentation} />
  if (presentation.kind === 'series') return <CertifiedSeries content={content} results={results} series={presentation} />
  const result = results.get(presentation.result_id)
  if (!result) return null
  return <ResultLine content={content} result={result} />
}

function ResultLine({ content, result }: { content: FinancialAnswerContent; result: FinancialPresentedResult }): ReactElement {
  const { presented } = result
  if (presented.kind === 'value') {
    const label = resultLabel(content, result)
    return (
      <p className="text-sm text-fg" data-result-id={result.result_id}>
        <span className="text-muted">{label}: </span>
        <InspectableResult resultId={result.result_id} label={`${label}: ${presented.full_text}`}>
          <span className="num" title={presented.full_text} aria-label={`${label}: ${presented.full_text}`}>
            {presented.text}
          </span>
        </InspectableResult>
      </p>
    )
  }
  const tone = presented.kind === 'gap' ? 'text-muted italic' : 'text-fg'
  return (
    <p className={`text-sm ${tone}`} data-result-id={result.result_id} data-result-kind={presented.kind}>
      {presented.kind === 'gap' ? `${resultLabel(content, result)}: ${presented.text}` : presented.text}
    </p>
  )
}

function Cell({ result }: { result: FinancialPresentedResult | undefined }): ReactElement {
  if (!result) return <span className="text-muted">Not requested</span>
  const { presented } = result
  if (presented.kind === 'value') {
    return (
      <InspectableResult resultId={result.result_id} label={presented.full_text}>
        <span title={presented.full_text} aria-label={presented.full_text}>
          {presented.text}
        </span>
      </InspectableResult>
    )
  }
  return <span className="text-muted italic">{presented.text}</span>
}

// A certified value opens the shared result inspector where the host provides
// one; a real button, so it is reachable by keyboard. Without a host it is text.
function InspectableResult({ resultId, label, children }: { resultId: string; label: string; children: ReactNode }): ReactElement {
  const inspector = useEvidenceInspector()
  const open = inspector?.openFinancialResult
  if (!open) return <>{children}</>
  return (
    <button
      type="button"
      className="border-0 bg-transparent p-0 text-left underline decoration-dotted underline-offset-2"
      data-inspect-result={resultId}
      aria-label={`Inspect the verified calculation for ${label}`}
      onClick={() => open(resultId)}
    >
      {children}
    </button>
  )
}

type TableProps = { blockId: string; content: FinancialAnswerContent; results: Results; table: FinancialTablePresentation }

function CertifiedTable({ blockId, content, results, table }: TableProps): ReactElement {
  const [sort, setSort] = useState<{ columnId: string; direction: SortDirection } | null>(null)
  const order = sort ? sortedRowIndexes(table, results, sort.columnId, sort.direction) : table.rows.map((_, index) => index)
  const toggle = (columnId: string) =>
    setSort((current) =>
      current?.columnId === columnId && current.direction === 'ascending' ? { columnId, direction: 'descending' } : { columnId, direction: 'ascending' },
    )
  return (
    <div className="overflow-x-auto rounded-lg border border-line" data-testid={`block-financial-answer-${blockId}-table`}>
      <table className="w-full border-collapse text-left text-sm">
        <caption className="px-3 py-2 text-left text-xs text-muted">{table.caption}</caption>
        <thead className="bg-surface-2">
          <tr>
            <th scope="col" className="border-b border-line px-3 py-2 text-xs font-medium text-muted">
              Company
            </th>
            {table.columns.map((column) => {
              const heading = `${labelText(content, column.measure_label_id)}, ${labelText(content, column.period_label_id)}`
              const active = sort?.columnId === column.column_id
              return (
                <th
                  key={column.column_id}
                  scope="col"
                  aria-sort={active ? sort.direction : 'none'}
                  className="border-b border-line px-3 py-2 text-xs font-medium text-muted"
                >
                  <button type="button" className="text-left hover:text-fg" onClick={() => toggle(column.column_id)}>
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
                {row.cells.map((cell, cellIndex) => (
                  <td key={`${row.subject_label_id}-${cellIndex}`} className="num px-3 py-2 text-fg">
                    <Cell result={cell === null ? undefined : results.get(cell)} />
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

type SeriesProps = { content: FinancialAnswerContent; results: Results; series: FinancialSeriesPresentation }

function CertifiedSeries({ content, results, series }: SeriesProps): ReactElement {
  const points = series.points.map((point) => results.get(point.result_id))
  const heights = seriesBarHeights(points)
  const heading = `${labelText(content, series.subject_label_id)}: ${labelText(content, series.measure_label_id)}`
  return (
    <figure className="flex flex-col gap-1">
      <div aria-hidden="true" className="flex h-16 items-end gap-1">
        {heights.map((height, index) => (
          <div
            key={series.points[index]!.result_id}
            className="w-6 rounded-t bg-accent"
            style={{ height: `${Math.round((height ?? 0) * 100)}%` }}
          />
        ))}
      </div>
      <table className="text-left text-sm">
        <caption className="text-left text-xs text-muted">{heading}</caption>
        <tbody>
          {series.points.map((point, index) => (
            <tr key={point.result_id}>
              <th scope="row" className="pr-3 font-normal text-muted">
                {labelText(content, point.period_label_id)}
              </th>
              <td className="num text-fg">
                <Cell result={points[index]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
