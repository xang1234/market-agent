import type { ReactElement, ReactNode } from 'react'

import type { FigureSegment, SourceRef } from '../blocks/types.ts'
import { InspectableRef } from './InspectableRef.tsx'
import { figureText } from './readable.ts'
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

// A figure linked to what it was checked against: its one source, or, when computed from
// several, a page naming the derivation and each source.
export function LinkedFigure({ snapshotId, figure, before = '' }: { snapshotId: string; figure: FigureSegment; before?: string }): ReactElement {
  const open = useEvidenceInspector()?.openFigure
  const [only] = figure.sources
  const text = figureText(figure, before)
  if (figure.derivation === undefined && figure.sources.length === 1 && only) {
    return <SourceLink snapshotId={snapshotId} source={only} text={text}>{text}</SourceLink>
  }
  if (!open) return <>{text}</>
  return (
    <button
      type="button"
      className={`border-0 bg-transparent p-0 ${REF_CLASS}`}
      data-inspect-figure
      aria-label={figure.derivation ? `Inspect how ${text} is computed` : `Inspect the sources of ${text}`}
      onClick={() => open({ snapshotId, figure })}
    >
      {text}
    </button>
  )
}
