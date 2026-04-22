// Scaffold sections for the entered subject-detail shell. Each is a minimal
// placeholder that names the bead which fills in the real content, so the
// route tree is complete and navigable today. Kept in one file because each
// placeholder is trivial; when P1.3 / P1.3b / P4.1 / P4.6 land the real
// surfaces, those beads should split this into per-section modules.

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

export function OverviewSection() {
  return (
    <SectionScaffold
      testId="section-overview"
      title="Overview"
      source="Subject overview blocks (identity, classification, key stats, recent findings) ship with fra-6al.5b (P1.3 symbol overview)."
    />
  )
}

export function FinancialsSection() {
  return (
    <SectionScaffold
      testId="section-financials"
      title="Financials"
      source="Normalized statement blocks + segment views ship with P3.* (promotion rules + aggregation layer) feeding this surface via P1.3b."
    />
  )
}

export function EarningsSection() {
  return (
    <SectionScaffold
      testId="section-earnings"
      title="Earnings"
      source="Earnings history, guidance, call commentary, and estimate context ship with P3.2 (earnings) + P4.1 (aggregation)."
    />
  )
}

export function HoldersSection() {
  return (
    <SectionScaffold
      testId="section-holders"
      title="Holders"
      source="Holder composition, recent filings, and insider activity ship with P3.3 (ownership) + P4.1."
    />
  )
}

export function SignalsSection() {
  return (
    <SectionScaffold
      testId="section-signals"
      title="Signals"
      source="Extensible section for community, sentiment, news pulse, and future alt-data — ships with P4.6 (specialized social + news blocks). Not a source-specific /reddit or /news route."
    />
  )
}
