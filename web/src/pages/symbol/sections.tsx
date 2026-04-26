// Placeholders for sections that haven't shipped yet. OverviewSection,
// FinancialsSection, and EarningsSection have moved to their own modules.
// When P1.3b holders/signals land, those should also split out.

type SectionScaffoldProps = {
  testId: string
  title: string
  source: string
}

function SectionScaffold({ testId, title, source }: SectionScaffoldProps) {
  return (
    <div data-testid={testId} className="flex flex-1 flex-col gap-4 p-8">
      <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        {title}
      </h2>
      <div className="rounded-md border border-neutral-200 bg-white p-6 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
        {source}
      </div>
    </div>
  )
}

export { OverviewSection } from './OverviewSection'
export { FinancialsSection } from './FinancialsSection'
export { EarningsSection } from './EarningsSection'

export function HoldersSection() {
  return (
    <SectionScaffold
      testId="section-holders"
      title="Holders"
      source="Holder composition, recent filings, and insider activity ship with P1.3b, built on P3.3 (ownership) and P4.1."
    />
  )
}

export function SignalsSection() {
  return (
    <SectionScaffold
      testId="section-signals"
      title="Signals"
      source="Extensible section for community, sentiment, news pulse, and future alt-data. Surface ships with P1.3b, content blocks ship with P4.6 (specialized social + news blocks). Deliberately not a source-specific /reddit or /news route."
    />
  )
}
