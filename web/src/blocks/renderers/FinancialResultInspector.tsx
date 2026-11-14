import type { ReactElement, ReactNode } from 'react'

import {
  canonicalValue,
  derivationFormula,
  derivationTermLabel,
  fiscalPeriodText,
  inspectableDetails,
  OPERATIONS,
  payloadSummary,
  type FinancialInspectedInput,
  type FinancialResultInspection,
  type FinancialResultShown,
} from '../financialInspection.ts'
import { noncontrollingInterestInferenceText } from '../../../../services/financial-core/src/contracts.ts'
import { CopyButton } from '../CopyButton.tsx'
import { VerificationLabel } from '../VerificationLabel.tsx'
import { Skeleton } from '../../ui/Skeleton.tsx'
import { InspectableRef } from '../../evidence/InspectableRef.tsx'
import { Details, Facts, Identifier, Timestamp } from '../../evidence/Readable.tsx'
import { humanize, readableDate, readableText, valueText } from '../../evidence/readable.ts'

export type FinancialInspectorLoad =
  | { kind: 'loading'; resultId: string }
  | { kind: 'error'; resultId: string; message: string }
  | { kind: 'ready'; inspection: FinancialResultInspection }

type Inspected = Extract<FinancialResultInspection, { availability: 'available' }>
type FactInput = Extract<FinancialInspectedInput, { fact_id: string }>
type PriceInput = Extract<FinancialInspectedInput, { observation_id: string }>
type Term = NonNullable<FactInput['derivation']>['terms'][number]

const H3 = 'text-[11px] font-semibold uppercase tracking-wide text-muted'
const VIEW_SOURCE = 'shrink-0 text-xs font-medium text-accent-strong underline decoration-dotted underline-offset-2 dark:text-accent'

// The one inspector for a certified result on every surface (chat, memo, grid,
// thesis, Discovery). It leads with the value, then how it was computed and
// the filings it came from; identifiers, versions, and cutoffs sit under
// Details. Source identifiers are never turned into links here: a source opens
// its own evidence page, whose links the server supplies.
export function FinancialResultInspector({ load, shown }: { load: FinancialInspectorLoad; shown?: FinancialResultShown }): ReactElement {
  if (load.kind === 'loading') return <Skeleton label="Loading the verified calculation" className="h-40" />
  if (load.kind === 'error') return <p role="alert" className="text-sm text-fg-soft">{load.message}</p>
  const details = inspectableDetails(load.inspection)
  if (details === null) {
    return (
      <section data-testid="financial-inspector-legacy" className="flex flex-col gap-2">
        <VerificationLabel kind="legacy" />
        <p className="text-sm text-fg-soft">
          This result was produced by a version this app cannot inspect. Its values are not shown as verified here.
        </p>
      </section>
    )
  }
  return (
    <div className="flex flex-col gap-5" data-testid="financial-inspector" data-result-id={details.result_id}>
      <ValueHeader details={details} shown={shown} />
      <Computation details={details} />
      <Sources details={details} />
      <Assumptions details={details} />
      <AuditDetails details={details} />
    </div>
  )
}

function ValueHeader({ details, shown }: { details: Inspected; shown?: FinancialResultShown }): ReactElement {
  const value = canonicalValue(details.payload)
  const text = value === null ? null : valueText(value, (details.payload as { unit?: unknown }).unit, details.formula?.operation)
  const headline = value === null ? payloadSummary(details.payload, details.formula?.operation) : shown?.value ?? text?.text ?? value
  const exact = text?.full_text ?? value
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <VerificationLabel kind={details.disposition === 'verified' ? 'verified' : 'partial'} />
        {details.coverage_state && details.coverage_state !== 'complete' ? <VerificationLabel kind="partial" /> : null}
      </div>
      <p className={`num font-semibold tracking-tight text-fg ${value === null ? 'text-lg' : 'text-3xl'}`} data-testid="financial-inspector-value">
        {headline}
      </p>
      {value !== null && exact !== null ? (
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
          <span className="shrink-0">Exact</span>
          <span className="num min-w-0 truncate text-fg-soft" title={exact} data-testid="financial-inspector-exact">{exact}</span>
          <CopyButton label="Copy" what="the exact value" purpose="to the clipboard" text={() => value} />
        </div>
      ) : null}
    </section>
  )
}

function formulaText(details: Inspected): string {
  if (details.formula) return OPERATIONS[details.formula.operation]?.formula ?? humanize(details.formula.operation)
  const [input] = details.inputs
  if (input && 'fact_id' in input && input.derivation) return `Derived from filings: ${derivationFormula(input.period, input.derivation)}`
  return 'As reported in the filing'
}

function money(value: string, unit: unknown): string {
  return valueText(value, unit)?.text ?? value
}

