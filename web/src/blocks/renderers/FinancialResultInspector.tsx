import type { ReactElement, ReactNode } from 'react'

import {
  canonicalValue,
  inspectableDetails,
  payloadSummary,
  replayEligible,
  unitText,
  type FinancialInspectedInput,
  type FinancialResultInspection,
} from '../financialInspection.ts'
import { VerificationLabel } from '../VerificationLabel.tsx'

export type FinancialInspectorLoad =
  | { kind: 'loading'; resultId: string }
  | { kind: 'error'; resultId: string; message: string }
  | { kind: 'ready'; inspection: FinancialResultInspection }

// The one inspector for a certified result on every surface (chat, memo, grid,
// thesis, Discovery). It shows what the certificate covers — inputs, formula,
// definitions, source and public-time proof, basis, units, numeric policy,
// cutoff, coverage, replay eligibility — with every number as the canonical
// decimal the server stored. Source identifiers are shown as text; no link is
// built from them.
export function FinancialResultInspector({ load, onCopy }: { load: FinancialInspectorLoad; onCopy?: (text: string) => void }): ReactElement {
  if (load.kind === 'loading') return <p role="status" className="text-sm text-muted">Loading the verified calculation.</p>
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
  const value = canonicalValue(details.payload)
  return (
    <div className="flex flex-col gap-4" data-testid="financial-inspector" data-result-id={details.result_id}>
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <VerificationLabel kind={details.disposition === 'verified' ? 'verified' : 'partial'} />
          {details.coverage_state && details.coverage_state !== 'complete' ? <VerificationLabel kind="partial" /> : null}
        </div>
        <p className="num break-all text-base font-semibold text-fg" data-testid="financial-inspector-value">
          {payloadSummary(details.payload)}
        </p>
        {value !== null && onCopy ? (
          <button
            type="button"
            className="self-start rounded-md border border-line-strong px-2 py-1 text-xs text-fg hover:bg-surface-2"
            aria-label="Copy the certified value"
            onClick={() => onCopy(value)}
          >
            Copy value
          </button>
        ) : null}
        {details.interpretation ? <p className="text-sm text-fg-soft">{details.interpretation}</p> : null}
      </section>
      <Rows
        title="Calculation"
        rows={[
          ['Formula', details.formula ? `${details.formula.operation} (${details.formula.operation_version})` : 'Reported value'],
          ['Numeric policy', details.formula?.numeric_policy_version ?? 'Exact reported decimal'],
          ['Definitions', details.definitions.map((definition) => `${definition.metric_key} ${definition.definition_version}`).join(', ') || 'None'],
          ['Coverage', details.coverage_state ?? 'Unknown'],
        ]}
      />
      <Rows
        title="Time"
        rows={[
          ['Knowledge cutoff', details.time.knowledge_cutoff],
          ['Time mode', details.time.time_mode.replaceAll('_', ' ')],
          ['Finalized', details.time.finalized_at],
        ]}
      />
      <section className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold uppercase text-muted">Inputs</h4>
        <ol className="flex flex-col gap-2">
          {details.inputs.map((input) => (
            <li key={input.input_slot} className="rounded border border-line p-2">
              <InputView input={input} />
            </li>
          ))}
        </ol>
      </section>
      <Rows
        title="Certificate"
        rows={[
          ['Snapshot', details.publication.snapshot_id],
          ['Certificate digest', details.publication.certificate_digest],
          ['Result hash', details.result_hash],
          ['Pinned replay', replayEligible(details) ? 'Eligible' : 'Not available'],
        ]}
      />
    </div>
  )
}

function InputView({ input }: { input: FinancialInspectedInput }): ReactElement {
  if (input.status === 'gap') {
    return <p className="text-sm text-muted italic">No eligible input ({input.reason_code ?? 'unknown reason'})</p>
  }
  return (
    <dl className="grid gap-1 text-xs">
      <Row label="Value"><span className="num break-all text-sm text-fg">{input.value}</span></Row>
      <Row label="Unit">{unitText(input.unit)}</Row>
      <Row label="Metric">{`${input.metric.metric_key} ${input.metric.definition_version}`}</Row>
      <Row label="Period">{`${input.period.fiscal_period} ${input.period.fiscal_year} (${input.period.start ?? '…'} to ${input.period.end})`}</Row>
      <Row label="Precision">{input.precision_status.replaceAll('_', ' ')}</Row>
      <Row label="Public by">{`${input.publication.available_no_later_than} (${input.publication.precision})`}</Row>
      <Row label="Source">{`${input.source.source_id} · version ${input.source.source_version_hash}${input.source.locator ? ` · ${input.source.locator}` : ''}`}</Row>
    </dl>
  )
}

function Rows({ title, rows }: { title: string; rows: ReadonlyArray<readonly [string, string]> }): ReactElement {
  return (
    <section className="flex flex-col gap-1">
      <h4 className="text-xs font-semibold uppercase text-muted">{title}</h4>
      <dl className="grid gap-1 text-xs">
        {rows.map(([label, value]) => (
          <Row key={label} label={label}>{value}</Row>
        ))}
      </dl>
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="break-all text-fg">{children}</dd>
    </div>
  )
}
