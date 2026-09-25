import type { ReactElement } from 'react'

import { BlockView, type Block } from '../blocks'
import { VerificationLabel } from '../blocks/VerificationLabel.tsx'
import type { AnalyzeFinancialSections } from './runHistory.ts'

const GAP_TEXT: Readonly<Record<string, string>> = {
  configuration_needed: 'A requested company or definition could not be resolved to one verified meaning.',
  unsupported: 'This section asks for a calculation outside the verified definitions.',
  run_in_progress: 'This section is still being calculated.',
  run_failed: 'This section could not be calculated.',
  run_cancelled: 'This calculation was cancelled.',
  verification_failed: 'This section did not pass verification, so no figures are shown.',
  publication_failed: 'This section has not been published yet.',
  not_started: 'This section has not been calculated yet.',
  request_conflict: 'This memo already has a different calculation for this section.',
}

// The memo's verified numerical sections, each its own certified block beside
// the narrative memo. A requested section that did not publish stays visible
// as a gap with its reason; the memo never reads as complete without it.
export function FinancialSections({ sections }: { sections: AnalyzeFinancialSections }): ReactElement | null {
  if (sections.sections.length === 0) return null
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-3" data-testid="memo-financial-sections" data-coverage={sections.coverage}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-fg">Verified figures</h3>
        {sections.coverage === 'complete' ? null : <VerificationLabel kind="partial" />}
      </div>
      {sections.sections.map((section) => (
        <div key={section.section_id} data-section-id={section.section_id} data-section-status={section.status} className="flex flex-col gap-1">
          <h4 className="text-xs font-medium uppercase text-muted">{section.section_id.replaceAll('_', ' ')}</h4>
          {section.status === 'published' ? (
            <BlockView block={section.block as Block} />
          ) : (
            <p role="note" className="text-sm italic text-muted">
              {GAP_TEXT[section.reason_code] ?? 'This section is not available.'}
            </p>
          )}
        </div>
      ))}
    </section>
  )
}