function Computation({ details }: { details: Inspected }): ReactElement {
  return (
    <section className="flex flex-col gap-2" aria-labelledby="inspector-computed">
      <h3 id="inspector-computed" className={H3}>How it was computed</h3>
      <p className="text-sm text-fg" data-testid="financial-inspector-formula">{formulaText(details)}</p>
      <table className="w-full table-fixed border-collapse text-xs">
        <caption className="sr-only">Inputs</caption>
        <colgroup><col className="w-[26%]" /><col /><col className="w-[18%]" /></colgroup>
        <thead className="sr-only">
          <tr><th scope="col">Input</th><th scope="col">Period or source</th><th scope="col">Value</th></tr>
        </thead>
        <tbody>
          {details.inputs.map((input) => <InputRows key={input.input_slot} input={input} terms={details.inputs.length === 1} />)}
        </tbody>
      </table>
    </section>
  )
}

function Cells({ label, middle, value, indent = false }: { label: ReactNode; middle: ReactNode; value: ReactNode; indent?: boolean }): ReactElement {
  return (
    <tr className={indent ? 'text-muted' : 'border-t border-line text-fg'}>
      <th scope="row" className={`py-1.5 pr-2 text-left align-top font-normal ${indent ? 'pl-3' : 'font-medium'}`}>{label}</th>
      <td className="py-1.5 pr-2 align-top">{middle}</td>
      <td className="num py-1.5 text-right whitespace-nowrap align-top">{value}</td>
    </tr>
  )
}

// A lone input lists each term it was derived from; beside other inputs its derivation is one line, and each term sits under Sources and Details.
function InputRows({ input, terms }: { input: FinancialInspectedInput; terms: boolean }): ReactElement {
  if (input.status === 'gap') {
    return <Cells label="No eligible input" middle={humanize(input.reason_code ?? 'unknown_reason')} value="n/a" />
  }
  if ('observation_id' in input) {
    const { factor } = input.split_adjustment
    return (
      <>
        <Cells label="Share price" middle={<>{humanize(input.observation.kind)} <Timestamp value={input.observation.observed_at} /></>} value={money(input.value, input.unit)} />
        <Cells indent label="Split basis" middle={<>÷ {factor.numerator}/{factor.denominator} to {readableDate(input.split_adjustment.reference_date)}</>} value="" />
      </>
    )
  }
  return (
    <>
      <Cells label={humanize(input.metric.metric_key)} middle={fiscalPeriodText(input.period)} value={money(input.value, input.unit)} />
      {input.derivation && !terms ? (
        <tr><td colSpan={3} className="pb-1.5 pl-3 text-muted">Derived: {derivationFormula(input.period, input.derivation)}</td></tr>
      ) : null}
      {terms && input.derivation?.terms.map((term, index) => (
        <Cells key={index} indent label={derivationTermLabel(term, index)} middle={`${term.source.form} filed ${readableDate(term.source.filed)}`} value={money(term.raw_token, input.unit)} />
      ))}
      {input.inference ? (
        <tr><td colSpan={3} className="pb-1.5 pl-3 text-muted">Inferred: {noncontrollingInterestInferenceText(input.inference)}</td></tr>
      ) : null}
    </>
  )
}

type SourceEntry = { sourceId: string; name: string | null; supports: string[] }

function sourceEntries(details: Inspected): SourceEntry[] {
  const entries = new Map<string, SourceEntry>()
  const add = (sourceId: string, name: string | null, support: string) => {
    const entry = entries.get(sourceId) ?? { sourceId, name: null, supports: [] }
    entry.name ??= name
    if (!entry.supports.includes(support)) entry.supports.push(support)
    entries.set(sourceId, entry)
  }
  for (const input of details.inputs) {
    if (input.status === 'gap') continue
    if ('observation_id' in input) {
      add(input.source.source_id, 'Price data', `Share price, ${readableDate(input.observation.observed_at)}`)
      continue
    }
    const metric = humanize(input.metric.metric_key)
    if (!input.derivation) add(input.source.source_id, null, `${metric} ${fiscalPeriodText({ ...input.period, end: null })}`)
    for (const term of input.derivation?.terms ?? []) {
      add(term.source.source_id, filingName(term), `${metric} ${derivationTermLabel({ ...term, sign: '+' }, 0)}`)
    }
  }
  return [...entries.values()]
}

function filingName(term: Term): string {
  return `${term.source.form} filed ${readableDate(term.source.filed)}`
}

