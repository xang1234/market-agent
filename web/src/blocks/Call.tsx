import type { ReactElement } from 'react'
import { ChartCard } from './ChartCard.tsx'
import type { CallBlock, CallContent, CallInputKind, CallRow } from './types.ts'

type CallProps = { block: CallBlock }

const KIND_LABEL: Readonly<Record<CallInputKind, string>> = {
  reported_fact: 'Reported fact',
  attributed_consensus: 'Attributed consensus',
  market_observation: 'Market observation',
  owner_policy: 'Owner policy',
  agent_assumption: 'Agent assumption',
  deterministic_result: 'Deterministic result',
}

// The agent's opinion on one company (ADR 0005, #604), printed from
// server-written strings in the ADR's order: facts used, assumptions, what the
// price requires, then the decline rule that matched and the rows it cites.
// It is an opinion, never evidence, so nothing in it carries a verification
// label, and an unknown version shows no values.
export function Call({ block }: CallProps): ReactElement {
  const testId = `block-call-${block.id}`
  const call = block.call.version === 'call.v1' ? (block.call as CallContent) : null
  if (call === null) {
    return (
      <ChartCard testId={testId} blockKind="call" title="Agent opinion">
        <p role="note" className="text-sm text-muted" data-testid={`${testId}-unsupported`}>
          This opinion uses a newer format than this app supports. Refresh or update to view it.
        </p>
      </ChartCard>
    )
  }
  const rows = [...call.facts, ...call.assumptions, ...call.requires]
  const label = new Map(rows.map((row) => [row.id, row.label]))
  const { settings, stance } = call
  return (
    <ChartCard testId={testId} blockKind="call" title={`Agent opinion: ${call.subject.label}, ${call.call_date}`} dataAttrs={{ 'data-rule': String(stance.rule) }}>
      <Rows heading="Facts used" rows={call.facts} />
      <Rows heading="Assumptions" rows={call.assumptions} />
      <Rows heading="What the price requires" rows={call.requires} />
      <section aria-label="Stance" className="flex flex-col gap-1">
        <h3 className="text-xs font-medium text-muted">Declined (rule {stance.rule})</h3>
        <p className="text-sm text-fg">{stance.text}</p>
        <ul className="list-disc pl-5 text-sm text-fg">
          {stance.reasons.map((reason) => (
            <li key={`${reason.cites}:${reason.text}`} data-reason={reason.cites}>{`${label.get(reason.cites) ?? reason.cites}: ${reason.text}`}</li>
          ))}
        </ul>
      </section>
      <p role="note" className="text-xs text-muted">
        {`Your settings: required return ${percent(settings.required_return)}, margin of safety ${settings.margin_of_safety}, bear-loss limit ${percent(settings.bear_loss_limit)}, near band ${percent(settings.near_band)}`}
      </p>
    </ChartCard>
  )
}

function Rows({ heading, rows }: { heading: string; rows: ReadonlyArray<CallRow> }): ReactElement {
  return (
    <section aria-label={heading} className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-muted">{heading}</h3>
      <dl className="flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.id} data-row={row.id} className="flex flex-col gap-0.5">
            <dt className="text-sm text-fg">{row.label}</dt>
            <dd className="flex flex-col gap-0.5">
              <span className="flex flex-wrap items-baseline gap-2">
                <span className="num text-sm text-fg" data-part="figure">{row.figure.text}</span>
                <span className="rounded border border-line px-1 text-xs text-muted" data-part="kind">{KIND_LABEL[row.kind]}</span>
              </span>
              <span className="text-xs text-muted" data-part="basis">{row.basis}</span>
              {row.citations.map((citation) => (
                <span key={`${citation.source_id}:${citation.text}`} className="text-xs text-fg-soft">{citation.text}</span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

// A canonical decimal as a percent, by moving its point two places: no float rounding.
function percent(decimal: string): string {
  const [whole = '0', fraction = ''] = decimal.split('.')
  const shifted = `${whole}${fraction.padEnd(2, '0').slice(0, 2)}`.replace(/^0+(?=\d)/u, '')
  const rest = fraction.slice(2)
  return `${shifted}${rest === '' ? '' : `.${rest}`}%`
}
