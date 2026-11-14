import { useContext, type ReactElement, type ReactNode } from 'react'
import { ChartCard } from './ChartCard.tsx'
import { CopyButton } from './CopyButton.tsx'
import { provenanceRow, toTsv } from './tableCopy.ts'
import { InspectableResult } from '../evidence/InspectableResult.tsx'
import { BlockProofContext } from './blockProof.ts'
import { VerificationLabel } from './VerificationLabel.tsx'
import {
  columnNames,
  companyNames,
  coverageText,
  labelText,
  leadParts,
  resultLabel,
  resultShown,
  resultsById,
  seriesBars,
  shortPeriod,
  seriesCopyRows,
  statementOf,
  tableCopyRows,
  supportedFinancialContent,
  type Statement,
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
  const names = companyNames(content)
  const parts = withLeadsTogether(content, results)
  let leads = parts.filter((part) => Array.isArray(part)).flat()
  const statements = new Map<FinancialPresentation, Statement>()
  for (const presentation of content.presentations) {
    if (presentation.kind !== 'table') continue
    const statement = statementOf(content, presentation, results, leads)
    statements.set(presentation, statement)
    leads = leads.filter((lead) => !statement.foldedLeads.has(lead.result_id))
  }
  const separate = new Set(leads.map((lead) => lead.result_id))
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
      {parts.map((part, index) => {
        if (!Array.isArray(part)) {
          return <PresentationView key={`${block.id}-p${index}`} blockId={block.id} provenance={provenanceRow(block)} content={content} results={results} statement={statements.get(part)} presentation={part} />
        }
        const unfolded = part.filter((lead) => separate.has(lead.result_id))
        return unfolded.length === 0 ? null : <Leads key={`${block.id}-p${index}`} content={content} names={names} leads={unfolded} />
      })}
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
  statement: Statement | undefined
  presentation: FinancialPresentation
}