function Sources({ details }: { details: Inspected }): ReactElement | null {
  const entries = sourceEntries(details)
  if (entries.length === 0) return null
  return (
    <section className="flex flex-col gap-2" aria-labelledby="inspector-sources">
      <h3 id="inspector-sources" className={H3}>Sources</h3>
      <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
        {entries.map((entry) => (
          <li key={entry.sourceId} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">{entry.name ?? 'Filing'}</p>
              <p className="truncate text-xs text-muted" title={entry.supports.join(', ')}>{entry.supports.join(', ')}</p>
            </div>
            <InspectableRef
              snapshotId={details.publication.snapshot_id}
              inspectionRef={{ kind: 'source', id: entry.sourceId }}
              shownAs={entry.name ?? 'Filing'}
              className={VIEW_SOURCE}
            >
              View source
            </InspectableRef>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Assumptions({ details }: { details: Inspected }): ReactElement | null {
  if (!details.assumptions || details.assumptions.length === 0) return null
  return (
    <section className="flex flex-col gap-2" data-testid="financial-inspector-assumptions" aria-labelledby="inspector-assumptions">
      <h3 id="inspector-assumptions" className={H3}>Assumptions (user-supplied, not reported data)</h3>
      <ul className="flex flex-col gap-2">
        {details.assumptions.map((assumption) => (
          <li key={assumption.assumption_id} className="flex items-baseline justify-between gap-3 rounded-md border border-line px-3 py-2 text-sm">
            <span className="text-fg">
              {humanize(assumption.scenario)} P/E <span className="num font-medium">{assumption.value}</span> <VerificationLabel kind="user_supplied" />
            </span>
            <span className="text-xs text-muted">Stated <Timestamp value={assumption.attribution.captured_at} /></span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function inputTitle(input: FactInput | PriceInput): string {
  return 'observation_id' in input ? 'Share price' : `${humanize(input.metric.metric_key)} ${fiscalPeriodText({ ...input.period, end: null })}`
}

function AuditDetails({ details }: { details: Inspected }): ReactElement {
  const bound = details.inputs.filter((input): input is FactInput | PriceInput => input.status === 'bound')
  return (
    <Details>
      <Facts
        rows={[
          ['Coverage', humanize(details.coverage_state ?? 'unknown')],
          ['Time basis', humanize(details.time.time_mode)],
          ['Information cutoff', <Timestamp value={details.time.knowledge_cutoff} />],
          ['Finalized', <Timestamp value={details.time.finalized_at} />],
          ['Formula', details.formula?.operation_version ?? 'Reported value'],
          ['Numeric policy', details.formula?.numeric_policy_version ?? 'Exact reported decimal'],
          ['Definitions', details.definitions.map((definition) => definition.definition_version).join(', ') || 'None'],
          // Only inspectable details reach here, and those are exactly the results pinned replay accepts.
          ['Pinned replay', 'Eligible'],
        ]}
      />
      {bound.map((input) => (
        <Facts key={input.input_slot} title={inputTitle(input)} rows={'observation_id' in input ? [
          ['Known at', <Timestamp value={input.observation.known_at} />],
          ['Observation', <Identifier value={input.observation_id} label="the observation ID" />],
          ['Listing', <Identifier value={input.listing_id} label="the listing ID" />],
          ['Source', <Identifier value={input.source.source_id} label="the source ID" />],
          ['Body hash', <Identifier value={input.source.body_sha256} label="the body hash" />],
        ] : [
          ['Precision', humanize(input.precision_status)],
          ['Public by', <><Timestamp value={input.publication.available_no_later_than} /> ({input.publication.precision})</>],
          ['Fact', <Identifier value={input.fact_id} label="the fact ID" />],
          ['Source', <Identifier value={input.source.source_id} label="the source ID" />],
          ['Source version', <Identifier value={input.source.source_version_hash} label="the source version" />],
          ...(input.source.locator ? [['Locator', <Identifier value={input.source.locator} label="the locator" />] as const] : []),
          ['Attestation', <Identifier value={input.publication.attestation_id} label="the attestation ID" />],
          ...(input.derivation?.terms ?? []).map((term, index) => [
            derivationTermLabel(term, index),
            <>{money(term.raw_token, input.unit)} · {term.source.form} {term.source.accession} <Identifier value={term.source.locator} label="the term locator" /></>,
          ] as const),
        ]} />
      ))}
      {details.assumptions?.map((assumption) => (
        <Facts key={assumption.assumption_id} title={`${humanize(assumption.scenario)} P/E`} rows={[
          ['Stated in', <Identifier value={assumption.attribution.ref} label="where it was stated" />],
          ['Hash', <Identifier value={assumption.assumption_hash} label="the assumption hash" />],
        ]} />
      ))}
      <Facts title="Certificate" rows={[
        ['Result', <Identifier value={details.result_id} label="the result ID" />],
        ['Snapshot', <Identifier value={details.publication.snapshot_id} label="the snapshot ID" />],
        ['Certificate digest', <Identifier value={details.publication.certificate_digest} label="the certificate digest" />],
        ['Result hash', <Identifier value={details.result_hash} label="the result hash" />],
      ]} />
      {details.interpretation ? (
        <section className="flex flex-col gap-1">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Scope of the answer</h4>
          <p className="text-xs text-fg-soft">{readableText(details.interpretation)}</p>
        </section>
      ) : null}
    </Details>
  )
}
