import { useContext, type ReactElement } from 'react'
import { ChartCard } from './ChartCard.tsx'
import { BlockProofContext } from './blockProof.ts'
import { VerificationLabel } from './VerificationLabel.tsx'
import type { ScenarioPriceComparisonBlock, ScenarioPriceComparisonContent } from './types.ts'

type ScenarioPriceComparisonProps = { block: ScenarioPriceComparisonBlock }

const SCENARIO_NAME = { bear: 'Bear', base: 'Base', bull: 'Bull' } as const

// A sealed P/E scenario set against one stored close (#224), printed from
// server-written strings. The price is source-linked evidence and the
// differences are conditional on the user's P/E, so neither carries a
// verified label; only a note naming the scenario answer gives that answer's
// verified EPS × P/E, while the server finds its certificate. It is text, not
// a link: the chat list renders only the messages in view.
// Without a server proof that links the block, nothing is labelled linked,
// and an unknown version shows no values.
export function ScenarioPriceComparison({ block }: ScenarioPriceComparisonProps): ReactElement {
  const proof = useContext(BlockProofContext)
  const linked = proof !== null && proof.evidence === 'linked'
  const certified = proof !== null && proof.scenario_calculation === 'verified'
  const testId = `block-scenario-price-comparison-${block.id}`
  const content = block.comparison.version === 'scenario-price-comparison.v1' ? (block.comparison as ScenarioPriceComparisonContent) : null
  if (content === null) {
    return (
      <ChartCard testId={testId} blockKind="scenario_price_comparison" title={undefined}>
        <VerificationLabel kind="not_verified" />
        <p role="note" className="text-sm text-muted" data-testid={`${testId}-unsupported`}>
          This comparison uses a newer format than this app supports. Refresh or update to view it.
        </p>
      </ChartCard>
    )
  }
  const { outcome } = content
  if (outcome.kind === 'gap') {
    return (
      <ChartCard testId={testId} blockKind="scenario_price_comparison" title={undefined} dataAttrs={{ 'data-gap': outcome.reason }}>
        <p className="text-sm text-fg" data-testid={`${testId}-gap`}>{outcome.text}</p>
        {content.cutoff === null ? null : <p className="text-xs text-muted">{content.cutoff.text}</p>}
      </ChartCard>
    )
  }
  const { price, basis } = outcome
  const provenance: ReadonlyArray<[string, string]> = [
    ['Listing', `${price.ticker} (${price.currency})`],
    ['Session', price.session_date],
    ['Traded', price.observed_at],
    ['Public by', price.known_at],
    ['Retrieved', price.fetched_at],
    ['Observation', `${price.kind} ${price.observation_id}`],
    ['Source', price.source_name],
    ['Source record', `${price.source_id} (sha256 ${price.body_sha256})`],
    ['Stored basis', price.adjustment_basis],
    ['Comparison basis', basis.text],
  ]
  return (
    <ChartCard testId={testId} blockKind="scenario_price_comparison" title={undefined} dataAttrs={{ 'data-linked': String(linked) }}>
      <section aria-label="Stored closing price" className="flex flex-col gap-1" data-testid={`${testId}-price`}>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-fg">{price.heading}</p>
          <VerificationLabel kind={linked ? 'source_linked' : 'not_verified'} />
        </div>
        <p className="num text-sm text-fg" title={price.price.full_text}>{price.price.text}</p>
        <p className="text-xs text-muted">{content.cutoff?.text}</p>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs text-muted">
          {provenance.map(([label, value]) => (
            <div key={label} className="contents">
              <dt>{label}</dt>
              <dd className="break-all text-fg-soft">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <table className="w-full border-collapse text-left text-sm" data-testid={`${testId}-rows`}>
        <thead className="bg-surface-2">
          <tr>
            <th scope="col" className="border-b border-line px-3 py-2 text-xs font-medium text-muted">Scenario</th>
            <th scope="col" className="border-b border-line px-3 py-2 text-xs font-medium text-muted">
              P/E <VerificationLabel kind="user_supplied" />
            </th>
            <th scope="col" className="border-b border-line px-3 py-2 text-right text-xs font-medium text-muted">Scenario value</th>
            <th scope="col" colSpan={2} className="border-b border-line px-3 py-2 text-right text-xs font-medium text-muted">
              Difference from the price <VerificationLabel kind="conditional_comparison" />
            </th>
          </tr>
        </thead>
        <tbody>
          {outcome.rows.map((row) => (
            <tr key={row.scenario} className="border-t border-line" data-scenario={row.scenario}>
              <th scope="row" className="px-3 py-2 font-normal text-fg">{SCENARIO_NAME[row.scenario]}</th>
              <td className="num px-3 py-2 text-fg">{row.multiple_text}</td>
              <td className="num px-3 py-2 text-right text-fg">
                <span title={row.scenario_value.full_text}>{row.scenario_value.text}</span>
                {certified ? (
                  <span className="block text-xs text-muted" data-testid={`${testId}-certificate`}>
                    EPS × P/E: <VerificationLabel kind="verified" /> in the scenario answer above
                  </span>
                ) : null}
              </td>
              <td className="num px-3 py-2 text-right text-fg" title={row.difference.full_text}>{row.difference.text}</td>
              <td className="num px-3 py-2 text-right text-fg" title={row.percent.full_text}>{row.percent.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p role="note" className="text-xs text-muted">{content.note}</p>
    </ChartCard>
  )
}
