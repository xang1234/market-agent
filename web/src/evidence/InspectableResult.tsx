import type { ReactElement, ReactNode } from 'react'

import { useEvidenceInspector } from './useEvidenceInspector.ts'

// A certified value opens the shared result inspector where the host provides
// one; a real button, so it is reachable by keyboard. Without a host it is text.
export function InspectableResult({ resultId, label, children }: { resultId: string; label: string; children: ReactNode }): ReactElement {
  const inspector = useEvidenceInspector()
  const open = inspector?.openFinancialResult
  if (!open) return <>{children}</>
  return (
    <button
      type="button"
      className="border-0 bg-transparent p-0 text-left underline decoration-dotted underline-offset-2"
      data-inspect-result={resultId}
      aria-label={`Inspect the verified calculation for ${label}`}
      onClick={() => open(resultId)}
    >
      {children}
    </button>
  )
}