function PresentationView({ blockId, provenance, content, results, statement, presentation }: PresentationViewProps): ReactElement | null {
  if (presentation.kind === 'table') return <CertifiedTable blockId={blockId} provenance={provenance} content={content} results={results} statement={statement!} table={presentation} />
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
        <InspectableResult resultId={result.result_id} label={`${label}: ${presented.full_text}`} shown={resultShown(content, result)} className={VALUE_BUTTON}>
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
    return <Cell content={content} result={result} period={period} shown={period} />
  }
  // The whole label names each company's period, which the matrix headings leave out.
  return (
    <InspectableResult resultId={result.result_id} label={`${label}: ${presented.full_text}`} shown={resultShown(content, result)} className={VALUE_BUTTON}>
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

// period names the cell to the inspector; shown is what the cell prints of it, the whole period its title. A gap's reason is its title and its screen-reader text.
function Cell({ content, result, period, shown }: { content: FinancialAnswerContent; result: FinancialPresentedResult | undefined; period?: string; shown?: string }): ReactElement {
  if (!result) return <span className="text-muted">Not requested</span>
  const { presented } = result
  const note = shown === undefined ? null : <span className="block text-xs text-muted" title={shown === period ? undefined : period}>{shown}</span>
  if (presented.kind === 'value') {
    return (
      <>
        <InspectableResult resultId={result.result_id} label={period === undefined ? presented.full_text : `${presented.full_text}, ${period}`} shown={resultShown(content, result)} className={VALUE_BUTTON}>
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
        <span aria-hidden="true">—</span>
        <span className="sr-only">{presented.text}</span>
      </span>
      {note}
    </>
  )
}

// A certified value opens the inspector; it reads as a plain figure until hovered or focused.
const VALUE_BUTTON = '-mx-1 cursor-pointer rounded px-1 transition-colors hover:bg-accent-soft hover:text-accent-strong'

const HEAD = 'border-b border-line-strong px-3 pb-1.5 align-bottom text-xs font-medium text-muted first:pl-0'
const CELL = 'border-b border-line px-3 py-1.5 align-top first:pl-0 group-hover/row:bg-surface-hover'

type TableProps = { blockId: string; provenance: ReadonlyArray<string>; content: FinancialAnswerContent; results: Results; statement: Statement; table: FinancialTablePresentation }

function CertifiedTable({ blockId, provenance, content, results, statement, table }: TableProps): ReactElement {
  const { companies, sharedPeriod, sections, differenceSides, footnotes } = statement
  const width = 1 + companies.length + (differenceSides === null ? 0 : 1)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-end justify-between gap-2">
        {sharedPeriod === null ? <span /> : <p className="text-xs text-muted" data-testid={`block-financial-answer-${blockId}-period`}>{sharedPeriod}</p>}
        <CopyButton label="Copy table" what={table.caption || 'this table'} purpose="for a spreadsheet" text={() => toTsv([...tableCopyRows(content, table, results), provenance])} />
      </div>
      <div className="scroll-edge overflow-x-auto" data-testid={`block-financial-answer-${blockId}-table`}>
        <table className="w-full border-separate border-spacing-0 text-left text-sm tabular-nums">
          <caption className="sr-only">{table.caption}</caption>
          <thead>
            <tr>
              <th scope="col" className={`${HEAD} sticky left-0 z-10 bg-surface`}>
                <span className="sr-only">Measure</span>
              </th>
              {companies.map((company) => (
                <th key={company.subjectId} scope="col" className={`${HEAD} whitespace-nowrap text-right`} data-subject={company.subjectId}>
                  <span className="block text-sm font-semibold text-fg" title={company.short === company.name ? undefined : company.name}>{company.short}</span>
                  {sharedPeriod === null && company.period !== null ? <span className="block font-normal">{company.period}</span> : null}
                </th>
              ))}
              {differenceSides === null ? null : (
                <th scope="col" className={`${HEAD} whitespace-nowrap text-right`}>
                  <span className="block text-sm font-semibold text-fg">Difference</span>
                  <span className="block font-normal">{differenceSides.join(' − ')}</span>
                </th>
              )}
            </tr>
          </thead>
          {sections.map((section) => (
            <tbody key={section.rows[0]!.key}>
              {section.title === null ? null : (
                <tr>
                  <th scope="colgroup" colSpan={width} className="border-b border-line px-0 pb-1 pt-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                    <span className="sticky left-0">{section.title}</span>
                  </th>
                </tr>
              )}
              {section.rows.map((row) => (
                <tr key={row.key} className="group/row" data-row={row.key}>
                  <th scope="row" className={`${CELL} sticky left-0 z-10 whitespace-nowrap bg-surface font-normal text-fg`} title={row.label === row.measure ? undefined : row.measure}>
                    {row.label}
                  </th>
                  {row.cells.map((cell, index) => (
                    <td key={companies[index]!.subjectId} className={`${CELL} whitespace-nowrap text-right text-fg`} data-result-id={cell.result?.result_id}>
                      <Cell content={content} result={cell.result} period={cell.result && shortPeriod(labelText(content, cell.result.period_label_id))} shown={cell.period ?? undefined} />
                    </td>
                  ))}
                  {differenceSides === null ? null : (
                    <td className={`${CELL} whitespace-nowrap text-right text-fg`} data-result-id={row.difference?.result_id}>
                      {row.difference === undefined ? null : row.difference.presented.kind === 'value'
                        ? <LeadValue content={content} result={row.difference} />
                        : <Cell content={content} result={row.difference} />}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      {footnotes.map((note) => (
        <p key={note} className="text-xs text-muted">{note}</p>
      ))}
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
                  <Cell content={content} result={points[index]} />
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
                <Cell content={content} result={results.get(row.result_id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p role="note" className="text-xs text-muted">{scenarios.disclosure}</p>
    </figure>
  )
}
