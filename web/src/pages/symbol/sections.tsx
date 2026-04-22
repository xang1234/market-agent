// Scaffold sections for the entered subject-detail shell. Each is a minimal
// placeholder that names the phase which fills in the real content, so the
// route tree is complete and navigable today. Kept in one file because each
// placeholder is trivial; when P1.3 (overview + financials + earnings core
// tabs) and P1.3b (holders + signals + Analyze entry integration) land,
// those beads should split this into per-section modules.
//
// Phase references are used instead of bead IDs — phase numbers are stable
// normative spec markers, bead IDs are project-local and can drift.

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
      source="Identity, classification, key stats, and recent findings ship with P1.3 (symbol detail core tabs) — consuming the resolver (P0.3) and first quote snapshot (P0.4)."
    />
  )
}

export function FinancialsSection() {
  return (
    <SectionScaffold
      testId="section-financials"
      title="Financials"
      source="Normalized statement blocks and segment views ship with P1.3, sourced from P3.* (promotion rules) and the P4.1 aggregation layer."
    />
  )
}

export function EarningsSection() {
  return (
    <SectionScaffold
      testId="section-earnings"
      title="Earnings"
      source="Earnings history, guidance, call commentary, and estimate context ship with P1.3, built on P3.2 (earnings) and P4.1 (aggregation / consensus)."
    />
  )
}

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
