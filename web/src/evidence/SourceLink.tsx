import type { ReactElement, ReactNode } from 'react'

import type { FigureSegment, SourceRef } from '../blocks/types.ts'
import { InspectableRef } from './InspectableRef.tsx'
import { InspectableResult } from './InspectableResult.tsx'
import { useEvidenceInspector } from './useEvidenceInspector.ts'

// A value as the text reads it, with no padding or fill: either would show as a
// space before the punctuation after it (#303).
export const REF_CLASS = 'rounded text-left text-fg-soft underline decoration-dotted underline-offset-2'

// A figure's source (#800): an engine result opens its verified calculation, headed by
// its measure and period like any result chip, with text as the value shown; any other
// source opens its evidence, headed with text. label names a control whose children are
// not text (a citation number).
export function SourceLink({ snapshotId, source, text, label, children }: { snapshotId: string; source: SourceRef; text: string; label?: string; children: ReactNode }): ReactElement {
  if (source.ref_kind === 'result') {
    return (
      <InspectableResult
        resultId={source.ref_id}
        label={source.period ? `${text}, ${source.period}` : text}
        shown={{ subject: null, measure: null, period: source.period ?? null, value: text }}
        className={REF_CLASS}
      >
        {children}
      </InspectableResult>
    )
  }
  return (
    <InspectableRef snapshotId={snapshotId} inspectionRef={{ kind: source.ref_kind, id: source.ref_id }} shownAs={text} label={label} className={REF_CLASS}>
      {children}
    </InspectableRef>
  )
}

// A source as a figure page or a citation names it: what it shows, and its period.
export const sourceText = (source: SourceRef) => source.format ?? source.ref_kind
export const sourceLabel = (source: SourceRef) => (source.period ? `${sourceText(source)}, ${source.period}` : sourceText(source))

// A figure as the answer wrote it, linked to what it was checked against: its one
// source, or, when computed from several, a page naming the derivation and each source.
export function LinkedFigure({ snapshotId, figure }: { snapshotId: string; figure: Pick<FigureSegment, 'text' | 'sources' | 'derivation' | 'operands'> }): ReactElement {
  const open = useEvidenceInspector()?.openFigure
  const [only] = figure.sources
  if (figure.derivation === undefined && figure.sources.length === 1 && only) {
    return <SourceLink snapshotId={snapshotId} source={only} text={figure.text}>{figure.text}</SourceLink>
  }
  if (!open) return <>{figure.text}</>
  return (
    <button
      type="button"
      className={`border-0 bg-transparent p-0 ${REF_CLASS}`}
      data-inspect-figure
      aria-label={figure.derivation ? `Inspect how ${figure.text} is computed` : `Inspect the sources of ${figure.text}`}
      onClick={() => open({ snapshotId, figure: { type: 'figure', ...figure } })}
    >
      {figure.text}
    </button>
  )
}
